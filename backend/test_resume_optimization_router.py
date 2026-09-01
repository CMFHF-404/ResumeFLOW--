from __future__ import annotations

import asyncio
from contextlib import contextmanager, ExitStack
from datetime import datetime, timezone
import json
import os
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import FastAPI, HTTPException


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")
    os.environ["ENABLE_DEV_AUTH_BYPASS"] = "false"


_set_required_env_defaults()

from app.domain.ai.runtime_budget import AiRuntimeTimeoutError  # noqa: E402
from app.domain.ai.public_errors import AiProviderPayloadError  # noqa: E402
from app.domain.resume_optimization import router as router_module  # noqa: E402
from app.domain.resume_optimization.context_service import (  # noqa: E402
    OptimizationContextStaleError,
)
from app.domain.resume_optimization.models import ResumeOptimizationRun  # noqa: E402
from app.domain.resume_optimization.normalizers import (  # noqa: E402
    OptimizationPlanNormalizationError,
    normalize_optimization_plan,
)
from app.domain.resume_optimization.run_service import (  # noqa: E402
    OptimizationRunNotFoundError,
)
from app.domain.resume_optimization.schemas import (  # noqa: E402
    BankSuggestion,
    OptimizationAnswer,
    OptimizationPlan,
    ResumeOptimizationAnswersRequest,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from app.domain.resume_optimization.state_machine import (  # noqa: E402
    InvalidOptimizationTransitionError,
    require_status_transition,
)


USER_ID = "router-user"
RESUME_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
RUN_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
BASE_TIME = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)


def _start_payload() -> ResumeOptimizationStartRequest:
    return ResumeOptimizationStartRequest(
        resume_id=str(RESUME_ID),
        evaluation_signature="evaluation-signature",
        expected_resume_updated_at=BASE_TIME,
    )


def _answers_payload() -> ResumeOptimizationAnswersRequest:
    return ResumeOptimizationAnswersRequest(
        answers=[
            OptimizationAnswer(
                question_id="Q1",
                state="answered",
                value="负责两个页面",
            )
        ]
    )


def _run(
    status: ResumeOptimizationStatus = ResumeOptimizationStatus.PREVIEW_READY,
) -> ResumeOptimizationRun:
    plan = OptimizationPlan().model_dump(mode="json")
    return ResumeOptimizationRun(
        id=RUN_ID,
        user_id=USER_ID,
        resume_id=RESUME_ID,
        status=status.value,
        optimizer_version="resume_optimization_v1",
        policy_version="thin_safety_v1",
        prompt_version="resume_optimization_prompt_v1",
        source_resume_updated_at=BASE_TIME,
        source_evaluation_signature="evaluation-signature",
        source_jd_signature="jd-signature",
        source_snapshot_hash="snapshot-hash",
        request_hash="request-hash",
        plan_json=plan,
        result_json=plan,
        answers_json={"answers": []},
        created_at=BASE_TIME,
        updated_at=BASE_TIME,
    )


def _persisted_change(change_id: str = "CHG_1") -> dict:
    return {
        "change_id": change_id,
        "issue_ids": ["ISSUE_1"],
        "dimension": "内容完整性",
        "module_type": "personal_summary",
        "module_id": "current_resume",
        "field_path": "summary",
        "action_kind": "leave_unchanged",
        "scope": "general",
        "before_value": "当前摘要",
        "general_value": None,
        "targeted_value": None,
        "source_refs": [],
        "introduced_terms": [],
        "rationale": "保持现状",
        "expected_score_gain": 0,
        "default_selected": False,
        "safety_status": "allowed",
        "safety_findings": [],
    }


def _persisted_question(question_id: str = "Q1") -> dict:
    return {
        "question_id": question_id,
        "module_id": "current_resume",
        "field_path": "summary",
        "text": "请补充摘要信息",
        "reason": "需要确认事实",
        "answer_type": "single_choice_with_text",
        "choices": [],
        "affects_change_ids": ["CHG_1"],
        "priority": 1,
    }


class _Session:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.commit_error = commit_error

    async def commit(self) -> None:
        self.commits += 1
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self) -> None:
        self.rollbacks += 1


class _OwnedSession(_Session):
    def __init__(self) -> None:
        super().__init__()
        self.entered = 0
        self.exited = 0
        self.closed = False

    async def __aenter__(self):
        self.entered += 1
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self.exited += 1
        self.closed = True
        return False


class _OwnedSessionFactory:
    def __init__(self) -> None:
        self.sessions: list[_OwnedSession] = []

    def __call__(self) -> _OwnedSession:
        session = _OwnedSession()
        self.sessions.append(session)
        return session


class _BillingContext:
    def __init__(self) -> None:
        self.entered = 0
        self.exited = 0

    async def __aenter__(self):
        self.entered += 1
        return None

    async def __aexit__(self, exc_type, exc, traceback):
        self.exited += 1
        return False


class _Lease:
    def __init__(self, order: list[str] | None = None) -> None:
        async def release() -> None:
            if order is not None:
                order.append("lease_released")

        self.release = AsyncMock(side_effect=release)


async def _override_session():
    yield _Session()


async def _override_user():
    return SimpleNamespace(id=USER_ID)


async def _consume_stream(response) -> list[dict]:
    events: list[dict] = []
    async for chunk in response.body_iterator:
        text = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
        for line in text.splitlines():
            if line.strip():
                events.append(json.loads(line))
    return events


class ResumeOptimizationRouterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.owned_session_factory = _OwnedSessionFactory()
        self.session_factory_patch = patch.object(
            router_module,
            "AsyncSessionFactory",
            self.owned_session_factory,
            create=True,
        )
        self.session_factory_patch.start()
        self.addCleanup(self.session_factory_patch.stop)

    def _app(self, *, authenticated: bool = True) -> FastAPI:
        app = FastAPI()
        app.include_router(router_module.router)
        app.dependency_overrides[router_module.get_session] = _override_session
        if authenticated:
            app.dependency_overrides[router_module.get_current_user] = _override_user
        return app

    @contextmanager
    def _billing(self, *, lease: _Lease | None = None):
        resolved_lease = lease or _Lease()
        billing_context = _BillingContext()
        begin = AsyncMock(return_value=resolved_lease)
        context_factory = Mock(return_value=billing_context)
        with ExitStack() as stack:
            stack.enter_context(
                patch.object(router_module.billing_service, "begin_ai_request", begin)
            )
            stack.enter_context(
                patch.object(
                    router_module.billing_service,
                    "ai_billing_context",
                    context_factory,
                )
            )
            yield resolved_lease, billing_context, begin, context_factory

    async def test_auth_is_required(self) -> None:
        app = self._app(authenticated=False)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get(
                "/api/resume-optimizations/latest",
                params={"resume_id": str(RESUME_ID)},
            )

        self.assertEqual(response.status_code, 401)

    async def test_unauthorized_mutating_routes_never_start_billing(self) -> None:
        app = self._app(authenticated=False)
        begin = AsyncMock()
        with patch.object(router_module.billing_service, "begin_ai_request", begin):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                responses = [
                    await client.post(
                        "/api/resume-optimizations/stream",
                        json=_start_payload().model_dump(mode="json"),
                        headers={
                            "Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                        },
                    ),
                    await client.post(
                        f"/api/resume-optimizations/{RUN_ID}/answers/stream",
                        json=_answers_payload().model_dump(mode="json"),
                    ),
                    await client.post(
                        f"/api/resume-optimizations/{RUN_ID}/cancel"
                    ),
                ]

        self.assertEqual([response.status_code for response in responses], [401, 401, 401])
        begin.assert_not_awaited()

    async def test_missing_and_invalid_idempotency_keys_fail_before_billing(self) -> None:
        app = self._app()
        begin = AsyncMock()
        payload = _start_payload().model_dump(mode="json")
        with patch.object(router_module.billing_service, "begin_ai_request", begin):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                missing = await client.post(
                    "/api/resume-optimizations/stream",
                    json=payload,
                )
                invalid = await client.post(
                    "/api/resume-optimizations/stream",
                    json=payload,
                    headers={"Idempotency-Key": "not-a-uuid"},
                )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(
            missing.json()["detail"]["code"],
            "resume_optimization_idempotency_key_required",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            invalid.json()["detail"]["code"],
            "resume_optimization_idempotency_key_invalid",
        )
        begin.assert_not_awaited()

    async def test_idempotency_key_is_canonical_and_duplicate_header_is_rejected(self) -> None:
        canonical = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        self.assertEqual(
            router_module._require_idempotency_key("AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA"),
            canonical,
        )
        for invalid in ("   ", "bad\x00key"):
            with self.subTest(invalid=repr(invalid)):
                with self.assertRaises(HTTPException):
                    router_module._require_idempotency_key(invalid)

        app = self._app()
        begin = AsyncMock(return_value=None)
        create = AsyncMock(return_value=_run())
        with (
            patch.object(router_module.billing_service, "begin_ai_request", begin),
            patch.object(router_module, "create_optimization_plan", create),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                response = await client.post(
                    "/api/resume-optimizations/stream",
                    json=_start_payload().model_dump(mode="json"),
                    headers=[
                        ("Idempotency-Key", canonical),
                        (
                            "Idempotency-Key",
                            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        ),
                    ],
                )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"]["code"],
            "resume_optimization_idempotency_key_invalid",
        )
        begin.assert_not_awaited()
        create.assert_not_awaited()

    async def test_planning_stream_preserves_event_order_and_billing_context(self) -> None:
        session = _Session()
        lease = _Lease()

        async def create_plan(**kwargs):
            for node in (
                "freeze_snapshot",
                "prepare_context",
                "plan_changes",
                "verify_changes",
                "persist_run",
            ):
                await kwargs["progress_callback"](
                    {
                        "type": "progress",
                        "node": node,
                        "title": node,
                        "requestId": kwargs["request_id"],
                    }
                )
            return _run()

        with (
            self._billing(lease=lease) as billing,
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=create_plan),
            ) as create,
            patch.object(router_module, "new_ai_request_id", return_value="plan-request"),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=session,
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)

        self.assertEqual(
            [event.get("node", event["type"]) for event in events],
            [
                "freeze_snapshot",
                "prepare_context",
                "plan_changes",
                "verify_changes",
                "persist_run",
                "final",
            ],
        )
        self.assertEqual({event["requestId"] for event in events}, {"plan-request"})
        self.assertEqual(events[-1]["result"]["id"], str(RUN_ID))
        create.assert_awaited_once()
        owned_session = self.owned_session_factory.sessions[0]
        self.assertIs(create.await_args.kwargs["session"], owned_session)
        self.assertIsNot(create.await_args.kwargs["session"], session)
        self.assertEqual(
            create.await_args.kwargs["idempotency_key"],
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )
        _, context, begin, context_factory = billing
        begin.assert_awaited_once_with(
            session,
            USER_ID,
            entrypoint="resume_optimization_plan",
        )
        context_factory.assert_called_once_with(
            owned_session,
            USER_ID,
            entrypoint="resume_optimization_plan",
            metadata={"route": "/api/resume-optimizations/stream"},
            request_lease=lease,
            release_request_lease_on_exit=False,
        )
        self.assertEqual((context.entered, context.exited), (1, 1))
        self.assertEqual((owned_session.entered, owned_session.exited), (1, 1))
        self.assertTrue(owned_session.closed)
        self.assertEqual(session.commits, 1)
        lease.release.assert_awaited_once()

    async def test_idempotent_existing_run_still_uses_declared_quota_lease_boundary(self) -> None:
        lease = _Lease()
        with (
            self._billing(lease=lease) as billing,
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(return_value=_run(ResumeOptimizationStatus.PLANNING)),
            ),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)

        self.assertEqual([event["type"] for event in events], ["final"])
        billing[2].assert_awaited_once()
        self.assertEqual((billing[1].entered, billing[1].exited), (1, 1))
        lease.release.assert_awaited_once()

    async def test_answer_stream_preserves_event_order_and_billing_context(self) -> None:
        session = _Session()
        lease = _Lease()

        async def answer_questions(**kwargs):
            for node in (
                "prepare_context",
                "rewrite_changes",
                "verify_changes",
                "persist_run",
            ):
                await kwargs["progress_callback"](
                    {
                        "type": "progress",
                        "node": node,
                        "title": node,
                        "requestId": kwargs["request_id"],
                    }
                )
            return _run()

        with (
            self._billing(lease=lease) as billing,
            patch.object(
                router_module,
                "answer_optimization_questions",
                AsyncMock(side_effect=answer_questions),
            ) as answer,
            patch.object(router_module, "new_ai_request_id", return_value="answer-request"),
        ):
            response = await router_module.answer_resume_optimization_stream(
                run_id=str(RUN_ID),
                payload=_answers_payload(),
                request=SimpleNamespace(),
                session=session,
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)

        self.assertEqual(
            [event.get("node", event["type"]) for event in events],
            [
                "prepare_context",
                "rewrite_answers",
                "verify_changes",
                "persist_run",
                "final",
            ],
        )
        self.assertEqual({event["requestId"] for event in events}, {"answer-request"})
        answer.assert_awaited_once()
        owned_session = self.owned_session_factory.sessions[0]
        self.assertIs(answer.await_args.kwargs["session"], owned_session)
        self.assertIsNot(answer.await_args.kwargs["session"], session)
        _, context, begin, context_factory = billing
        begin.assert_awaited_once_with(
            session,
            USER_ID,
            entrypoint="resume_optimization_answer",
        )
        context_factory.assert_called_once_with(
            owned_session,
            USER_ID,
            entrypoint="resume_optimization_answer",
            metadata={
                "route": f"/api/resume-optimizations/{RUN_ID}/answers/stream"
            },
            request_lease=lease,
            release_request_lease_on_exit=False,
        )
        self.assertEqual((context.entered, context.exited), (1, 1))
        self.assertEqual((owned_session.entered, owned_session.exited), (1, 1))
        self.assertTrue(owned_session.closed)
        self.assertEqual(session.commits, 1)
        lease.release.assert_awaited_once()

    async def test_post_lease_commit_failure_rolls_back_and_releases_once(self) -> None:
        request_session = _Session(commit_error=RuntimeError("commit failed"))
        lease = _Lease()
        begin = AsyncMock(return_value=lease)
        create = AsyncMock()

        with (
            patch.object(router_module.billing_service, "begin_ai_request", begin),
            patch.object(router_module, "create_optimization_plan", create),
        ):
            with self.assertRaisesRegex(RuntimeError, "commit failed"):
                await router_module.start_resume_optimization_stream(
                    payload=_start_payload(),
                    request=SimpleNamespace(),
                    idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                    session=request_session,
                    current_user=SimpleNamespace(id=USER_ID),
                )

        self.assertEqual(request_session.commits, 1)
        self.assertEqual(request_session.rollbacks, 1)
        lease.release.assert_awaited_once()
        create.assert_not_awaited()
        self.assertEqual(self.owned_session_factory.sessions, [])

    async def test_get_run_and_latest_are_owner_scoped_and_never_bill(self) -> None:
        session = _Session()
        begin = AsyncMock()
        billing_context = Mock()
        with (
            patch.object(
                router_module,
                "get_run_for_user",
                AsyncMock(return_value=_run()),
            ) as get_run,
            patch.object(
                router_module,
                "get_latest_run_for_resume",
                AsyncMock(return_value=_run()),
            ) as latest,
            patch.object(router_module.billing_service, "begin_ai_request", begin),
            patch.object(
                router_module.billing_service,
                "ai_billing_context",
                billing_context,
            ),
        ):
            by_id = await router_module.get_resume_optimization_run(
                run_id=str(RUN_ID),
                session=session,
                current_user=SimpleNamespace(id=USER_ID),
            )
            by_resume = await router_module.get_latest_resume_optimization_run(
                resume_id=str(RESUME_ID),
                session=session,
                current_user=SimpleNamespace(id=USER_ID),
            )

        self.assertEqual(by_id.id, str(RUN_ID))
        self.assertEqual(by_resume.id, str(RUN_ID))
        get_run.assert_awaited_once_with(session, USER_ID, str(RUN_ID))
        latest.assert_awaited_once_with(session, USER_ID, str(RESUME_ID))
        begin.assert_not_awaited()
        billing_context.assert_not_called()

    async def test_read_serializer_excludes_private_fields_and_falls_back_to_plan_json(self) -> None:
        stored = _run()
        stored.user_id = "private-user-canary"
        stored.before_snapshot = {"secret": "PRIVATE_SNAPSHOT_CANARY"}
        stored.idempotency_key_hash = "PRIVATE_IDEMPOTENCY_CANARY"
        stored.error_json = {
            "_activePlanningClaim": {"claimId": "PRIVATE_PLAN_CLAIM"}
        }
        stored.answers_json = {
            "answers": [],
            "_activeAnswerClaim": {"claimId": "PRIVATE_ANSWER_CLAIM"},
        }
        stored.plan_json = OptimizationPlan(
            bank_suggestions=[
                BankSuggestion(
                    suggestion_id="BANK_001",
                    master_experience_id="bank-a",
                    category="project",
                    title="项目",
                    org="组织",
                    match_score=88,
                    reason="补充证据",
                )
            ]
        ).model_dump(mode="json")
        stored.result_json = {}

        payload = router_module._run_to_read(stored).model_dump(mode="json")
        serialized = json.dumps(payload, ensure_ascii=False)

        for private_key in (
            "user_id",
            "before_snapshot",
            "idempotency_key_hash",
            "error_json",
            "_activePlanningClaim",
            "_activeAnswerClaim",
        ):
            self.assertNotIn(private_key, payload)
        for canary in (
            "PRIVATE_SNAPSHOT_CANARY",
            "PRIVATE_IDEMPOTENCY_CANARY",
            "PRIVATE_PLAN_CLAIM",
            "PRIVATE_ANSWER_CLAIM",
            "private-user-canary",
        ):
            self.assertNotIn(canary, serialized)
        self.assertEqual(payload["plan"]["bank_suggestions"][0]["suggestion_id"], "BANK_001")

    async def test_result_serializer_normalizes_nested_extras_without_leaking(self) -> None:
        stored = _run()
        result = OptimizationPlan(
            bank_suggestions=[
                BankSuggestion(
                    suggestion_id="BANK_001",
                    master_experience_id="bank-a",
                    category="project",
                    title="项目",
                    org="组织",
                    match_score=88,
                    reason="补充证据",
                )
            ]
        ).model_dump(mode="json")
        result["bank_suggestions"][0]["private"] = "PRIVATE_NESTED_CANARY"
        stored.result_json = result

        payload = router_module._run_to_read(stored).model_dump(mode="json")
        serialized = json.dumps(payload, ensure_ascii=False)

        self.assertEqual(payload["plan"], payload["result"])
        self.assertNotIn("private", payload["result"]["bank_suggestions"][0])
        self.assertNotIn("PRIVATE_NESTED_CANARY", serialized)

    async def test_nonempty_persisted_plan_requires_complete_root_shape(self) -> None:
        for target_field in ("plan_json", "result_json"):
            with self.subTest(target_field=target_field):
                stored = _run()
                stored.plan_json = {}
                stored.result_json = {}
                setattr(stored, target_field, {"changes": []})

                with self.assertRaises(
                    router_module.OptimizationPersistedRunInvalidError
                ):
                    router_module._run_to_read(stored)

    async def test_duplicate_persisted_ids_are_rejected_as_typed_corruption(self) -> None:
        duplicate_payloads = (
            {
                "changes": [_persisted_change(), _persisted_change()],
                "questions": [],
                "bank_suggestions": [],
                "safety_summary": {},
            },
            {
                "changes": [_persisted_change()],
                "questions": [_persisted_question(), _persisted_question()],
                "bank_suggestions": [],
                "safety_summary": {},
            },
        )
        for payload in duplicate_payloads:
            with self.subTest(keys=tuple(payload)):
                stored = _run()
                stored.result_json = payload
                with self.assertRaises(
                    router_module.OptimizationPersistedRunInvalidError
                ):
                    router_module._run_to_read(stored)

        duplicate_answers = _run()
        duplicate_answers.answers_json = {
            "answers": [
                {
                    "question_id": "Q1",
                    "state": "answered",
                    "value": "已确认",
                },
                {
                    "question_id": "Q1",
                    "state": "no_data",
                    "value": "",
                },
            ]
        }
        with self.assertRaises(router_module.OptimizationPersistedRunInvalidError):
            router_module._run_to_read(duplicate_answers)

    async def test_corrupt_persisted_run_validation_is_all_or_nothing_and_safe(self) -> None:
        corrupt_runs: list[ResumeOptimizationRun] = []

        malformed_answers = _run()
        malformed_answers.answers_json = {
            "answers": [
                {
                    "question_id": "",
                    "state": "answered",
                    "value": "PRIVATE_ANSWER_CANARY",
                }
            ]
        }
        corrupt_runs.append(malformed_answers)

        malformed_plan = _run()
        malformed_plan.plan_json = {
            "changes": "PRIVATE_PLAN_CANARY",
            "questions": [],
        }
        malformed_plan.result_json = {}
        corrupt_runs.append(malformed_plan)

        malformed_result = _run()
        malformed_result.result_json = {
            "unexpected": "PRIVATE_RESULT_CANARY",
        }
        corrupt_runs.append(malformed_result)

        for index, corrupt in enumerate(corrupt_runs):
            with self.subTest(index=index):
                with patch.object(
                    router_module,
                    "get_run_for_user",
                    AsyncMock(return_value=corrupt),
                ):
                    with self.assertRaises(HTTPException) as by_id:
                        await router_module.get_resume_optimization_run(
                            run_id=str(RUN_ID),
                            session=_Session(),
                            current_user=SimpleNamespace(id=USER_ID),
                        )

                with patch.object(
                    router_module,
                    "get_latest_run_for_resume",
                    AsyncMock(return_value=corrupt),
                ):
                    with self.assertRaises(HTTPException) as latest:
                        await router_module.get_latest_resume_optimization_run(
                            resume_id=str(RESUME_ID),
                            session=_Session(),
                            current_user=SimpleNamespace(id=USER_ID),
                        )

                for raised in (by_id.exception, latest.exception):
                    self.assertEqual(raised.status_code, 500)
                    self.assertEqual(
                        raised.detail["code"],
                        "resume_optimization_run_invalid",
                    )
                    serialized = json.dumps(raised.detail, ensure_ascii=False)
                    self.assertNotIn("PRIVATE_", serialized)
                    self.assertNotIn("validation error", serialized.casefold())

    async def test_latest_route_has_priority_and_missing_latest_is_stable_404(self) -> None:
        paths = [route.path for route in router_module.router.routes]
        self.assertLess(
            paths.index("/api/resume-optimizations/latest"),
            paths.index("/api/resume-optimizations/{run_id}"),
        )
        with patch.object(
            router_module,
            "get_latest_run_for_resume",
            AsyncMock(return_value=None),
        ):
            with self.assertRaises(HTTPException) as raised:
                await router_module.get_latest_resume_optimization_run(
                    resume_id=str(RESUME_ID),
                    session=_Session(),
                    current_user=SimpleNamespace(id=USER_ID),
                )

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(
            raised.exception.detail["code"],
            "resume_optimization_run_not_found",
        )

    async def test_owner_isolation_maps_not_found_to_stable_404(self) -> None:
        session = _Session()
        with patch.object(
            router_module,
            "get_run_for_user",
            AsyncMock(side_effect=OptimizationRunNotFoundError(str(RUN_ID))),
        ):
            with self.assertRaises(HTTPException) as raised:
                await router_module.get_resume_optimization_run(
                    run_id=str(RUN_ID),
                    session=session,
                    current_user=SimpleNamespace(id="other-user"),
                )

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(
            raised.exception.detail["code"],
            "resume_optimization_run_not_found",
        )

    async def test_cancel_accepts_only_pre_apply_states_without_billing(self) -> None:
        for source in (
            ResumeOptimizationStatus.PLANNING,
            ResumeOptimizationStatus.AWAITING_ANSWERS,
            ResumeOptimizationStatus.PREVIEW_READY,
        ):
            with self.subTest(source=source.value):
                session = _Session()
                cancelled = _run(ResumeOptimizationStatus.CANCELLED)
                begin = AsyncMock()
                billing_context = Mock()

                async def cancel_from_source(
                    _session,
                    _user_id,
                    _run_id,
                    target,
                ):
                    require_status_transition(source, target)
                    return cancelled

                with (
                    patch.object(
                        router_module,
                        "get_run_for_user",
                        AsyncMock(return_value=_run(source)),
                    ),
                    patch.object(
                        router_module,
                        "transition_run",
                        AsyncMock(side_effect=cancel_from_source),
                    ) as transition,
                    patch.object(
                        router_module.billing_service,
                        "begin_ai_request",
                        begin,
                    ),
                    patch.object(
                        router_module.billing_service,
                        "ai_billing_context",
                        billing_context,
                    ),
                ):
                    result = await router_module.cancel_resume_optimization_run(
                        run_id=str(RUN_ID),
                        session=session,
                        current_user=SimpleNamespace(id=USER_ID),
                    )

                self.assertEqual(result.status, ResumeOptimizationStatus.CANCELLED)
                transition.assert_awaited_once_with(
                    session,
                    USER_ID,
                    str(RUN_ID),
                    ResumeOptimizationStatus.CANCELLED,
                )
                self.assertEqual(session.commits, 1)
                begin.assert_not_awaited()
                billing_context.assert_not_called()

    async def test_cancel_after_apply_is_stable_conflict(self) -> None:
        session = _Session()
        with (
            patch.object(
                router_module,
                "get_run_for_user",
                AsyncMock(return_value=_run(ResumeOptimizationStatus.APPLIED)),
            ),
            patch.object(
                router_module,
                "transition_run",
                AsyncMock(
                    side_effect=InvalidOptimizationTransitionError(
                        ResumeOptimizationStatus.APPLIED,
                        ResumeOptimizationStatus.CANCELLED,
                    )
                ),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                await router_module.cancel_resume_optimization_run(
                    run_id=str(RUN_ID),
                    session=session,
                    current_user=SimpleNamespace(id=USER_ID),
                )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "invalid_optimization_transition")
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_cancel_rejects_corrupt_run_before_transition_or_commit(self) -> None:
        session = _Session()
        corrupt = _run(ResumeOptimizationStatus.PREVIEW_READY)
        corrupt.answers_json = {"answers": "PRIVATE_CANCEL_CANARY"}
        transition = AsyncMock()
        with (
            patch.object(
                router_module,
                "get_run_for_user",
                AsyncMock(return_value=corrupt),
            ),
            patch.object(router_module, "transition_run", transition),
        ):
            with self.assertRaises(HTTPException) as raised:
                await router_module.cancel_resume_optimization_run(
                    run_id=str(RUN_ID),
                    session=session,
                    current_user=SimpleNamespace(id=USER_ID),
                )

        self.assertEqual(raised.exception.status_code, 500)
        self.assertEqual(
            raised.exception.detail["code"],
            "resume_optimization_run_invalid",
        )
        self.assertNotIn(
            "PRIVATE_CANCEL_CANARY",
            json.dumps(raised.exception.detail, ensure_ascii=False),
        )
        transition.assert_not_awaited()
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.rollbacks, 1)

    async def test_stale_context_stream_has_stable_public_code(self) -> None:
        stale = OptimizationContextStaleError("private stale detail")
        with (
            self._billing(),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=stale),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="stale-request"),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertEqual(events[0]["code"], "resume_optimization_context_stale")
        self.assertEqual(events[0]["statusCode"], 409)
        self.assertEqual(events[0]["requestId"], "stale-request")
        self.assertNotIn("private stale detail", events[0]["message"])

    async def test_quota_exhaustion_preserves_existing_402_contract(self) -> None:
        app = self._app()
        quota_error = HTTPException(
            status_code=402,
            detail={
                "code": "ai_token_quota_exhausted",
                "message": "AI Token 额度已用完，请购买套餐或兑换卡密后继续使用。",
            },
        )
        create = AsyncMock()
        with (
            patch.object(
                router_module.billing_service,
                "begin_ai_request",
                AsyncMock(side_effect=quota_error),
            ),
            patch.object(router_module, "create_optimization_plan", create),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                response = await client.post(
                    "/api/resume-optimizations/stream",
                    json=_start_payload().model_dump(mode="json"),
                    headers={
                        "Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
                    },
                )

        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.json()["detail"]["code"], "ai_token_quota_exhausted")
        create.assert_not_awaited()

    async def test_terminal_runtime_error_preserves_public_policy(self) -> None:
        timeout = AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)
        lease = _Lease()

        async def progress_then_timeout(**kwargs):
            await kwargs["progress_callback"](
                {
                    "type": "progress",
                    "node": "prepare_context",
                    "title": "prepare",
                    "requestId": kwargs["request_id"],
                }
            )
            raise timeout

        with (
            self._billing(lease=lease),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=progress_then_timeout),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="timeout-request"),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)
            self.assertIsNotNone(response.background)
            await response.background()

        self.assertEqual([event["type"] for event in events], ["progress", "error"])
        terminal = events[-1]
        self.assertEqual(terminal["code"], "ai_runtime_timeout")
        self.assertEqual(terminal["message"], AiRuntimeTimeoutError.public_message)
        self.assertEqual(terminal["statusCode"], 504)
        self.assertTrue(terminal["retryable"])
        self.assertEqual(terminal["requestId"], "timeout-request")
        owned_session = self.owned_session_factory.sessions[0]
        self.assertEqual((owned_session.entered, owned_session.exited), (1, 1))
        self.assertTrue(owned_session.closed)
        lease.release.assert_awaited_once()

    async def test_provider_and_unknown_errors_are_safe_and_stable(self) -> None:
        error_matrix = (
            (AiProviderPayloadError("private provider payload"), 502, "ai_provider_invalid_response"),
            (httpx.ConnectError("private provider URL"), 503, "ai_provider_unavailable"),
            (RuntimeError("PRIVATE_INTERNAL_CANARY"), 500, "internal_error"),
        )
        for error, status_code, code in error_matrix:
            with self.subTest(error=type(error).__name__):
                lease = _Lease()
                with (
                    self._billing(lease=lease),
                    patch.object(
                        router_module,
                        "create_optimization_plan",
                        AsyncMock(side_effect=error),
                    ),
                ):
                    response = await router_module.start_resume_optimization_stream(
                        payload=_start_payload(),
                        request=SimpleNamespace(),
                        idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        session=_Session(),
                        current_user=SimpleNamespace(id=USER_ID),
                    )
                    events = await _consume_stream(response)

                self.assertEqual(len(events), 1)
                self.assertEqual(events[0]["code"], code)
                self.assertEqual(events[0]["statusCode"], status_code)
                self.assertNotIn("private", events[0]["message"].casefold())
                self.assertNotIn("canary", events[0]["message"].casefold())
                lease.release.assert_awaited_once()

    async def test_real_plan_normalizer_error_has_safe_provider_invalid_semantics(self) -> None:
        with self.assertRaises(OptimizationPlanNormalizationError) as normalized:
            normalize_optimization_plan(
                ["PRIVATE_NORMALIZER_CANARY"],
                known_issue_ids=set(),
                selected_master_ids=set(),
                selected_skill_ids=set(),
                current_section_order=[],
            )

        lease = _Lease()
        with (
            self._billing(lease=lease),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=normalized.exception),
            ),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            events = await _consume_stream(response)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertEqual(events[0]["code"], "resume_optimization_plan_invalid")
        self.assertEqual(events[0]["statusCode"], 502)
        self.assertEqual(
            events[0]["message"],
            router_module.AI_PROVIDER_INVALID_RESPONSE_MESSAGE,
        )
        self.assertFalse(events[0]["retryable"])
        self.assertNotIn(
            "PRIVATE_NORMALIZER_CANARY",
            json.dumps(events[0], ensure_ascii=False),
        )
        lease.release.assert_awaited_once()

    async def test_stream_close_cancels_producer_and_releases_lease(self) -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()
        order: list[str] = []
        lease = _Lease(order)

        async def long_plan(**kwargs):
            await kwargs["progress_callback"](
                {
                    "type": "progress",
                    "node": "freeze_snapshot",
                    "title": "freeze",
                    "requestId": kwargs["request_id"],
                }
            )
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                order.append("producer_cancelled")
                cancelled.set()
                raise

        with (
            self._billing(lease=lease),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=long_plan),
            ),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            iterator = response.body_iterator
            first = await anext(iterator)
            self.assertIn("freeze_snapshot", first)
            await started.wait()
            await iterator.aclose()

        await asyncio.wait_for(cancelled.wait(), timeout=1)
        owned_session = self.owned_session_factory.sessions[0]
        self.assertEqual((owned_session.entered, owned_session.exited), (1, 1))
        self.assertTrue(owned_session.closed)
        lease.release.assert_awaited_once()
        self.assertLess(order.index("producer_cancelled"), order.index("lease_released"))

    async def test_unstarted_stream_has_background_lease_release_fallback(self) -> None:
        lease = _Lease()
        with (
            self._billing(lease=lease),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(return_value=_run()),
            ),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            await response.body_iterator.aclose()
            self.assertIsNotNone(response.background)
            await response.background()

        self.assertEqual(self.owned_session_factory.sessions, [])
        lease.release.assert_awaited_once()

    async def test_asgi_disconnect_before_first_chunk_releases_lease_once(self) -> None:
        lease = _Lease()
        operation_started = asyncio.Event()

        async def never_emits(**_kwargs):
            operation_started.set()
            await asyncio.Event().wait()

        with (
            self._billing(lease=lease),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=never_emits),
            ),
        ):
            response = await router_module.start_resume_optimization_stream(
                payload=_start_payload(),
                request=SimpleNamespace(),
                idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                session=_Session(),
                current_user=SimpleNamespace(id=USER_ID),
            )
            sent: list[dict] = []

            async def receive():
                await operation_started.wait()
                return {"type": "http.disconnect"}

            async def send(message):
                sent.append(message)

            scope = {
                "type": "http",
                "asgi": {"version": "3.0", "spec_version": "2.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/resume-optimizations/stream",
                "raw_path": b"/api/resume-optimizations/stream",
                "query_string": b"",
                "root_path": "",
                "headers": [],
                "client": ("127.0.0.1", 1),
                "server": ("testserver", 80),
            }
            await asyncio.wait_for(response(scope, receive, send), timeout=1)

        self.assertFalse(
            any(
                message.get("type") == "http.response.body"
                and message.get("body")
                for message in sent
            )
        )
        owned_session = self.owned_session_factory.sessions[0]
        self.assertEqual((owned_session.entered, owned_session.exited), (1, 1))
        self.assertTrue(owned_session.closed)
        lease.release.assert_awaited_once()

    def test_router_uses_bounded_request_body_route(self) -> None:
        self.assertTrue(router_module.router.routes)
        self.assertTrue(
            all(
                isinstance(route, router_module.BoundedAiRequestBodyRoute)
                for route in router_module.router.routes
            )
        )


if __name__ == "__main__":
    unittest.main()
