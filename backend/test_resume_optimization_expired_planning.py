from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from test_resume_optimization_run_service import (
    BASE_TIME, USER_A, _FakeAsyncSession, _run,
)
from app.domain.resume_optimization import run_service, router
from app.domain.resume_optimization.schemas import ResumeOptimizationStatus as Status


class ExpiredPlanningTests(unittest.IsolatedAsyncioTestCase):
    async def test_expired_run_fails_without_changing_content_or_billing(self):
        run = _run()
        run.error_json = {"_activePlanningClaim": {"claimId": "abandoned"}}
        before = deepcopy(run.before_snapshot)
        session = _FakeAsyncSession([[run]])
        with patch.object(run_service, "utc_now_aware", return_value=BASE_TIME + timedelta(seconds=900)):
            result, changed = await run_service.recover_expired_planning_run(session, USER_A, run)
        self.assertTrue(changed)
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error_json["code"], "resume_optimization_planning_expired")
        self.assertNotIn("_activePlanningClaim", result.error_json)
        self.assertEqual(result.before_snapshot, before)
        self.assertEqual(session.flushes, 1)
        self.assertEqual(session.commits, 0)
        sql = str(session.statements[0]).lower()
        self.assertIn("for update", sql)
        self.assertIn("resume_optimization_runs.user_id", sql)

    async def test_active_and_nonplanning_runs_are_not_changed(self):
        for status in Status:
            with self.subTest(status=status):
                run = _run(status=status)
                session = _FakeAsyncSession()
                now = BASE_TIME + timedelta(seconds=899 if status == Status.PLANNING else 86400)
                with patch.object(run_service, "utc_now_aware", return_value=now):
                    result, changed = await run_service.recover_expired_planning_run(session, USER_A, run)
                self.assertFalse(changed)
                self.assertEqual(result.status, status.value)
                self.assertEqual(session.statements, [])

    async def test_reclaimed_or_completed_worker_wins_under_lock(self):
        for status in (Status.PLANNING, Status.PREVIEW_READY):
            observed = _run()
            authoritative = observed.model_copy(deep=True)
            authoritative.status = status.value
            authoritative.updated_at = BASE_TIME + timedelta(hours=1)
            session = _FakeAsyncSession([[authoritative]])
            with patch.object(run_service, "utc_now_aware", return_value=BASE_TIME + timedelta(hours=1)):
                result, changed = await run_service.recover_expired_planning_run(session, USER_A, observed)
            self.assertFalse(changed)
            self.assertEqual(result.status, status.value)
            self.assertEqual(session.flushes, 0)

    async def test_late_worker_cannot_publish_after_expiry(self):
        run = _run()
        run.error_json = {"_activePlanningClaim": {"claimId": "abandoned"}}
        session = _FakeAsyncSession([[run], [run]])
        with patch.object(run_service, "utc_now_aware", return_value=BASE_TIME + timedelta(hours=1)):
            await run_service.recover_expired_planning_run(session, USER_A, run)
        with self.assertRaises(run_service.OptimizationPlanningClaimLostError):
            await run_service.complete_planning_run_claim(
                session, USER_A, run.id, claim_id="abandoned",
                target_status=Status.PREVIEW_READY, plan_json={}, result_json={},
            )

    async def test_status_routes_commit_recovery_without_starting_ai(self):
        for latest in (False, True):
            with self.subTest(latest=latest):
                run = _run()
                failed = run.model_copy(update={"status": "failed", "plan_json": {}, "result_json": {}})
                session = SimpleNamespace(commit=AsyncMock())
                begin_ai = AsyncMock()
                with (
                    patch.object(router, "get_run_for_user", AsyncMock(return_value=run)),
                    patch.object(router, "get_latest_run_for_resume", AsyncMock(return_value=run)),
                    patch.object(router, "recover_expired_planning_run", AsyncMock(return_value=(failed, True))),
                    patch.object(router, "_run_to_read", Mock(side_effect=lambda value: value)),
                    patch.object(router.billing_service, "begin_ai_request", begin_ai),
                ):
                    if latest:
                        result = await router.get_latest_resume_optimization_run(str(run.resume_id), session, SimpleNamespace(id=USER_A))
                    else:
                        result = await router.get_resume_optimization_run(str(run.id), session, SimpleNamespace(id=USER_A))
                self.assertEqual(result.status, "failed")
                session.commit.assert_awaited_once()
                begin_ai.assert_not_awaited()
