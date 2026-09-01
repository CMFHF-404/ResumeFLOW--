from __future__ import annotations

from contextlib import ExitStack
import inspect
import os
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = (
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume_optimization import orchestrator, router  # noqa: E402
from app.domain.resume_optimization.run_service import OptimizationRunClaim  # noqa: E402
from app.domain.resume_optimization.schemas import (  # noqa: E402
    OptimizationPlan,
    ResumeOptimizationStatus,
)
from test_resume_optimization_orchestrator import (  # noqa: E402
    USER_ID,
    _FakeSession,
    _RunStore,
    _allowed,
    _context,
    _run,
    _start_request,
)


class ResumeOptimizationBillingMetadataTests(unittest.TestCase):
    def test_metadata_helper_replaces_context_with_a_strict_safe_allowlist(self) -> None:
        context = SimpleNamespace(
            metadata={
                "route": "/unsafe/actual/id",
                "resume_text": "SECRET RESUME",
                "answer_value": "SECRET ANSWER",
                "source_snapshot_hash": "SECRET HASH",
            }
        )
        run = _run(status=ResumeOptimizationStatus.PLANNING)
        with patch.object(
            orchestrator.billing_service,
            "get_current_billing_context",
            return_value=context,
        ):
            orchestrator._update_current_billing_metadata(
                route="/api/resume-optimizations/{run_id}/answers/stream",
                run=run,
                counts={
                    "issue_count": 2,
                    "selected_experience_count": 3,
                    "selected_skill_count": 4,
                    "bank_candidate_count": 1,
                    "submitted_answer_count": 5,
                    "answered_count": 1,
                    "no_data_count": 1,
                    "unknown_count": 1,
                    "not_my_work_count": 1,
                    "skipped_count": 1,
                    "rewrite_question_count": 2,
                    "payload": "SECRET PAYLOAD",
                    "question_ids": ["Q1"],
                },
            )

        self.assertEqual(
            set(context.metadata),
            {
                "route",
                "run_id",
                "optimizer_version",
                "issue_count",
                "selected_experience_count",
                "selected_skill_count",
                "bank_candidate_count",
                "submitted_answer_count",
                "answered_count",
                "no_data_count",
                "unknown_count",
                "not_my_work_count",
                "skipped_count",
                "rewrite_question_count",
            },
        )
        self.assertEqual(
            context.metadata["route"],
            "/api/resume-optimizations/{run_id}/answers/stream",
        )
        self.assertEqual(context.metadata["run_id"], str(run.id))
        self.assertEqual(context.metadata["optimizer_version"], "resume_optimization_v1")
        self.assertNotIn("SECRET", repr(context.metadata))

    def test_metadata_is_published_before_each_llm_call_and_terminal_answers_skip_it(self) -> None:
        plan_source = inspect.getsource(orchestrator.create_optimization_plan)
        answer_source = inspect.getsource(orchestrator.answer_optimization_questions)
        self.assertLess(
            plan_source.index("_update_current_billing_metadata"),
            plan_source.index("plan_resume_optimization"),
        )
        rewrite_guard = answer_source.index("if answers_for_rewrite:")
        metadata_update = answer_source.index("_update_current_billing_metadata", rewrite_guard)
        rewrite_call = answer_source.index("rewrite_answered_modules", rewrite_guard)
        self.assertLess(rewrite_guard, metadata_update)
        self.assertLess(metadata_update, rewrite_call)
        self.assertNotIn("record_current_usage", answer_source)
        for key in (
            "issue_count",
            "selected_experience_count",
            "selected_skill_count",
            "bank_candidate_count",
        ):
            self.assertIn(f'"{key}"', plan_source)
        for key in (
            "question_count",
            "submitted_answer_count",
            "answered_count",
            "no_data_count",
            "unknown_count",
            "not_my_work_count",
            "skipped_count",
            "rewrite_question_count",
            "affected_change_count",
        ):
            self.assertIn(f'"{key}"', answer_source)

    def test_only_plan_and_answer_routes_create_ai_billing_contexts(self) -> None:
        source = inspect.getsource(router)
        self.assertIn('entrypoint="resume_optimization_plan"', source)
        self.assertIn('entrypoint="resume_optimization_answer"', source)
        self.assertIn('route_metadata="/api/resume-optimizations/{run_id}/answers/stream"', source)
        for start, end in (
            ("async def get_latest_resume_optimization_run", "async def answer_resume_optimization_stream"),
            ("async def apply_resume_optimization_run", "async def finalize_resume_optimization_run"),
            ("async def finalize_resume_optimization_run", "async def revert_resume_optimization_run"),
            ("async def revert_resume_optimization_run", "async def cancel_resume_optimization_run"),
            ("async def cancel_resume_optimization_run", "async def get_resume_optimization_run"),
        ):
            block = source[source.index(start):source.index(end)]
            self.assertNotIn("ai_billing_context", block)
            self.assertNotIn("begin_ai_request", block)


class ResumeOptimizationBillingIdempotencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_idempotent_retry_plans_records_usage_and_charges_wallet_once(self) -> None:
        run = _run(status=ResumeOptimizationStatus.PLANNING)
        store = _RunStore(run)
        session = _FakeSession()
        frozen = _context()
        calls = {"planner": 0, "usage": 0, "wallet": 0}

        async def planned_once(_frozen):
            calls["planner"] += 1
            calls["usage"] += 1
            calls["wallet"] += 1
            return OptimizationPlan()

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
            patch.object(orchestrator, "lock_run_source_resume", store.lock_run_source_resume),
            patch.object(
                orchestrator,
                "build_frozen_optimization_context",
                AsyncMock(return_value=frozen),
            ),
            patch.object(orchestrator, "plan_resume_optimization", planned_once),
            patch.object(
                orchestrator,
                "verify_plan_changes",
                side_effect=lambda **kwargs: _allowed(kwargs["plan"].changes),
            ),
            patch.object(orchestrator, "build_bank_suggestions", return_value=[]),
        )
        with ExitStack() as stack:
            for active_patch in patches:
                stack.enter_context(active_patch)
            first = await orchestrator.create_optimization_plan(
                session=session,
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key="same-key",
            )
            store.preflight_claim = OptimizationRunClaim(run=first, claimed=False)
            second = await orchestrator.create_optimization_plan(
                session=session,
                user_id=USER_ID,
                payload=_start_request(),
                idempotency_key="same-key",
            )

        self.assertEqual(str(first.id), str(second.id))
        self.assertEqual(calls, {"planner": 1, "usage": 1, "wallet": 1})
