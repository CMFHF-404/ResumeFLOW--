from __future__ import annotations

from contextlib import contextmanager, ExitStack
from copy import deepcopy
import json
import os
import subprocess
import sys
from types import SimpleNamespace
import unittest
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

from app.domain.ai.public_errors import AiProviderPayloadError  # noqa: E402
from app.domain.ai.runtime_budget import AiRuntimeTimeoutError  # noqa: E402
from app.domain.resume_optimization import router as router_module  # noqa: E402
from app.domain.resume_optimization import orchestrator as orchestrator_module  # noqa: E402
from app.domain.resume_optimization import apply_service  # noqa: E402
from app.domain.resume_optimization.apply_service import (  # noqa: E402
    OptimizationApplyStaleError,
    OptimizationContentConflictError,
)
from app.domain.resume_optimization.context_service import (  # noqa: E402
    OptimizationContextStaleError,
)
from app.domain.resume_optimization.run_service import (  # noqa: E402
    OptimizationIdempotencyConflictError,
    OptimizationRunNotFoundError,
)
from app.domain.resume_optimization.normalizers import (  # noqa: E402
    OptimizationPlanNormalizationError,
)
from app.domain.resume_optimization.schemas import ResumeOptimizationStatus  # noqa: E402
from app.domain.resume_optimization.state_machine import (  # noqa: E402
    InvalidOptimizationTransitionError,
)
from test_resume_optimization_router import (  # noqa: E402
    BASE_TIME,
    RESUME_ID,
    RUN_ID,
    USER_ID,
    _BillingContext,
    _Lease,
    _OwnedSessionFactory,
    _Session,
    _answers_payload,
    _run,
    _start_payload,
)
from test_resume_optimization_apply import (  # noqa: E402
    BASE_TIME as APPLY_BASE_TIME,
    NEXT_TIME as APPLY_NEXT_TIME,
    RUN_ID as APPLY_RUN_ID,
    USER_ID as APPLY_USER_ID,
    _change as _apply_change,
    _link as _apply_link,
    _request as _apply_request,
    _resume as _apply_resume,
    _run as _apply_run,
    _transaction_session,
)


PRIVATE_CANARY = "PRIVATE_MODEL_BODY_AND_STACK_CANARY"


class ResumeOptimizationPublicErrorTests(unittest.TestCase):
    def assert_public_payload(self, payload: dict, *, code: str) -> None:
        self.assertEqual(payload["code"], code)
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn(PRIVATE_CANARY, serialized)
        self.assertNotIn("Traceback", serialized)

    def test_domain_conflicts_and_not_found_have_stable_safe_contracts(self) -> None:
        matrix = (
            (
                OptimizationContextStaleError(PRIVATE_CANARY),
                409,
                "resume_optimization_context_stale",
            ),
            (
                OptimizationContentConflictError(),
                409,
                "resume_optimization_content_conflict",
            ),
            (
                OptimizationRunNotFoundError(PRIVATE_CANARY),
                404,
                "resume_optimization_run_not_found",
            ),
            (
                InvalidOptimizationTransitionError(
                    ResumeOptimizationStatus.COMPLETED,
                    ResumeOptimizationStatus.APPLYING,
                ),
                409,
                "invalid_optimization_transition",
            ),
            (
                OptimizationIdempotencyConflictError(),
                409,
                "resume_optimization_idempotency_conflict",
            ),
        )

        for error, status_code, code in matrix:
            with self.subTest(code=code):
                self.assertEqual(router_module._domain_status_code(error), status_code)
                detail = router_module._domain_error_detail(error)
                self.assert_public_payload(detail, code=code)
                self.assertTrue(detail["message"].strip())

    def test_ai_timeout_and_invalid_payload_stream_errors_never_expose_raw_data(self) -> None:
        matrix = (
            (
                AiRuntimeTimeoutError(PRIVATE_CANARY),
                504,
                "ai_runtime_timeout",
                True,
            ),
            (
                AiProviderPayloadError(PRIVATE_CANARY),
                502,
                "ai_provider_invalid_response",
                False,
            ),
        )

        for error, status_code, code, retryable in matrix:
            with self.subTest(code=code):
                event = router_module._stream_error_event(
                    error,
                    request_id="public-request-id",
                )
                self.assert_public_payload(event, code=code)
                self.assertEqual(event["type"], "error")
                self.assertEqual(event["statusCode"], status_code)
                self.assertEqual(event["retryable"], retryable)
                self.assertEqual(event["requestId"], "public-request-id")

    def test_quota_exhaustion_is_returned_before_planning_without_rewriting_402(self) -> None:
        quota_error = HTTPException(
            status_code=402,
            detail={
                "code": "ai_token_quota_exhausted",
                "message": "AI Token 额度已用完，请购买套餐或兑换卡密后继续使用。",
            },
        )
        planner = AsyncMock()

        async def exercise() -> None:
            with (
                patch.object(
                    router_module.billing_service,
                    "begin_ai_request",
                    AsyncMock(side_effect=quota_error),
                ),
                patch.object(router_module, "create_optimization_plan", planner),
            ):
                with self.assertRaises(HTTPException) as raised:
                    await router_module.start_resume_optimization_stream(
                        payload=object(),
                        request=object(),
                        idempotency_key="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        session=object(),
                        current_user=type("User", (), {"id": "public-error-user"})(),
                    )

            self.assertEqual(raised.exception.status_code, 402)
            self.assertEqual(
                raised.exception.detail["code"],
                "ai_token_quota_exhausted",
            )
            self.assertNotIn(PRIVATE_CANARY, json.dumps(raised.exception.detail))
            planner.assert_not_awaited()

        import asyncio

        asyncio.run(exercise())

    def test_disabled_feature_has_no_registered_routes_and_native_404(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "local",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "FRONTEND_ORIGIN": "http://localhost:5173",
                "CORS_ALLOW_ORIGINS": "http://localhost:5173",
                "FRONTEND_LOGTO_ENDPOINT": "",
                "FRONTEND_LOGTO_APP_ID": "",
                "FRONTEND_LOGTO_REDIRECT_URI": "",
                "ENABLE_DEV_AUTH_BYPASS": "true",
                "ENABLE_RESUME_OPTIMIZATION": "false",
            }
        )
        script = """
import asyncio
import httpx
from app.main import app

assert not {
    route.path for route in app.routes
    if route.path.startswith('/api/resume-optimizations')
}

async def verify():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url='http://test',
    ) as client:
        response = await client.get(
            '/api/resume-optimizations/latest',
            params={'resume_id': '11111111-1111-4111-8111-111111111111'},
        )
    assert response.status_code == 404, response.text
    assert response.json() == {'detail': 'Not Found'}, response.text

asyncio.run(verify())
"""

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


class ResumeOptimizationPublicTransportTests(unittest.IsolatedAsyncioTestCase):
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

    def _app(
        self,
        *,
        session: object | None = None,
        user_id: str = USER_ID,
    ) -> FastAPI:
        resolved_session = session or _Session()

        async def override_session():
            yield resolved_session

        async def override_user():
            return SimpleNamespace(id=user_id)

        app = FastAPI()
        app.include_router(router_module.router)
        app.dependency_overrides[router_module.get_session] = override_session
        app.dependency_overrides[router_module.get_current_user] = override_user
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

    async def _send(
        self,
        method: str,
        path: str,
        *,
        app: FastAPI | None = None,
        json_body: object | None = None,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app or self._app()),
            base_url="http://testserver",
        ) as client:
            return await client.request(
                method,
                path,
                json=json_body,
                headers=headers,
                params=params,
            )

    def _events(self, response: httpx.Response) -> list[dict]:
        return [
            json.loads(line)
            for line in response.text.splitlines()
            if line.strip()
        ]

    def assert_safe_response(
        self,
        response: httpx.Response,
        *canaries: str,
    ) -> None:
        serialized = response.text
        for canary in (PRIVATE_CANARY, "Traceback", *canaries):
            self.assertNotIn(canary, serialized)

    async def test_stale_start_is_http_200_with_terminal_409(self) -> None:
        planner = AsyncMock(side_effect=OptimizationContextStaleError(PRIVATE_CANARY))
        with (
            self._billing(),
            patch.object(router_module, "create_optimization_plan", planner),
            patch.object(router_module, "new_ai_request_id", return_value="stale-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        events = self._events(response)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "error")
        self.assertEqual(events[0]["code"], "resume_optimization_context_stale")
        self.assertEqual(events[0]["statusCode"], 409)
        self.assertFalse(events[0]["retryable"])
        self.assertEqual(events[0]["requestId"], "stale-request")
        self.assert_safe_response(response)

    async def test_apply_version_conflict_is_http_409_and_never_overwrites_resume(self) -> None:
        run = _apply_run([_apply_change("CHG_A")])
        resume = _apply_resume(updated_at=APPLY_NEXT_TIME)
        session = _transaction_session(run, resume, _apply_link())
        before_config = deepcopy(resume.config)
        app = self._app(session=session, user_id=APPLY_USER_ID)

        response = await self._send(
            "POST",
            f"/api/resume-optimizations/{APPLY_RUN_ID}/apply",
            app=app,
            json_body=_apply_request(
                "CHG_A",
                expected=APPLY_BASE_TIME,
            ).model_dump(mode="json"),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"]["code"],
            "resume_optimization_context_stale",
        )
        self.assertEqual(run.status, ResumeOptimizationStatus.STALE.value)
        self.assertEqual(resume.config, before_config)
        self.assertEqual(session.commits, 0)
        self.assertEqual(session.stale_session.commits, 1)
        self.assert_safe_response(response)

    async def test_run_not_found_uses_http_404_and_answer_terminal_404(self) -> None:
        missing = OptimizationRunNotFoundError(PRIVATE_CANARY)
        with patch.object(
            router_module,
            "get_run_for_user",
            AsyncMock(side_effect=missing),
        ):
            get_response = await self._send(
                "GET",
                f"/api/resume-optimizations/{RUN_ID}",
            )

        with (
            self._billing(),
            patch.object(
                router_module,
                "answer_optimization_questions",
                AsyncMock(side_effect=missing),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="missing-request"),
        ):
            answer_response = await self._send(
                "POST",
                f"/api/resume-optimizations/{RUN_ID}/answers/stream",
                json_body=_answers_payload().model_dump(mode="json"),
            )

        self.assertEqual(get_response.status_code, 404)
        self.assertEqual(
            get_response.json()["detail"]["code"],
            "resume_optimization_run_not_found",
        )
        self.assertEqual(answer_response.status_code, 200)
        terminal = self._events(answer_response)[-1]
        self.assertEqual(terminal["code"], "resume_optimization_run_not_found")
        self.assertEqual(terminal["statusCode"], 404)
        self.assertFalse(terminal["retryable"])
        self.assertEqual(terminal["requestId"], "missing-request")
        self.assert_safe_response(get_response)
        self.assert_safe_response(answer_response)

    async def test_invalid_transition_uses_cancel_http_and_answer_terminal_409(self) -> None:
        transition_error = InvalidOptimizationTransitionError(
            ResumeOptimizationStatus.APPLIED,
            ResumeOptimizationStatus.CANCELLED,
        )
        transition_error.private_canary = PRIVATE_CANARY
        with (
            patch.object(
                router_module,
                "get_run_for_user",
                AsyncMock(return_value=_run(ResumeOptimizationStatus.APPLIED)),
            ),
            patch.object(
                router_module,
                "transition_run",
                AsyncMock(side_effect=transition_error),
            ),
        ):
            cancel_response = await self._send(
                "POST",
                f"/api/resume-optimizations/{RUN_ID}/cancel",
            )

        with (
            self._billing(),
            patch.object(
                router_module,
                "answer_optimization_questions",
                AsyncMock(side_effect=transition_error),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="transition-request"),
        ):
            answer_response = await self._send(
                "POST",
                f"/api/resume-optimizations/{RUN_ID}/answers/stream",
                json_body=_answers_payload().model_dump(mode="json"),
            )

        self.assertEqual(cancel_response.status_code, 409)
        self.assertEqual(
            cancel_response.json()["detail"]["code"],
            "invalid_optimization_transition",
        )
        self.assertEqual(answer_response.status_code, 200)
        terminal = self._events(answer_response)[-1]
        self.assertEqual(terminal["code"], "invalid_optimization_transition")
        self.assertEqual(terminal["statusCode"], 409)
        self.assertFalse(terminal["retryable"])
        self.assert_safe_response(cancel_response)
        self.assert_safe_response(answer_response)

    async def test_idempotency_conflict_is_terminal_409_before_planner_or_usage(self) -> None:
        planner = AsyncMock()
        usage = AsyncMock()
        with (
            self._billing(),
            patch.object(
                orchestrator_module,
                "preflight_idempotent_run",
                AsyncMock(side_effect=OptimizationIdempotencyConflictError()),
            ),
            patch.object(orchestrator_module, "plan_resume_optimization", planner),
            patch.object(router_module.billing_service, "record_current_usage", usage),
            patch.object(router_module, "new_ai_request_id", return_value="conflict-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        terminal = self._events(response)[-1]
        self.assertEqual(terminal["code"], "resume_optimization_idempotency_conflict")
        self.assertEqual(terminal["statusCode"], 409)
        self.assertFalse(terminal["retryable"])
        planner.assert_not_awaited()
        usage.assert_not_awaited()
        self.assert_safe_response(response)

    async def test_timeout_is_http_200_with_terminal_504(self) -> None:
        with (
            self._billing(),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=AiRuntimeTimeoutError(PRIVATE_CANARY)),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="timeout-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        terminal = self._events(response)[-1]
        self.assertEqual(terminal["code"], "ai_runtime_timeout")
        self.assertEqual(terminal["statusCode"], 504)
        self.assertTrue(terminal["retryable"])
        self.assertEqual(terminal["requestId"], "timeout-request")
        self.assert_safe_response(response)

    async def test_string_http_exception_detail_is_sanitized_in_stream_and_run_metadata(self) -> None:
        internal_detail = f"{PRIVATE_CANARY}: AI_API_KEY is not configured"
        failure = HTTPException(status_code=503, detail=internal_detail)
        with (
            self._billing(),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=failure),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="http-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        terminal = self._events(response)[-1]
        self.assertEqual(terminal["code"], "http_error")
        self.assertEqual(terminal["statusCode"], 503)
        self.assertTrue(terminal["retryable"])
        self.assertEqual(terminal["requestId"], "http-request")
        self.assert_safe_response(response, internal_detail, "AI_API_KEY")

        persisted = orchestrator_module._public_error_metadata(
            failure,
            request_id="http-request",
        )
        serialized = json.dumps(persisted, ensure_ascii=False)
        self.assertNotIn(internal_detail, serialized)
        self.assertNotIn("AI_API_KEY", serialized)

    async def test_provider_and_plan_payload_failures_keep_distinct_safe_502_codes(self) -> None:
        cases = (
            (
                AiProviderPayloadError(f"{PRIVATE_CANARY}: raw provider body"),
                "ai_provider_invalid_response",
            ),
            (
                OptimizationPlanNormalizationError(
                    f'{PRIVATE_CANARY}: [{{"raw_model":"secret"}}]'
                ),
                "resume_optimization_plan_invalid",
            ),
        )
        for error, code in cases:
            with self.subTest(code=code):
                with (
                    self._billing(),
                    patch.object(
                        router_module,
                        "create_optimization_plan",
                        AsyncMock(side_effect=error),
                    ),
                    patch.object(router_module, "new_ai_request_id", return_value=f"{code}-request"),
                ):
                    response = await self._send(
                        "POST",
                        "/api/resume-optimizations/stream",
                        json_body=_start_payload().model_dump(mode="json"),
                        headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
                    )

                self.assertEqual(response.status_code, 200)
                terminal = self._events(response)[-1]
                self.assertEqual(terminal["code"], code)
                self.assertEqual(terminal["statusCode"], 502)
                self.assertFalse(terminal["retryable"])
                self.assert_safe_response(response, "raw_model", "secret")

    async def test_httpx_provider_body_is_not_exposed_by_unavailable_error(self) -> None:
        provider_request = httpx.Request("POST", "https://provider.invalid/v1")
        provider_response = httpx.Response(
            500,
            request=provider_request,
            text=f"{PRIVATE_CANARY}: raw upstream html",
        )
        provider_error = httpx.HTTPStatusError(
            f"{PRIVATE_CANARY}: provider failed",
            request=provider_request,
            response=provider_response,
        )
        with (
            self._billing(),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=provider_error),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="provider-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        terminal = self._events(response)[-1]
        self.assertEqual(terminal["code"], "ai_provider_unavailable")
        self.assertEqual(terminal["statusCode"], 503)
        self.assertTrue(terminal["retryable"])
        self.assert_safe_response(response, "raw upstream html")

    async def test_quota_exhaustion_is_pre_stream_http_402_without_planning(self) -> None:
        quota_error = HTTPException(
            status_code=402,
            detail={
                "code": "ai_token_quota_exhausted",
                "message": "AI Token 额度已用完，请购买套餐或兑换卡密后继续使用。",
            },
        )
        planner = AsyncMock()
        with (
            patch.object(
                router_module.billing_service,
                "begin_ai_request",
                AsyncMock(side_effect=quota_error),
            ),
            patch.object(router_module, "create_optimization_plan", planner),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 402)
        detail = response.json()["detail"]
        self.assertEqual(detail["code"], "ai_token_quota_exhausted")
        self.assertNotIn("requestId", detail)
        self.assertNotIn("retryable", detail)
        planner.assert_not_awaited()
        self.assert_safe_response(response)

    async def test_unknown_failure_is_http_200_with_safe_terminal_500(self) -> None:
        unknown = RuntimeError(f"{PRIVATE_CANARY}\nTraceback: raw stack")
        with (
            self._billing(),
            patch.object(
                router_module,
                "create_optimization_plan",
                AsyncMock(side_effect=unknown),
            ),
            patch.object(router_module, "new_ai_request_id", return_value="unknown-request"),
        ):
            response = await self._send(
                "POST",
                "/api/resume-optimizations/stream",
                json_body=_start_payload().model_dump(mode="json"),
                headers={"Idempotency-Key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            )

        self.assertEqual(response.status_code, 200)
        terminal = self._events(response)[-1]
        self.assertEqual(terminal["code"], "internal_error")
        self.assertEqual(terminal["statusCode"], 500)
        self.assertFalse(terminal["retryable"])
        self.assertEqual(terminal["requestId"], "unknown-request")
        self.assert_safe_response(response, "raw stack")


if __name__ == "__main__":
    unittest.main()
