import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
)
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


from fastapi import HTTPException  # noqa: E402

from app.domain.billing import billing_service, usage_guard  # noqa: E402
from app.domain.ai import ai_router  # noqa: E402
from app.models import AITokenWallet  # noqa: E402


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def first(self):
        return self.value


class _WalletResult:
    def __init__(self, value):
        self.value = value

    def scalars(self):
        return _ScalarResult(self.value)


class _WalletSession:
    def __init__(self, wallet):
        self.wallet = wallet
        self.added = []
        self.commits = 0

    async def execute(self, _statement):
        return _WalletResult(self.wallet)

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        return None


class _MappingResult:
    def __init__(self, value):
        self.value = value

    def mappings(self):
        return self

    def one(self):
        return self.value


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _GuardSession:
    def __init__(self, counts):
        self.counts = counts
        self.statements = []

    def begin(self):
        return _Transaction()

    async def execute(self, statement, _parameters=None):
        statement_text = str(statement)
        self.statements.append(statement_text)
        if "AS hourly_count" in statement_text:
            return _MappingResult(self.counts)
        return _MappingResult({})


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _SessionFactory:
    def __init__(self, session):
        self.session = session

    def __call__(self):
        return _SessionContext(self.session)


class _FakeLease:
    def __init__(self):
        self.release_count = 0

    async def release(self):
        self.release_count += 1


def _summary(*, unlimited: bool):
    return billing_service.TokenQuotaSummary(
        user_id="user-1",
        token_limit=1_000,
        remaining_tokens=500,
        used_tokens=500,
        remaining_percent=50,
        is_unlimited=unlimited,
    )


class UnlimitedBillingContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_context_acquires_only_one_unlimited_lease_and_releases_on_exception(self):
        lease = _FakeLease()
        with (
            patch.object(
                billing_service,
                "ensure_quota_available",
                AsyncMock(return_value=_summary(unlimited=True)),
            ) as quota_check,
            patch.object(
                billing_service.usage_guard,
                "acquire_unlimited_request",
                AsyncMock(return_value=lease),
            ) as acquire,
        ):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                async with billing_service.ai_billing_context(
                    object(),
                    "user-1",
                    entrypoint="jd_analysis",
                ):
                    await billing_service.ensure_current_quota()
                    await billing_service.ensure_current_quota()
                    raise RuntimeError("boom")

        quota_check.assert_awaited_once()
        acquire.assert_awaited_once_with(user_id="user-1", entrypoint="jd_analysis")
        self.assertEqual(lease.release_count, 1)

    async def test_stream_owned_lease_is_not_released_by_inner_context(self):
        lease = _FakeLease()
        async with billing_service.ai_billing_context(
            object(),
            "user-1",
            entrypoint="resume_parse",
            request_lease=lease,
            release_request_lease_on_exit=False,
        ):
            await billing_service.ensure_current_quota()

        self.assertEqual(lease.release_count, 0)
        await lease.release()
        self.assertEqual(lease.release_count, 1)

    async def test_metered_user_checks_quota_without_acquiring_guard(self):
        with (
            patch.object(
                billing_service,
                "ensure_quota_available",
                AsyncMock(return_value=_summary(unlimited=False)),
            ) as quota_check,
            patch.object(
                billing_service.usage_guard,
                "acquire_unlimited_request",
                AsyncMock(),
            ) as acquire,
        ):
            async with billing_service.ai_billing_context(
                object(),
                "user-1",
                entrypoint="ai_assistant",
            ):
                await billing_service.ensure_current_quota()
                await billing_service.ensure_current_quota()

        quota_check.assert_awaited_once()
        acquire.assert_not_awaited()


class UnlimitedGuardSqlTests(unittest.IsolatedAsyncioTestCase):
    async def _acquire_with_counts(self, counts):
        session = _GuardSession(counts)
        with (
            patch.object(usage_guard, "AsyncSessionFactory", _SessionFactory(session)),
            patch.object(
                usage_guard,
                "load_settings",
                return_value=SimpleNamespace(ai_timeout_seconds=300),
            ),
        ):
            lease = await usage_guard.acquire_unlimited_request(
                user_id="user-1",
                entrypoint="jd_analysis",
            )
        return lease, session

    async def test_third_active_slot_is_last_allowed_and_sql_uses_cross_instance_lock(self):
        lease, session = await self._acquire_with_counts(
            {"hourly_count": 119, "active_count": 2, "oldest_hourly_at": None}
        )

        self.assertEqual(lease.user_id, "user-1")
        statements = "\n".join(session.statements)
        self.assertIn("pg_advisory_xact_lock", statements)
        self.assertIn("expires_at <= now()", statements)
        self.assertIn("INSERT INTO ai_unlimited_request_leases", statements)

    async def test_fourth_concurrent_request_returns_429(self):
        with self.assertRaises(HTTPException) as raised:
            await self._acquire_with_counts(
                {"hourly_count": 3, "active_count": 3, "oldest_hourly_at": None}
            )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail["code"], "ai_unlimited_concurrency_limited")

    async def test_121st_hourly_request_returns_429_even_after_prior_releases(self):
        with self.assertRaises(HTTPException) as raised:
            await self._acquire_with_counts(
                {
                    "hourly_count": 120,
                    "active_count": 0,
                    "oldest_hourly_at": datetime.now(timezone.utc) - timedelta(minutes=30),
                }
            )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail["code"], "ai_unlimited_hourly_limit_reached")

    async def test_release_retries_after_transient_failure_then_becomes_idempotent(self):
        lease = usage_guard.UnlimitedRequestLease(
            id=uuid.uuid4(),
            user_id="user-1",
            entrypoint="jd_analysis",
        )
        release = AsyncMock(side_effect=[RuntimeError("db unavailable"), None])
        with (
            patch.object(usage_guard, "release_unlimited_request", release),
            patch.object(usage_guard.logger, "exception") as log_failure,
        ):
            await lease.release()
            await lease.release()
            await lease.release()

        self.assertEqual(release.await_count, 2)
        log_failure.assert_called_once()


class UnlimitedUsageAlertTests(unittest.IsolatedAsyncioTestCase):
    async def test_successful_committed_unlimited_usage_schedules_daily_alert_without_deducting(self):
        now = billing_service.utc_now()
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=25,
            used_tokens=975,
            unlimited_tokens_expires_at=now + timedelta(days=7),
            unlimited_tokens_plan_name="单月不限量",
        )
        session = _WalletSession(wallet)

        with patch.object(billing_service, "_schedule_daily_usage_alert") as schedule:
            await billing_service.record_usage_event(
                session,
                user_id="user-1",
                entrypoint="jd_analysis",
                request_label="jd_text_analysis",
                provider="dashscope",
                model="qwen",
                status="success",
                total_tokens=150,
                commit=True,
            )

        self.assertEqual((wallet.remaining_tokens, wallet.used_tokens), (25, 975))
        schedule.assert_called_once()

    async def test_failed_zero_token_and_uncommitted_usage_do_not_schedule_alerts(self):
        now = billing_service.utc_now()
        for status, total_tokens, commit in (
            ("failed", 100, True),
            ("success", 0, True),
            ("success", 100, False),
        ):
            wallet = AITokenWallet(
                user_id="user-1",
                remaining_tokens=25,
                used_tokens=975,
                unlimited_tokens_expires_at=now + timedelta(days=7),
                unlimited_tokens_plan_name="单月不限量",
            )
            session = _WalletSession(wallet)
            with (
                self.subTest(status=status, total_tokens=total_tokens, commit=commit),
                patch.object(billing_service, "_schedule_daily_usage_alert") as schedule,
            ):
                await billing_service.record_usage_event(
                    session,
                    user_id="user-1",
                    entrypoint="jd_analysis",
                    request_label="jd_text_analysis",
                    provider="dashscope",
                    model="qwen",
                    status=status,
                    total_tokens=total_tokens,
                    commit=commit,
                )
                schedule.assert_not_called()

    def test_alert_claim_is_atomic_and_once_per_utc_day(self):
        source = Path(usage_guard.__file__).read_text(encoding="utf-8")
        self.assertIn("ON CONFLICT (user_id, usage_day, threshold_tokens) DO NOTHING", source)
        self.assertIn("metadata_json ->> 'billing_mode' = 'unlimited_time'", source)
        self.assertIn("status = 'success'", source)


class UnlimitedGuardRouteCoverageTests(unittest.TestCase):
    def test_all_streaming_entrypoints_preflight_and_release_the_request_lease(self):
        backend_root = Path(__file__).resolve().parent
        expected = {
            "app/domain/ai/ai_router.py": 6,
            "app/domain/parser/parser_router.py": 1,
            "app/domain/assistant/assistant_router.py": 1,
        }
        for relative_path, expected_count in expected.items():
            source = (backend_root / relative_path).read_text(encoding="utf-8")
            with self.subTest(relative_path=relative_path):
                self.assertEqual(source.count("begin_ai_request("), expected_count)
                self.assertEqual(source.count("release_request_lease_on_exit=False"), expected_count)
                self.assertEqual(source.count("await request_lease.release()"), expected_count)


class UnlimitedGuardStreamingReleaseTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_generator_close_releases_preflight_lease(self):
        lease = _FakeLease()
        with (
            patch.object(
                ai_router.billing_service,
                "begin_ai_request",
                AsyncMock(return_value=lease),
            ),
            patch.object(
                ai_router,
                "analyze_jd_with_thoughts",
                AsyncMock(return_value={"summary": "ok"}),
            ),
        ):
            response = await ai_router.analyze_jd_stream_endpoint(
                ai_router.AnalyzeJDRequest(text="JD"),
                session=object(),
                current_user=SimpleNamespace(id="user-1"),
            )
            iterator = response.body_iterator
            await anext(iterator)
            await iterator.aclose()

        self.assertEqual(lease.release_count, 1)


if __name__ == "__main__":
    unittest.main()
