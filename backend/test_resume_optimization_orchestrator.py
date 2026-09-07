from __future__ import annotations

from contextlib import contextmanager, ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import asyncio
import httpx
import os
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.ai.runtime_budget import (  # noqa: E402
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
)
from app.domain.ai.public_errors import AiProviderUnavailableError  # noqa: E402
from app.domain.resume_optimization import orchestrator  # noqa: E402
from app.domain.resume_optimization.context_service import (  # noqa: E402
    FrozenOptimizationContext,
    OptimizationContextStaleError,
)
from app.domain.resume_optimization.models import ResumeOptimizationRun  # noqa: E402
from app.domain.resume_optimization.normalizers import (  # noqa: E402
    OptimizationPlanNormalizationError,
)
from app.domain.resume_optimization.planner_service import (  # noqa: E402
    OptimizationAnswerRewriteNormalizationError,
)
from app.domain.resume_optimization import run_service  # noqa: E402
from app.domain.resume_optimization.run_service import (  # noqa: E402
    OptimizationAnswerInProgressError,
    OptimizationAnswerRunClaim,
    OptimizationRunClaim,
)
from app.domain.resume_optimization.schemas import (  # noqa: E402
    BankSuggestion,
    OptimizationAnswer,
    OptimizationAnswerState,
    OptimizationChange,
    OptimizationPlan,
    OptimizationQuestion,
    OptimizationSafetySummary,
    ResumeOptimizationAnswersRequest,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from app.domain.resume_optimization.state_machine import (  # noqa: E402
    InvalidOptimizationTransitionError,
)


USER_ID = "user-a"
RESUME_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
RUN_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
BASE_TIME = datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)


def _start_request(**overrides) -> ResumeOptimizationStartRequest:
    values = {
        "resume_id": str(RESUME_ID),
        "evaluation_signature": "evaluation-signature",
        "expected_resume_updated_at": BASE_TIME,
        "include_bank_suggestions": True,
    }
    values.update(overrides)
    return ResumeOptimizationStartRequest(**values)


def _context(
    *,
    marker: str = "stable",
    bank_candidates: list[dict] | None = None,
) -> FrozenOptimizationContext:
    return FrozenOptimizationContext(
        resume_id=str(RESUME_ID),
        resume_updated_at=BASE_TIME.isoformat(),
        evaluation_signature="evaluation-signature",
        jd_signature="jd-signature",
        target_role=f"Product Manager {marker}",
        evaluation={
            "evaluationVersion": "resume_flow_v1",
            "scoringVersion": "coverage_consensus_v2",
            "overallScore": 72,
            "issues": [{"issueId": "I1"}, {"issueId": "I2"}, {"issueId": "I3"}],
        },
        current_resume={
            "personal_summary": "参与产品交付",
            "experiences": {
                "exp-a": {"star": {"a": "参与支付页面改版", "r": "按期上线"}},
                "exp-b": {"star": {"a": "参与数据平台建设", "r": "按期上线"}},
                "exp-c": {"star": {"a": "参与后台改造", "r": "按期上线"}},
            },
            "skills": [],
            "section_order": ["summary", "experience", "skills"],
        },
        selected_source_experiences={
            "exp-a": {"star": {"a": "参与支付页面改版", "r": "按期上线"}},
            "exp-b": {"star": {"a": "参与数据平台建设", "r": "按期上线"}},
            "exp-c": {"star": {"a": "参与后台改造", "r": "按期上线"}},
        },
        selected_master_experience_ids=["exp-a", "exp-b", "exp-c"],
        selected_experience_links={
            "exp-a": {"resume_link_id": "link-a", "source_version_id": "version-a"},
            "exp-b": {"resume_link_id": "link-b", "source_version_id": "version-b"},
            "exp-c": {"resume_link_id": "link-c", "source_version_id": "version-c"},
        },
        bank_suggestion_candidates=bank_candidates or [],
        fact_metadata=[],
    )


def _change(
    change_id: str = "CHG_1",
    *,
    issue_id: str = "I1",
    module_id: str = "exp-a",
    action_kind: str = "rewrite_now",
    before: str = "参与支付页面改版",
    general: str | None = "参与支付页面改版",
    targeted: str | None = "参与支付页面改版",
    source_refs: list[str] | None = None,
    safety_status: str = "pending",
    safety_findings: list[str] | None = None,
) -> OptimizationChange:
    return OptimizationChange(
        change_id=change_id,
        issue_ids=[issue_id],
        dimension="STAR应用",
        module_type="experience_star",
        module_id=module_id,
        field_path="star.a",
        action_kind=action_kind,
        scope="general",
        before_value=before,
        general_value=general,
        targeted_value=targeted,
        source_refs=(
            source_refs
            if source_refs is not None
            else [f"/currentResume/experiences/{module_id}/star/a"]
        ),
        introduced_terms=[],
        rationale="保持事实边界",
        expected_score_gain=2,
        default_selected=action_kind == "rewrite_now",
        safety_status=safety_status,
        safety_findings=safety_findings or [],
    )


def _ask_change(
    change_id: str,
    *,
    issue_id: str,
    module_id: str,
) -> OptimizationChange:
    before = {
        "exp-a": "参与支付页面改版",
        "exp-b": "参与数据平台建设",
        "exp-c": "参与后台改造",
    }[module_id]
    return _change(
        change_id,
        issue_id=issue_id,
        module_id=module_id,
        action_kind="ask_user",
        before=before,
        general=None,
        targeted=None,
        source_refs=[],
    )


def _question(
    question_id: str,
    *,
    module_id: str,
    affects: list[str],
) -> OptimizationQuestion:
    return OptimizationQuestion(
        question_id=question_id,
        module_id=module_id,
        field_path="star.r",
        text="请补充可确认的事实",
        reason="避免编造",
        choices=[],
        affects_change_ids=affects,
        priority=1,
    )


def _allowed(changes: list[OptimizationChange]):
    verified = [
        change.model_copy(
            update={
                "safety_status": "allowed",
                "safety_findings": [],
            },
            deep=True,
        )
        for change in changes
    ]
    return verified, OptimizationSafetySummary(
        allowed_change_ids=[change.change_id for change in verified]
    )


def _run(
    *,
    status: ResumeOptimizationStatus = ResumeOptimizationStatus.PLANNING,
    context: FrozenOptimizationContext | None = None,
    plan: OptimizationPlan | None = None,
    answers: list[OptimizationAnswer] | None = None,
) -> ResumeOptimizationRun:
    frozen = context or _context()
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
        source_snapshot_hash=frozen.snapshot_hash,
        request_hash="request-hash",
        before_snapshot=frozen.snapshot_payload(),
        plan_json=(plan or OptimizationPlan()).model_dump(mode="json"),
        result_json=(plan or OptimizationPlan()).model_dump(mode="json"),
        answers_json={
            "answers": [answer.model_dump(mode="json") for answer in (answers or [])]
        },
        created_at=BASE_TIME,
        updated_at=BASE_TIME,
    )


class _FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.operations: list[str] = []
        self.flushes = 0
        self.added: list[object] = []
        self.expirations = 0

    async def commit(self) -> None:
        self.commits += 1
        self.operations.append("commit")

    async def rollback(self) -> None:
        self.operations.append("rollback")

    def expire_all(self) -> None:
        self.expirations += 1
        self.operations.append("expire_all")

    def add(self, value: object) -> None:
        self.added.append(value)
        self.operations.append("add")

    async def flush(self) -> None:
        self.flushes += 1
        self.operations.append("flush")


class _ScalarResult:
    def __init__(self, value: object | None) -> None:
        self.value = value

    def first(self):
        return self.value


class _ExecuteResult:
    def __init__(self, value: object | None) -> None:
        self.value = value

    def scalars(self) -> _ScalarResult:
        return _ScalarResult(self.value)


class _ExecuteSession(_FakeSession):
    def __init__(self, value: object | None) -> None:
        super().__init__()
        self.value = value
        self.statements: list[object] = []

    async def execute(self, statement):
        self.statements.append(statement)
        self.operations.append("execute")
        return _ExecuteResult(self.value)


class _RunStore:
    def __init__(
        self,
        run: ResumeOptimizationRun,
        *,
        claimed: bool = True,
        preflight_claim: OptimizationRunClaim | None = None,
    ) -> None:
        self.run = run
        self.claimed = claimed
        self.preflight_claim = preflight_claim
        self.error_calls: list[dict] = []
        self.stale_calls: list[dict] = []

    async def create_or_claim_run(self, session, _user_id, _payload, **kwargs):
        session.operations.append("claim_run")
        self.run.before_snapshot = deepcopy(kwargs["before_snapshot"])
        self.run.source_snapshot_hash = kwargs["source_snapshot_hash"]
        self.run.source_jd_signature = kwargs["source_jd_signature"]
        return OptimizationRunClaim(
            run=self.run.model_copy(deep=True),
            claimed=self.claimed,
        )

    async def complete_planning_run_claim(
        self,
        session,
        _user_id,
        _run_id,
        **kwargs,
    ):
        session.operations.append("complete_planning_claim")
        self.run.plan_json = deepcopy(kwargs["plan_json"])
        self.run.result_json = deepcopy(kwargs["result_json"])
        self.run.error_json = {}
        self.run.status = kwargs["target_status"].value
        return self.run.model_copy(deep=True)

    async def record_planning_run_claim_terminal(
        self,
        session,
        _user_id,
        _run_id,
        **kwargs,
    ):
        session.operations.append("record_planning_terminal")
        error_json = deepcopy(kwargs["error_json"])
        self.run.error_json = error_json
        self.run.status = kwargs["target_status"].value
        if kwargs["target_status"] == ResumeOptimizationStatus.FAILED:
            self.error_calls.append(error_json)
        if kwargs["target_status"] == ResumeOptimizationStatus.STALE:
            self.stale_calls.append(error_json)
        return self.run.model_copy(deep=True)

    async def preflight_idempotent_run(self, session, _user_id, _payload, **_kwargs):
        session.operations.append("preflight")
        return self.preflight_claim

    async def get_run_for_user(self, session, _user_id, _run_id):
        session.operations.append("get_run")
        return self.run.model_copy(deep=True)

    async def lock_run_source_resume(self, session, _user_id, _run_id):
        session.operations.append("lock_source")
        return True

    async def claim_run_for_answers(self, session, _user_id, _run_id, **_kwargs):
        session.operations.append("claim_answers")
        return OptimizationAnswerRunClaim(
            run=self.run.model_copy(deep=True),
            claimed=True,
        )

    async def clear_answer_run_claim(self, session, _user_id, _run_id, **_kwargs):
        session.operations.append("clear_answer_claim")
        return self.run.model_copy(deep=True)

    async def complete_answer_run_claim(
        self,
        session,
        _user_id,
        _run_id,
        **kwargs,
    ):
        session.operations.append("complete_answer_claim")
        self.run.answers_json = deepcopy(kwargs["answers_json"])
        self.run.result_json = deepcopy(kwargs["result_json"])
        self.run.error_json = {}
        self.run.status = ResumeOptimizationStatus.PREVIEW_READY.value
        return self.run.model_copy(deep=True)

    async def record_answer_run_claim_error(
        self,
        session,
        _user_id,
        _run_id,
        **kwargs,
    ):
        session.operations.append("record_answer_claim_error")
        self.run.answers_json = deepcopy(kwargs["answers_json"])
        self.run.error_json = deepcopy(kwargs["error_json"])
        terminal_status = kwargs.get("terminal_status")
        if terminal_status is not None:
            self.run.status = terminal_status.value
        return self.run.model_copy(deep=True)

    async def record_run_error(self, session, _user_id, _run_id, error_json):
        session.operations.append("record_error")
        self.error_calls.append(deepcopy(error_json))
        self.run.error_json = deepcopy(error_json)
        self.run.status = ResumeOptimizationStatus.FAILED.value
        return self.run.model_copy(deep=True)

    async def record_run_stale(self, session, _user_id, _run_id, error_json):
        session.operations.append("record_stale")
        self.stale_calls.append(deepcopy(error_json))
        self.run.error_json = deepcopy(error_json)
        self.run.status = ResumeOptimizationStatus.STALE.value
        return self.run.model_copy(deep=True)


class ResumeOptimizationOrchestratorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from semantic_review_test_support import supported_plan_review
        review_patch = patch.object(orchestrator, "review_plan_semantics", supported_plan_review)
        review_patch.start()
        self.addCleanup(review_patch.stop)

    @contextmanager
    def _patch_store(self, store: _RunStore):
        patches = (
            patch.object(orchestrator, "create_or_claim_run", store.create_or_claim_run),
            patch.object(
                orchestrator,
                "complete_planning_run_claim",
                store.complete_planning_run_claim,
            ),
            patch.object(
                orchestrator,
                "record_planning_run_claim_terminal",
                store.record_planning_run_claim_terminal,
            ),
            patch.object(
                orchestrator,
                "preflight_idempotent_run",
                store.preflight_idempotent_run,
            ),
            patch.object(orchestrator, "get_run_for_user", store.get_run_for_user),
            patch.object(
                orchestrator,
                "lock_run_source_resume",
                store.lock_run_source_resume,
            ),
            patch.object(
                orchestrator,
                "claim_run_for_answers",
                store.claim_run_for_answers,
            ),
            patch.object(
                orchestrator,
                "clear_answer_run_claim",
                store.clear_answer_run_claim,
            ),
            patch.object(
                orchestrator,
                "complete_answer_run_claim",
                store.complete_answer_run_claim,
            ),
            patch.object(
                orchestrator,
                "record_answer_run_claim_error",
                store.record_answer_run_claim_error,
            ),
            patch.object(orchestrator, "record_run_error", store.record_run_error),
            patch.object(orchestrator, "record_run_stale", store.record_run_stale),
        )
        with ExitStack() as stack:
            for store_patch in patches:
                stack.enter_context(store_patch)
            yield

    async def test_valid_no_question_plan_becomes_preview_ready(self) -> None:
        context = _context()
        plan = OptimizationPlan(changes=[_change()])
        store = _RunStore(_run(context=context))
        session = _FakeSession()
        events: list[dict] = []

        async def progress(event: dict) -> None:
            events.append(event)

        async def plan_without_transaction(_context):
            session.operations.append("planner")
            return plan

        context_build_count = 0

        async def build_context_with_final_lock(*_args):
            nonlocal context_build_count
            context_build_count += 1
            if context_build_count == 2:
                session.operations.append("freshness_rebuild")
            return context

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=build_context_with_final_lock),
            ),
            patch.object(
                orchestrator,
                "plan_resume_optimization",
                AsyncMock(side_effect=plan_without_transaction),
            ),
            patch.object(
                orchestrator, "verify_plan_changes", return_value=_allowed(plan.changes)
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="request-001"),
        ):
            result = await orchestrator.create_optimization_plan(
                session=session,
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key="idem-1",
                progress_callback=progress,
            )

        self.assertEqual(result.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        self.assertEqual(
            [event["node"] for event in events],
            [
                "freeze_snapshot",
                "prepare_context",
                "plan_changes",
                "verify_changes",
                "persist_run",
            ],
        )
        self.assertEqual({event["requestId"] for event in events}, {"request-001"})
        self.assertEqual(result.result_json["changes"][0]["change_id"], "CHG_1")
        self.assertLess(
            session.operations.index("commit"),
            session.operations.index("planner"),
        )
        self.assertEqual(
            session.operations[-2:],
            ["complete_planning_claim", "commit"],
        )
        self.assertLess(
            session.operations.index("lock_source"),
            session.operations.index("freshness_rebuild"),
        )
        self.assertLess(
            session.operations.index("freshness_rebuild"),
            session.operations.index("complete_planning_claim"),
        )

    async def test_idempotent_existing_planning_run_never_calls_ai_again(self) -> None:
        context = _context()
        existing = _run(
            status=ResumeOptimizationStatus.PLANNING,
            context=context,
        )
        store = _RunStore(
            existing,
            claimed=False,
            preflight_claim=OptimizationRunClaim(
                run=existing.model_copy(deep=True),
                claimed=False,
            ),
        )
        planner = AsyncMock()
        verify = Mock()
        session = _FakeSession()
        context_builder = AsyncMock(side_effect=AssertionError("must not rebuild"))

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                context_builder,
            ),
            patch.object(orchestrator, "plan_resume_optimization", planner),
            patch.object(orchestrator, "verify_plan_changes", verify),
        ):
            result = await orchestrator.create_optimization_plan(
                session=session,
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key="same-key",
            )

        self.assertEqual(result.status, ResumeOptimizationStatus.PLANNING.value)
        planner.assert_not_awaited()
        verify.assert_not_called()
        context_builder.assert_not_awaited()
        self.assertEqual(session.operations, ["preflight", "commit"])

    async def test_plan_with_questions_becomes_awaiting_answers(self) -> None:
        context = _context()
        plan = OptimizationPlan(
            changes=[_ask_change("CHG_1", issue_id="I1", module_id="exp-a")],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(_run(context=context))

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[context, context]),
            ),
            patch.object(
                orchestrator, "plan_resume_optimization", AsyncMock(return_value=plan)
            ),
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    plan.changes,
                    OptimizationSafetySummary(pending_change_ids=["CHG_1"]),
                ),
            ),
        ):
            result = await orchestrator.create_optimization_plan(
                session=_FakeSession(),
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key=None,
            )

        self.assertEqual(result.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(result.result_json["questions"][0]["question_id"], "Q1")

    async def test_blocked_changes_remain_in_result_for_ui_explanation(self) -> None:
        context = _context()
        plan = OptimizationPlan(changes=[_change()])
        blocked = _change(
            general="参与支付页面改版",
            targeted="参与支付页面改版",
            safety_status="blocked",
            safety_findings=["候选文本引入了无来源数字"],
        )
        store = _RunStore(_run(context=context))

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[context, context]),
            ),
            patch.object(
                orchestrator, "plan_resume_optimization", AsyncMock(return_value=plan)
            ),
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    [blocked],
                    OptimizationSafetySummary(
                        blocked_change_ids=["CHG_1"],
                        findings=["CHG_1：候选文本引入了无来源数字"],
                    ),
                ),
            ),
        ):
            result = await orchestrator.create_optimization_plan(
                session=_FakeSession(),
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key=None,
            )

        persisted = OptimizationPlan.model_validate(result.result_json)
        self.assertEqual(len(persisted.changes), 1)
        self.assertEqual(persisted.changes[0].safety_status, "blocked")
        self.assertEqual(
            persisted.changes[0].safety_findings,
            ["候选文本引入了无来源数字"],
        )

    async def test_bank_suggestions_are_added_after_model_planning(self) -> None:
        context = _context(
            bank_candidates=[
                {
                    "master_experience_id": "bank-a",
                    "category": "project",
                    "title": "增长项目",
                    "org": "Acme",
                    "match_score": 91,
                    "reason": "补充增长证据",
                }
            ]
        )
        model_plan = OptimizationPlan(changes=[_change()])
        store = _RunStore(_run(context=context))
        built_suggestion = BankSuggestion(
            suggestion_id="BANK_001",
            master_experience_id="bank-a",
            category="project",
            title="增长项目",
            org="Acme",
            match_score=91,
            reason="补充增长证据",
        )

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[context, context]),
            ),
            patch.object(
                orchestrator,
                "plan_resume_optimization",
                AsyncMock(return_value=model_plan),
            ) as planner,
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=_allowed(model_plan.changes),
            ),
            patch.object(
                orchestrator,
                "build_bank_suggestions",
                return_value=[built_suggestion],
            ) as build_suggestions,
        ):
            result = await orchestrator.create_optimization_plan(
                session=_FakeSession(),
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key=None,
            )

        self.assertEqual(planner.await_args.args[0].bank_suggestion_candidates, context.bank_suggestion_candidates)
        self.assertEqual(model_plan.bank_suggestions, [])
        build_suggestions.assert_called_once()
        persisted = OptimizationPlan.model_validate(result.result_json)
        self.assertEqual(
            [item.master_experience_id for item in persisted.bank_suggestions],
            ["bank-a"],
        )

    async def test_exception_records_failed_with_safe_terminal_runtime_metadata(self) -> None:
        context = _context()
        store = _RunStore(_run(context=context))
        session = _FakeSession()
        terminal_error = AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(
                orchestrator,
                "plan_resume_optimization",
                AsyncMock(side_effect=terminal_error),
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="request-timeout"),
        ):
            with self.assertRaises(AiRuntimeTimeoutError) as raised:
                await orchestrator.create_optimization_plan(
                    session=session,
                    user_id=USER_ID,
                    payload=_start_request(),
                    idempotency_key=None,
                )

        self.assertIs(raised.exception, terminal_error)
        self.assertEqual(store.run.status, ResumeOptimizationStatus.FAILED.value)
        self.assertEqual(store.error_calls[0]["code"], "ai_runtime_timeout")
        self.assertEqual(store.error_calls[0]["requestId"], "request-timeout")
        self.assertEqual(
            store.error_calls[0]["message"], AiRuntimeTimeoutError.public_message
        )
        self.assertNotIn("AiRuntimeTimeoutError", str(store.error_calls[0]))
        self.assertGreaterEqual(session.commits, 2)

    async def test_context_becoming_stale_before_persistence_records_stale(self) -> None:
        context = _context()
        plan = OptimizationPlan(changes=[_change()])
        store = _RunStore(_run(context=context))
        session = _FakeSession()
        stale_error = OptimizationContextStaleError(
            "Resume changed while the optimization plan was generated"
        )

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[context, stale_error]),
            ),
            patch.object(
                orchestrator, "plan_resume_optimization", AsyncMock(return_value=plan)
            ),
            patch.object(
                orchestrator, "verify_plan_changes", return_value=_allowed(plan.changes)
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="request-stale"),
        ):
            with self.assertRaises(OptimizationContextStaleError) as raised:
                await orchestrator.create_optimization_plan(
                    session=session,
                    user_id=USER_ID,
                    payload=_start_request(),
                    idempotency_key=None,
                )

        self.assertIs(raised.exception, stale_error)
        self.assertEqual(store.run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(
            store.stale_calls[0]["code"], "resume_optimization_context_stale"
        )
        self.assertEqual(store.stale_calls[0]["requestId"], "request-stale")
        self.assertGreaterEqual(session.commits, 2)

    async def test_submitted_answers_only_replace_affected_changes(self) -> None:
        context = _context(
            bank_candidates=[
                {
                    "master_experience_id": "frozen-bank",
                    "category": "project",
                    "title": "Frozen",
                    "org": "Frozen Org",
                    "match_score": 80,
                    "reason": "frozen suggestion",
                }
            ]
        )
        current_server_context = _context(
            bank_candidates=[
                {
                    "master_experience_id": "live-bank",
                    "category": "project",
                    "title": "Live",
                    "org": "Live Org",
                    "match_score": 99,
                    "reason": "live suggestion",
                }
            ]
        )
        first = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        unaffected = _change(
            "CHG_2",
            issue_id="I2",
            module_id="exp-b",
            before="参与数据平台建设",
            general="参与数据平台建设",
            targeted="参与数据平台建设",
        ).model_copy(
            update={
                "safety_status": "blocked",
                "default_selected": False,
                "safety_findings": ["既有阻断原因必须保留"],
            }
        )
        plan = OptimizationPlan(
            changes=[first, unaffected],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        rewritten = _change(
            "CHG_1",
            issue_id="I1",
            module_id="exp-a",
            general="完成已确认的两个支付页面改版",
            targeted="完成已确认的两个支付页面改版",
            source_refs=[
                "/currentResume/experiences/exp-a/star/a",
                "/userAnswers/Q1/value",
            ],
        )
        verified_rewrite = rewritten.model_copy(update={"safety_status": "allowed"})
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        answer = OptimizationAnswer(
            question_id="Q1",
            state=OptimizationAnswerState.ANSWERED,
            value="负责其中两个页面",
        )

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(
                    side_effect=[current_server_context, current_server_context]
                ),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(return_value=[rewritten]),
            ) as rewrite,
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    [verified_rewrite],
                    OptimizationSafetySummary(allowed_change_ids=["CHG_1"]),
                ),
            ) as verify,
        ):
            result = await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(answers=[answer]),
            )

        self.assertEqual(rewrite.await_count, 1)
        rewrite_context = rewrite.await_args.kwargs["context"]
        self.assertEqual(
            rewrite_context.bank_suggestion_candidates,
            context.bank_suggestion_candidates,
        )
        self.assertNotEqual(
            rewrite_context.bank_suggestion_candidates,
            current_server_context.bank_suggestion_candidates,
        )
        source_documents = verify.call_args.kwargs["source_documents"]
        self.assertEqual(
            source_documents["userAnswers"]["Q1"],
            {"state": "answered", "value": "负责其中两个页面"},
        )
        persisted = OptimizationPlan.model_validate(result.result_json)
        by_id = {change.change_id: change for change in persisted.changes}
        self.assertEqual(by_id["CHG_1"].general_value, rewritten.general_value)
        self.assertEqual(
            by_id["CHG_2"].model_dump(mode="json"),
            unaffected.model_dump(mode="json"),
        )
        self.assertEqual(by_id["CHG_2"].safety_status, "blocked")
        self.assertEqual(by_id["CHG_2"].safety_findings, ["既有阻断原因必须保留"])

    async def test_unanswered_questions_remain_unresolved(self) -> None:
        context = _context()
        first = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        second = _ask_change("CHG_2", issue_id="I2", module_id="exp-b")
        questions = [
            _question("Q1", module_id="exp-a", affects=["CHG_1"]),
            _question("Q2", module_id="exp-b", affects=["CHG_2"]),
        ]
        plan = OptimizationPlan(changes=[first, second], questions=questions)
        resolved = _change(
            "CHG_1",
            issue_id="I1",
            module_id="exp-a",
            general="完成已确认的支付页面工作",
            targeted="完成已确认的支付页面工作",
            source_refs=["/userAnswers/Q1/value"],
        )
        verified = resolved.model_copy(update={"safety_status": "allowed"})
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        answer = OptimizationAnswer(
            question_id="Q1",
            state=OptimizationAnswerState.ANSWERED,
            value="确认是本人负责",
        )

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(return_value=[resolved]),
            ),
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    [verified],
                    OptimizationSafetySummary(allowed_change_ids=["CHG_1"]),
                ),
            ),
        ):
            result = await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(answers=[answer]),
            )

        persisted = OptimizationPlan.model_validate(result.result_json)
        self.assertEqual(result.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        self.assertEqual([item.question_id for item in persisted.questions], ["Q1", "Q2"])
        unresolved = next(
            change for change in persisted.changes if change.change_id == "CHG_2"
        )
        self.assertEqual(unresolved.action_kind.value, "ask_user")
        self.assertEqual(unresolved.safety_status, "pending")
        self.assertNotIn("Q2", {item["question_id"] for item in result.answers_json["answers"]})

    async def test_no_data_and_not_my_work_never_rewrite_unrelated_modules(self) -> None:
        context = _context()
        allowed = _ask_change("CHG_1", issue_id="I1", module_id="exp-a").model_copy(
            update={
                "general_value": "参与支付页面改版并按期上线",
                "targeted_value": "参与支付页面改版并按期上线",
                "source_refs": ["/currentResume/experiences/exp-a/star/a"],
                "default_selected": True,
                "safety_status": "allowed",
            }
        )
        blocked = _ask_change("CHG_2", issue_id="I2", module_id="exp-b").model_copy(
            update={
                "general_value": "主导数据平台建设",
                "targeted_value": "主导数据平台建设",
                "source_refs": ["/currentResume/experiences/exp-b/star/a"],
                "safety_status": "blocked",
                "safety_findings": ["责任等级超过来源"],
            }
        )
        pending = _ask_change("CHG_3", issue_id="I3", module_id="exp-c")
        unrelated = _ask_change("CHG_4", issue_id="I4", module_id="exp-c")
        plan = OptimizationPlan(
            changes=[allowed, blocked, pending, unrelated],
            questions=[
                _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                _question("Q2", module_id="exp-b", affects=["CHG_2"]),
                _question("Q3", module_id="exp-c", affects=["CHG_3"]),
                _question("Q4", module_id="exp-c", affects=["CHG_4"]),
            ],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        answers = [
            OptimizationAnswer(question_id="Q1", state="no_data", value=""),
            OptimizationAnswer(question_id="Q2", state="not_my_work", value=""),
            OptimizationAnswer(question_id="Q3", state="skipped", value=""),
        ]

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(),
            ) as rewrite,
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=([], OptimizationSafetySummary()),
            ) as verify,
        ):
            result = await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(answers=answers),
            )

        self.assertEqual(rewrite.await_count, 0)
        verify.assert_not_called()
        persisted = OptimizationPlan.model_validate(result.result_json)
        by_id = {change.change_id: change for change in persisted.changes}
        self.assertEqual(
            by_id["CHG_1"].model_dump(mode="json"),
            allowed.model_dump(mode="json"),
        )
        self.assertEqual(
            by_id["CHG_2"].model_dump(mode="json"),
            blocked.model_dump(mode="json"),
        )
        self.assertEqual(by_id["CHG_3"].action_kind.value, "leave_unchanged")
        self.assertIsNone(by_id["CHG_3"].general_value)
        self.assertEqual(
            by_id["CHG_4"].model_dump(mode="json"),
            unrelated.model_dump(mode="json"),
        )

    async def test_answer_timeout_keeps_retryable_awaiting_run_and_answer_draft(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        session = _FakeSession()
        answer = OptimizationAnswer(
            question_id="Q1",
            state=OptimizationAnswerState.ANSWERED,
            value="本人负责两个页面",
        )
        timeout = AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=_context()),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(side_effect=timeout),
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="answer-timeout"),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await orchestrator.answer_optimization_questions(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(answers=[answer]),
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(store.error_calls, [])
        self.assertEqual(store.run.error_json["code"], "ai_runtime_timeout")
        self.assertEqual(store.run.error_json["requestId"], "answer-timeout")
        self.assertEqual(store.run.answers_json["answers"][0]["question_id"], "Q1")
        self.assertNotIn("transition_run", session.operations)

    async def test_answer_rewrite_contract_failure_keeps_retryable_run_and_answer_draft(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        answer = OptimizationAnswer(
            question_id="Q1",
            state=OptimizationAnswerState.ANSWERED,
            value="本人负责两个页面",
        )
        failure = OptimizationAnswerRewriteNormalizationError()

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=_context()),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(side_effect=failure),
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="answer-contract"),
        ):
            with self.assertRaises(OptimizationAnswerRewriteNormalizationError):
                await orchestrator.answer_optimization_questions(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(answers=[answer]),
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(store.run.error_json["code"], "resume_optimization_plan_invalid")
        self.assertEqual(store.run.error_json["requestId"], "answer-contract")
        self.assertTrue(store.run.error_json["retryable"])
        self.assertEqual(store.run.answers_json["answers"][0]["question_id"], "Q1")

    async def test_cancelled_planning_propagates_without_reclassifying_run(self) -> None:
        context = _context()
        store = _RunStore(_run(context=context))
        session = _FakeSession()

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=context),
            ),
            patch.object(
                orchestrator,
                "plan_resume_optimization",
                AsyncMock(side_effect=asyncio.CancelledError()),
            ),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await orchestrator.create_optimization_plan(
                    session=session,
                    user_id=USER_ID,
                    payload=_start_request(),
                    idempotency_key=None,
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.CANCELLED.value)
        self.assertEqual(store.error_calls, [])
        self.assertEqual(
            session.operations,
            [
                "claim_run",
                "commit",
                "rollback",
                "record_planning_terminal",
                "commit",
            ],
        )

    async def test_sync_progress_callback_is_supported(self) -> None:
        context = _context()
        plan = OptimizationPlan(changes=[_change()])
        store = _RunStore(_run(context=context))
        events: list[dict] = []

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[context, context]),
            ),
            patch.object(
                orchestrator, "plan_resume_optimization", AsyncMock(return_value=plan)
            ),
            patch.object(
                orchestrator, "verify_plan_changes", return_value=_allowed(plan.changes)
            ),
        ):
            await orchestrator.create_optimization_plan(
                session=_FakeSession(),
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key=None,
                progress_callback=lambda event: events.append(event),
            )

        self.assertEqual(len(events), 5)

    async def test_mixed_same_change_answers_use_only_linked_answered_source(self) -> None:
        context = _context()
        shared = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[shared],
            questions=[
                _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                _question("Q2", module_id="exp-a", affects=["CHG_1"]),
            ],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        rewritten = _change(
            "CHG_1",
            issue_id="I1",
            module_id="exp-a",
            general="完成两个页面工作",
            targeted="完成两个页面工作",
            source_refs=["/userAnswers/Q1/value"],
        )
        rewrite = AsyncMock(return_value=[rewritten])

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(orchestrator, "rewrite_answered_modules", rewrite),
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    [rewritten.model_copy(update={"safety_status": "allowed"})],
                    OptimizationSafetySummary(allowed_change_ids=["CHG_1"]),
                ),
            ),
        ):
            result = await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="answered",
                            value="负责两个页面",
                        ),
                        OptimizationAnswer(
                            question_id="Q2",
                            state="not_my_work",
                            value="",
                        ),
                    ]
                ),
            )

        self.assertEqual(
            [answer.question_id for answer in rewrite.await_args.kwargs["answers"]],
            ["Q1", "Q2"],
        )
        persisted = OptimizationPlan.model_validate(result.result_json)
        self.assertEqual(persisted.changes[0].action_kind.value, "rewrite_now")
        self.assertEqual(persisted.changes[0].general_value, "完成两个页面工作")

    async def test_omitted_same_change_question_keeps_original_unresolved(self) -> None:
        context = _context()
        shared = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[shared],
            questions=[
                _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                _question("Q2", module_id="exp-a", affects=["CHG_1"]),
            ],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        rewrite = AsyncMock()

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(orchestrator, "rewrite_answered_modules", rewrite),
        ):
            result = await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(
                    answers=[
                        OptimizationAnswer(
                            question_id="Q1",
                            state="answered",
                            value="负责两个页面",
                        )
                    ]
                ),
            )

        rewrite.assert_not_awaited()
        persisted = OptimizationPlan.model_validate(result.result_json)
        self.assertEqual(
            persisted.changes[0].model_dump(mode="json"),
            shared.model_dump(mode="json"),
        )
        self.assertNotIn(
            "Q2",
            {answer["question_id"] for answer in result.answers_json["answers"]},
        )

    async def test_retry_processes_historical_answer_draft_with_new_answer(self) -> None:
        context = _context()
        first = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        second = _ask_change("CHG_2", issue_id="I2", module_id="exp-b")
        plan = OptimizationPlan(
            changes=[first, second],
            questions=[
                _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                _question("Q2", module_id="exp-b", affects=["CHG_2"]),
            ],
        )
        historical = OptimizationAnswer(
            question_id="Q1",
            state="answered",
            value="负责两个页面",
        )
        submitted = OptimizationAnswer(
            question_id="Q2",
            state="answered",
            value="负责数据平台交付",
        )
        rewrites = [
            _change(
                "CHG_1",
                issue_id="I1",
                module_id="exp-a",
                general="完成两个页面工作",
                targeted="完成两个页面工作",
                source_refs=["/userAnswers/Q1/value"],
            ),
            _change(
                "CHG_2",
                issue_id="I2",
                module_id="exp-b",
                before="参与数据平台建设",
                general="完成数据平台交付工作",
                targeted="完成数据平台交付工作",
                source_refs=["/userAnswers/Q2/value"],
            ),
        ]
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
                answers=[historical],
            )
        )

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(side_effect=[_context(), _context()]),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(return_value=rewrites),
            ) as rewrite,
            patch.object(
                orchestrator,
                "verify_plan_changes",
                return_value=(
                    [
                        change.model_copy(update={"safety_status": "allowed"})
                        for change in rewrites
                    ],
                    OptimizationSafetySummary(
                        allowed_change_ids=["CHG_1", "CHG_2"]
                    ),
                ),
            ) as verify,
        ):
            await orchestrator.answer_optimization_questions(
                session=_FakeSession(),
                user_id=USER_ID,
                run_id=str(RUN_ID),
                payload=ResumeOptimizationAnswersRequest(answers=[submitted]),
            )

        self.assertEqual(
            [item.question_id for item in rewrite.await_args.kwargs["answers"]],
            ["Q1", "Q2"],
        )
        self.assertEqual(
            set(verify.call_args.kwargs["source_documents"]["userAnswers"]),
            {"Q1", "Q2"},
        )

    async def test_unknown_question_is_typed_request_error_and_keeps_awaiting(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        session = _FakeSession()

        with self._patch_store(store):
            with self.assertRaises(orchestrator.OptimizationAnswerValidationError) as raised:
                await orchestrator.answer_optimization_questions(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(
                        answers=[
                            OptimizationAnswer(
                                question_id="Q-unknown",
                                state="answered",
                                value="fact",
                            )
                        ]
                    ),
                )

        self.assertEqual(raised.exception.code, "resume_optimization_answers_invalid")
        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(store.error_calls, [])
        self.assertNotIn("claim_answers", session.operations)

    async def test_busy_answer_claim_is_typed_conflict_and_calls_zero_ai(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        busy = OptimizationAnswerInProgressError()
        rewrite = AsyncMock()

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "claim_run_for_answers",
                AsyncMock(side_effect=busy),
            ),
            patch.object(orchestrator, "rewrite_answered_modules", rewrite),
        ):
            with self.assertRaises(OptimizationAnswerInProgressError) as raised:
                await orchestrator.answer_optimization_questions(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(
                        answers=[
                            OptimizationAnswer(
                                question_id="Q1",
                                state="answered",
                                value="fact",
                            )
                        ]
                    ),
                )

        self.assertIs(raised.exception, busy)
        rewrite.assert_not_awaited()
        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)

    async def test_answer_claim_flush_failure_rolls_back_and_preserves_original_error(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        session = _FakeSession()
        flush_error = RuntimeError("claim flush failed")

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "claim_run_for_answers",
                AsyncMock(side_effect=flush_error),
            ),
        ):
            with self.assertRaises(RuntimeError) as raised:
                await orchestrator.answer_optimization_questions(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(
                        answers=[
                            OptimizationAnswer(
                                question_id="Q1",
                                state="answered",
                                value="fact",
                            )
                        ]
                    ),
                )

        self.assertIs(raised.exception, flush_error)
        self.assertEqual(session.operations[-1], "rollback")
        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)

    async def test_reclaimed_planning_cancel_during_progress_terminalizes_owner(self) -> None:
        context = _context()
        reclaimed = _run(status=ResumeOptimizationStatus.PLANNING, context=context)
        store = _RunStore(
            reclaimed,
            preflight_claim=OptimizationRunClaim(
                run=reclaimed.model_copy(deep=True),
                claimed=True,
            ),
        )

        def cancel_progress(_event):
            raise asyncio.CancelledError()

        with self._patch_store(store):
            with self.assertRaises(asyncio.CancelledError):
                await orchestrator.create_optimization_plan(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    payload=_start_request(),
                    idempotency_key="reclaimed",
                    progress_callback=cancel_progress,
                    request_id="reclaim-owner",
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.CANCELLED.value)

    async def test_corrupt_persisted_snapshot_records_safe_failed_state(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        broken = _run(
            status=ResumeOptimizationStatus.AWAITING_ANSWERS,
            context=context,
            plan=plan,
        )
        broken.before_snapshot.pop("current_resume")
        store = _RunStore(broken)

        with (
            self._patch_store(store),
            patch.object(orchestrator, "new_ai_request_id", return_value="corrupt-run"),
        ):
            with self.assertRaises(OptimizationPlanNormalizationError):
                await orchestrator.answer_optimization_questions(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(),
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.FAILED.value)
        self.assertEqual(store.run.error_json["code"], "internal_error")
        self.assertEqual(store.run.error_json["requestId"], "corrupt-run")

    async def test_legacy_awaiting_answers_snapshot_becomes_stale_without_ai(self) -> None:
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        legacy = _run(
            status=ResumeOptimizationStatus.AWAITING_ANSWERS,
            plan=plan,
        )
        legacy.before_snapshot.pop("evaluation_signature_schema")
        original_answers = deepcopy(legacy.answers_json)
        store = _RunStore(legacy)
        session = _FakeSession()

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(),
            ) as rewrite,
        ):
            with self.assertRaises(OptimizationContextStaleError) as caught:
                await orchestrator.answer_optimization_questions(
                    session=session,
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(
                        answers=[
                            OptimizationAnswer(
                                question_id="Q1",
                                state="answered",
                                value="must not persist",
                            )
                        ]
                    ),
                    request_id="legacy-answer",
                )

        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(store.run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(store.run.answers_json, original_answers)
        self.assertEqual(store.stale_calls[0]["code"], "resume_optimization_context_stale")
        self.assertNotIn("claim_answers", session.operations)
        rewrite.assert_not_awaited()

    async def test_nonretryable_runtime_error_does_not_freeze_submitted_answer(self) -> None:
        context = _context()
        pending = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        plan = OptimizationPlan(
            changes=[pending],
            questions=[_question("Q1", module_id="exp-a", affects=["CHG_1"])],
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
            )
        )
        over_budget = AiRuntimeBudgetExceeded(AiRuntimeBudgetExceeded.public_message)

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=_context()),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(side_effect=over_budget),
            ),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await orchestrator.answer_optimization_questions(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(
                        answers=[
                            OptimizationAnswer(
                                question_id="Q1",
                                state="answered",
                                value="new answer",
                            )
                        ]
                    ),
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(store.run.answers_json["answers"], [])
        self.assertEqual(store.run.error_json["code"], "ai_runtime_budget_exceeded")

    async def test_provider_unavailable_retains_answers_and_awaiting_state_for_retry(self) -> None:
        context = _context()
        first = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
        second = _ask_change(
            "CHG_2",
            issue_id="I2",
            module_id="exp-b",
        )
        plan = OptimizationPlan(
            changes=[first, second],
            questions=[
                _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                _question("Q2", module_id="exp-b", affects=["CHG_2"]),
            ],
        )
        historical = OptimizationAnswer(
            question_id="Q1",
            state="answered",
            value="本人负责两个页面",
        )
        submitted = OptimizationAnswer(
            question_id="Q2",
            state="answered",
            value="本人负责数据平台交付",
        )
        store = _RunStore(
            _run(
                status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                context=context,
                plan=plan,
                answers=[historical],
            )
        )
        frozen_snapshot = deepcopy(store.run.before_snapshot)
        provider_error = AiProviderUnavailableError("private upstream failure")

        with (
            self._patch_store(store),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=_context()),
            ),
            patch.object(
                orchestrator,
                "rewrite_answered_modules",
                AsyncMock(side_effect=provider_error),
            ),
            patch.object(orchestrator, "new_ai_request_id", return_value="provider-retry"),
        ):
            with self.assertRaises(AiProviderUnavailableError):
                await orchestrator.answer_optimization_questions(
                    session=_FakeSession(),
                    user_id=USER_ID,
                    run_id=str(RUN_ID),
                    payload=ResumeOptimizationAnswersRequest(answers=[submitted]),
                )

        self.assertEqual(store.run.status, ResumeOptimizationStatus.AWAITING_ANSWERS.value)
        self.assertEqual(store.run.before_snapshot, frozen_snapshot)
        self.assertEqual(
            [item["question_id"] for item in store.run.answers_json["answers"]],
            ["Q1", "Q2"],
        )
        self.assertEqual(store.run.answers_json["answers"][0]["value"], historical.value)
        self.assertEqual(store.run.answers_json["answers"][1]["value"], submitted.value)
        self.assertEqual(store.run.error_json["code"], "ai_provider_unavailable")
        self.assertEqual(store.run.error_json["requestId"], "provider-retry")
        self.assertTrue(store.run.error_json["retryable"])

    async def test_http_transport_failures_retain_merged_answers_for_retry(self) -> None:
        request = httpx.Request("POST", "https://provider.example/v1/generate")
        failures = (
            httpx.ConnectError("private connect failure", request=request),
            httpx.HTTPStatusError(
                "private rate limit body",
                request=request,
                response=httpx.Response(429, request=request),
            ),
            httpx.HTTPStatusError(
                "private provider failure body",
                request=request,
                response=httpx.Response(503, request=request),
            ),
        )
        for provider_error in failures:
            with self.subTest(error=type(provider_error).__name__):
                context = _context()
                first = _ask_change("CHG_1", issue_id="I1", module_id="exp-a")
                second = _ask_change("CHG_2", issue_id="I2", module_id="exp-b")
                plan = OptimizationPlan(
                    changes=[first, second],
                    questions=[
                        _question("Q1", module_id="exp-a", affects=["CHG_1"]),
                        _question("Q2", module_id="exp-b", affects=["CHG_2"]),
                    ],
                )
                historical = OptimizationAnswer(
                    question_id="Q1",
                    state="answered",
                    value="本人负责两个页面",
                )
                submitted = OptimizationAnswer(
                    question_id="Q2",
                    state="answered",
                    value="本人负责数据平台交付",
                )
                store = _RunStore(
                    _run(
                        status=ResumeOptimizationStatus.AWAITING_ANSWERS,
                        context=context,
                        plan=plan,
                        answers=[historical],
                    )
                )
                frozen_snapshot = deepcopy(store.run.before_snapshot)

                with (
                    self._patch_store(store),
                    patch.object(
                        orchestrator,
                        "build_frozen_optimization_context",
                        AsyncMock(return_value=_context()),
                    ),
                    patch.object(
                        orchestrator,
                        "rewrite_answered_modules",
                        AsyncMock(side_effect=provider_error),
                    ),
                    patch.object(
                        orchestrator,
                        "new_ai_request_id",
                        return_value="transport-retry",
                    ),
                ):
                    with self.assertRaises(type(provider_error)):
                        await orchestrator.answer_optimization_questions(
                            session=_FakeSession(),
                            user_id=USER_ID,
                            run_id=str(RUN_ID),
                            payload=ResumeOptimizationAnswersRequest(
                                answers=[submitted]
                            ),
                        )

                self.assertEqual(
                    store.run.status,
                    ResumeOptimizationStatus.AWAITING_ANSWERS.value,
                )
                self.assertEqual(store.run.before_snapshot, frozen_snapshot)
                self.assertEqual(
                    [item["question_id"] for item in store.run.answers_json["answers"]],
                    ["Q1", "Q2"],
                )
                self.assertEqual(
                    store.run.error_json,
                    {
                        "type": "error",
                        "code": "ai_provider_unavailable",
                        "message": "AI provider is temporarily unavailable. Please retry.",
                        "requestId": "transport-retry",
                        "statusCode": 503,
                        "retryable": True,
                    },
                )


class ResumeOptimizationRunServiceTask9Tests(unittest.IsolatedAsyncioTestCase):
    async def test_locking_run_query_forces_populate_existing(self) -> None:
        stored = _run(status=ResumeOptimizationStatus.AWAITING_ANSWERS)
        session = _ExecuteSession(stored)

        result = await run_service._find_run_by_id(
            session,
            user_id=USER_ID,
            run_id=stored.id,
            for_update=True,
        )

        self.assertIs(result, stored)
        self.assertTrue(
            session.statements[0].get_execution_options().get("populate_existing")
        )

    async def test_source_lock_expires_identity_map_and_forces_fresh_resume(self) -> None:
        stored = _run(status=ResumeOptimizationStatus.PLANNING)
        session = _ExecuteSession(object())

        with patch.object(
            run_service,
            "_require_run_by_id",
            AsyncMock(return_value=stored),
        ):
            found = await run_service.lock_run_source_resume(
                session,
                USER_ID,
                str(stored.id),
            )

        self.assertTrue(found)
        self.assertEqual(session.expirations, 1)
        self.assertEqual(session.operations[:2], ["expire_all", "execute"])
        self.assertTrue(
            session.statements[0].get_execution_options().get("populate_existing")
        )

    async def test_create_or_claim_marks_existing_planning_run_unclaimed(self) -> None:
        request = _start_request()
        existing = _run(status=ResumeOptimizationStatus.PLANNING)
        existing.request_hash = run_service.build_start_request_hash(request)

        with patch.object(
            run_service,
            "_find_run_by_idempotency_hash",
            AsyncMock(return_value=existing),
        ):
            claim = await run_service.create_or_claim_run(
                _FakeSession(),
                USER_ID,
                request,
                idempotency_key="same-key",
                source_snapshot_hash="ignored-for-existing",
            )

        self.assertFalse(claim.claimed)
        self.assertEqual(claim.run.id, existing.id)
        self.assertEqual(claim.run.status, ResumeOptimizationStatus.PLANNING.value)

    async def test_preflight_returns_active_run_and_reclaims_expired_planning(self) -> None:
        request = _start_request()
        active = _run(status=ResumeOptimizationStatus.PLANNING)
        active.request_hash = run_service.build_start_request_hash(request)
        active.updated_at = BASE_TIME
        active_session = _ExecuteSession(active)

        with patch.object(
            run_service,
            "utc_now_aware",
            return_value=BASE_TIME + timedelta(minutes=1),
        ):
            active_claim = await run_service.preflight_idempotent_run(
                active_session,
                USER_ID,
                request,
                idempotency_key="same-key",
            )

        self.assertIsNotNone(active_claim)
        self.assertFalse(active_claim.claimed)
        self.assertEqual(active_session.flushes, 0)
        self.assertTrue(
            active_session.statements[0]
            .get_execution_options()
            .get("populate_existing")
        )

        expired = _run(status=ResumeOptimizationStatus.PLANNING)
        expired.request_hash = run_service.build_start_request_hash(request)
        expired.updated_at = BASE_TIME - timedelta(hours=1)
        expired_session = _ExecuteSession(expired)
        reclaimed_at = BASE_TIME + timedelta(minutes=1)
        with patch.object(
            run_service,
            "utc_now_aware",
            return_value=reclaimed_at,
        ):
            expired_claim = await run_service.preflight_idempotent_run(
                expired_session,
                USER_ID,
                request,
                idempotency_key="same-key",
                claim_id="takeover",
            )

        self.assertIsNotNone(expired_claim)
        self.assertTrue(expired_claim.claimed)
        self.assertEqual(expired.updated_at, reclaimed_at)
        self.assertEqual(
            expired.error_json["_activePlanningClaim"]["claimId"],
            "takeover",
        )
        self.assertEqual(expired_session.flushes, 1)
        self.assertTrue(
            expired_session.statements[0]
            .get_execution_options()
            .get("populate_existing")
        )

    async def test_planning_claim_cas_ignores_late_worker_after_takeover(self) -> None:
        planning = _run(status=ResumeOptimizationStatus.PLANNING)
        planning.error_json = {
            "_activePlanningClaim": {
                "claimId": "new-owner",
                "claimedAt": BASE_TIME.isoformat(),
            }
        }
        session = _FakeSession()
        with patch.object(
            run_service,
            "_require_run_by_id",
            AsyncMock(return_value=planning),
        ):
            with self.assertRaises(run_service.OptimizationPlanningClaimLostError):
                await run_service.complete_planning_run_claim(
                    session,
                    USER_ID,
                    str(planning.id),
                    claim_id="old-owner",
                    plan_json={"changes": []},
                    result_json={"changes": []},
                    target_status=ResumeOptimizationStatus.PREVIEW_READY,
                )
            late = await run_service.record_planning_run_claim_terminal(
                session,
                USER_ID,
                str(planning.id),
                claim_id="old-owner",
                target_status=ResumeOptimizationStatus.FAILED,
                error_json={"code": "late_failure"},
            )

        self.assertEqual(late.status, ResumeOptimizationStatus.PLANNING.value)
        self.assertEqual(
            planning.error_json["_activePlanningClaim"]["claimId"],
            "new-owner",
        )
        self.assertEqual(session.flushes, 0)

    async def test_active_answer_claim_is_typed_busy_without_second_ai_claim(self) -> None:
        awaiting = _run(status=ResumeOptimizationStatus.AWAITING_ANSWERS)
        awaiting.answers_json = {
            "answers": [],
            "_activeAnswerClaim": {
                "claimId": "owner",
                "requestHash": "first",
                "claimedAt": BASE_TIME.isoformat(),
            },
        }
        session = _FakeSession()
        with (
            patch.object(
                run_service,
                "_require_run_by_id",
                AsyncMock(return_value=awaiting),
            ),
            patch.object(run_service, "utc_now_aware", return_value=BASE_TIME),
        ):
            with self.assertRaises(OptimizationAnswerInProgressError) as raised:
                await run_service.claim_run_for_answers(
                    session,
                    USER_ID,
                    str(awaiting.id),
                    claim_id="second-owner",
                    request_hash="second",
                )

        self.assertEqual(raised.exception.code, "resume_optimization_answer_in_progress")
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(session.flushes, 0)

    async def test_completed_answer_claim_ignores_late_timeout_writer(self) -> None:
        awaiting = _run(status=ResumeOptimizationStatus.AWAITING_ANSWERS)
        awaiting.answers_json = {
            "answers": [],
            "_activeAnswerClaim": {
                "claimId": "owner",
                "requestHash": "request",
                "claimedAt": BASE_TIME.isoformat(),
            },
        }
        session = _FakeSession()
        with (
            patch.object(
                run_service,
                "_require_run_by_id",
                AsyncMock(return_value=awaiting),
            ),
            patch.object(run_service, "utc_now_aware", return_value=BASE_TIME),
        ):
            completed = await run_service.complete_answer_run_claim(
                session,
                USER_ID,
                str(awaiting.id),
                claim_id="owner",
                answers_json={"answers": [{"question_id": "Q1"}]},
                result_json={"changes": []},
            )
            late = await run_service.record_answer_run_claim_error(
                session,
                USER_ID,
                str(awaiting.id),
                claim_id="owner",
                answers_json={"answers": [{"question_id": "late"}]},
                error_json={"code": "ai_runtime_timeout"},
            )

        self.assertEqual(completed.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        self.assertEqual(late.status, ResumeOptimizationStatus.PREVIEW_READY.value)
        self.assertEqual(awaiting.answers_json, {"answers": [{"question_id": "Q1"}]})
        self.assertEqual(awaiting.error_json, {})

    async def test_stale_recorder_allows_planning_but_rejects_completed(self) -> None:
        error = {"code": "resume_optimization_context_stale", "message": "safe"}

        planning = _run(status=ResumeOptimizationStatus.PLANNING)
        planning_session = _FakeSession()
        with patch.object(
            run_service,
            "_require_run_by_id",
            AsyncMock(return_value=planning),
        ):
            result = await run_service.record_run_stale(
                planning_session,
                USER_ID,
                str(planning.id),
                error,
            )

        self.assertEqual(result.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(result.error_json, error)
        self.assertEqual(planning_session.flushes, 1)

        completed = _run(status=ResumeOptimizationStatus.COMPLETED)
        completed_session = _FakeSession()
        with patch.object(
            run_service,
            "_require_run_by_id",
            AsyncMock(return_value=completed),
        ):
            with self.assertRaises(InvalidOptimizationTransitionError):
                await run_service.record_run_stale(
                    completed_session,
                    USER_ID,
                    str(completed.id),
                    error,
                )

        self.assertEqual(completed.status, ResumeOptimizationStatus.COMPLETED.value)
        self.assertEqual(completed_session.flushes, 0)


if __name__ == "__main__":
    unittest.main()
