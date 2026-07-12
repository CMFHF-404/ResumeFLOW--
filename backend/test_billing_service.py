import os
import unittest
from datetime import timedelta
from unittest.mock import patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402

from app.domain.billing import billing_service  # noqa: E402
from app.models import AITokenPurchaseEvent, AITokenUsageEvent, AITokenWallet  # noqa: E402


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def first(self):
        return self._value

    def all(self):
        return self._value


class _ExecuteResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return _ScalarResult(self._value)


class _FakeSession:
    def __init__(self, execute_values=None):
        self.execute_values = list(execute_values or [])
        self.statements = []
        self.added = []
        self.commits = 0
        self.refreshed = []

    async def execute(self, statement):
        self.statements.append(statement)
        value = self.execute_values.pop(0) if self.execute_values else None
        return _ExecuteResult(value)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        return None

    async def refresh(self, value):
        self.refreshed.append(value)


class _FakeSessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeSessionFactory:
    def __init__(self, session):
        self.session = session

    def __call__(self):
        return _FakeSessionContext(self.session)


class BillingTimestampMappingTests(unittest.TestCase):
    def test_billing_models_bind_timestamptz_columns_as_timezone_aware(self) -> None:
        self.assertTrue(AITokenWallet.__table__.c.unlimited_tokens_expires_at.type.timezone)
        self.assertTrue(AITokenWallet.__table__.c.last_purchase_at.type.timezone)
        self.assertTrue(AITokenWallet.__table__.c.created_at.type.timezone)
        self.assertTrue(AITokenWallet.__table__.c.updated_at.type.timezone)
        self.assertTrue(AITokenUsageEvent.__table__.c.created_at.type.timezone)
        self.assertTrue(AITokenPurchaseEvent.__table__.c.created_at.type.timezone)


class BillingPurchaseTests(unittest.IsolatedAsyncioTestCase):
    def test_purchase_options_define_three_placeholder_packages(self) -> None:
        options = billing_service.get_purchase_options()

        self.assertEqual([option.id for option in options], ["tokens_100k", "tokens_500k", "tokens_1m"])
        self.assertEqual([option.tokens for option in options], [100_000, 500_000, 1_000_000])
        self.assertTrue(all(option.is_placeholder for option in options))

    async def test_placeholder_purchase_stacks_remaining_balance_as_new_limit(self) -> None:
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=10_000,
            remaining_tokens=2_500,
            used_tokens=7_500,
        )
        session = _FakeSession([wallet])

        summary = await billing_service.create_placeholder_purchase(
            session,
            "user-1",
            "tokens_500k",
        )

        self.assertEqual(wallet.token_limit, 502_500)
        self.assertEqual(wallet.remaining_tokens, 502_500)
        self.assertEqual(wallet.used_tokens, 0)
        self.assertEqual(summary.token_limit, 502_500)
        self.assertEqual(summary.remaining_tokens, 502_500)
        purchases = [item for item in session.added if isinstance(item, AITokenPurchaseEvent)]
        self.assertEqual(len(purchases), 1)
        self.assertEqual(purchases[0].before_remaining_tokens, 2_500)
        self.assertEqual(purchases[0].after_remaining_tokens, 502_500)
        self.assertEqual(purchases[0].after_token_limit, 502_500)

    async def test_placeholder_purchase_locks_wallet_row_before_replacing_balance(self) -> None:
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=10_000,
            remaining_tokens=2_500,
            used_tokens=7_500,
        )
        session = _FakeSession([wallet])

        await billing_service.create_placeholder_purchase(
            session,
            "user-1",
            "tokens_500k",
        )

        self.assertTrue(session.statements)
        self.assertIsNotNone(getattr(session.statements[0], "_for_update_arg", None))

    async def test_signup_bonus_initializes_new_wallet_and_purchase_event(self) -> None:
        now = billing_service.utc_now()
        session = _FakeSession([None])

        with patch.object(billing_service, "utc_now", return_value=now):
            summary = await billing_service.grant_signup_bonus(session, "user-new")

        wallets = [item for item in session.added if isinstance(item, AITokenWallet)]
        purchases = [item for item in session.added if isinstance(item, AITokenPurchaseEvent)]
        self.assertEqual(len(wallets), 1)
        self.assertEqual(len(purchases), 1)
        wallet = wallets[0]
        purchase = purchases[0]
        self.assertEqual(wallet.token_limit, 200_000)
        self.assertEqual(wallet.remaining_tokens, 200_000)
        self.assertEqual(wallet.used_tokens, 0)
        self.assertEqual(wallet.last_purchase_id, purchase.id)
        self.assertEqual(wallet.last_purchase_tokens, 200_000)
        self.assertEqual(wallet.last_purchase_at, now)
        self.assertEqual(summary.token_limit, 200_000)
        self.assertEqual(summary.remaining_tokens, 200_000)
        self.assertEqual(summary.remaining_percent, 100)
        self.assertEqual(purchase.option_id, "signup_bonus_200k")
        self.assertEqual(purchase.label, "新用户注册赠送")
        self.assertEqual(purchase.tokens, 200_000)
        self.assertEqual(purchase.status, "signup_bonus_granted")
        self.assertEqual(purchase.source, "signup_bonus")
        self.assertEqual(purchase.before_remaining_tokens, 0)
        self.assertEqual(purchase.after_remaining_tokens, 200_000)
        self.assertEqual(purchase.before_token_limit, 0)
        self.assertEqual(purchase.after_token_limit, 200_000)
        self.assertEqual(session.commits, 0)

    async def test_signup_bonus_stacks_on_existing_wallet_without_resetting_usage(self) -> None:
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=250,
            used_tokens=750,
        )
        session = _FakeSession([wallet])

        summary = await billing_service.grant_signup_bonus(session, "user-1")

        self.assertEqual(wallet.token_limit, 201_000)
        self.assertEqual(wallet.remaining_tokens, 200_250)
        self.assertEqual(wallet.used_tokens, 750)
        self.assertEqual(summary.token_limit, 201_000)
        self.assertEqual(summary.remaining_tokens, 200_250)
        purchases = [item for item in session.added if isinstance(item, AITokenPurchaseEvent)]
        self.assertEqual(len(purchases), 1)
        self.assertEqual(purchases[0].before_remaining_tokens, 250)
        self.assertEqual(purchases[0].after_remaining_tokens, 200_250)
        self.assertEqual(purchases[0].before_token_limit, 1_000)
        self.assertEqual(purchases[0].after_token_limit, 201_000)


class BillingQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def test_zero_remaining_balance_rejects_ai_calls(self) -> None:
        wallet = AITokenWallet(user_id="user-1", token_limit=100, remaining_tokens=0, used_tokens=100)
        session = _FakeSession([wallet])

        with self.assertRaises(HTTPException) as raised:
            await billing_service.ensure_quota_available(session, "user-1")

        self.assertEqual(raised.exception.status_code, 402)
        self.assertEqual(raised.exception.detail["code"], "ai_token_quota_exhausted")

    async def test_unlimited_active_balance_allows_ai_calls_with_zero_remaining_tokens(self) -> None:
        now = billing_service.utc_now()
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=100,
            remaining_tokens=0,
            used_tokens=100,
            unlimited_tokens_expires_at=now + timedelta(days=7),
            unlimited_tokens_plan_name="月费无限套餐",
        )
        session = _FakeSession([wallet])

        summary = await billing_service.ensure_quota_available(session, "user-1")

        self.assertTrue(summary.is_unlimited)
        self.assertEqual(summary.unlimited_plan_name, "月费无限套餐")

    async def test_usage_event_deducts_real_total_tokens(self) -> None:
        wallet = AITokenWallet(user_id="user-1", token_limit=1000, remaining_tokens=800, used_tokens=200)
        session = _FakeSession([wallet])

        summary = await billing_service.record_usage_event(
            session,
            user_id="user-1",
            entrypoint="jd_analysis",
            request_label="jd_text_analysis",
            provider="dashscope",
            model="qwen3.7-plus",
            status="success",
            prompt_tokens=120,
            completion_tokens=30,
            total_tokens=150,
            metadata={"route": "/api/analyze-jd/stream"},
        )

        self.assertEqual(wallet.remaining_tokens, 650)
        self.assertEqual(wallet.used_tokens, 350)
        self.assertEqual(summary.remaining_tokens, 650)
        usage_events = [item for item in session.added if isinstance(item, AITokenUsageEvent)]
        self.assertEqual(len(usage_events), 1)
        self.assertEqual(usage_events[0].total_tokens, 150)
        self.assertEqual(usage_events[0].status, "success")

    async def test_usage_event_records_but_does_not_deduct_during_unlimited_plan(self) -> None:
        now = billing_service.utc_now()
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1000,
            remaining_tokens=25,
            used_tokens=975,
            unlimited_tokens_expires_at=now + timedelta(days=7),
            unlimited_tokens_plan_name="月费无限套餐",
        )
        session = _FakeSession([wallet])

        summary = await billing_service.record_usage_event(
            session,
            user_id="user-1",
            entrypoint="jd_analysis",
            request_label="jd_text_analysis",
            provider="dashscope",
            model="qwen3.7-plus",
            status="success",
            prompt_tokens=120,
            completion_tokens=30,
            total_tokens=150,
            metadata={"route": "/api/analyze-jd/stream"},
        )

        self.assertEqual(wallet.remaining_tokens, 25)
        self.assertEqual(wallet.used_tokens, 975)
        self.assertTrue(summary.is_unlimited)
        usage_events = [item for item in session.added if isinstance(item, AITokenUsageEvent)]
        self.assertEqual(len(usage_events), 1)
        self.assertEqual(usage_events[0].total_tokens, 150)
        self.assertEqual(usage_events[0].metadata_json["billing_mode"], "unlimited_time")

    async def test_expired_unlimited_plan_deducts_tokens_normally(self) -> None:
        now = billing_service.utc_now()
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1000,
            remaining_tokens=800,
            used_tokens=200,
            unlimited_tokens_expires_at=now - timedelta(days=1),
            unlimited_tokens_plan_name="月费无限套餐",
        )
        session = _FakeSession([wallet])

        summary = await billing_service.record_usage_event(
            session,
            user_id="user-1",
            entrypoint="jd_analysis",
            request_label="jd_text_analysis",
            provider="dashscope",
            model="qwen3.7-plus",
            status="success",
            prompt_tokens=120,
            completion_tokens=30,
            total_tokens=150,
        )

        self.assertEqual(wallet.remaining_tokens, 650)
        self.assertEqual(wallet.used_tokens, 350)
        self.assertFalse(summary.is_unlimited)

    async def test_usage_event_locks_wallet_row_before_deducting(self) -> None:
        wallet = AITokenWallet(user_id="user-1", token_limit=1000, remaining_tokens=800, used_tokens=200)
        session = _FakeSession([wallet])

        await billing_service.record_usage_event(
            session,
            user_id="user-1",
            entrypoint="jd_analysis",
            request_label="jd_text_analysis",
            provider="dashscope",
            model="qwen3.7-plus",
            status="success",
            prompt_tokens=120,
            completion_tokens=30,
            total_tokens=150,
            metadata={"route": "/api/analyze-jd/stream"},
        )

        self.assertTrue(session.statements)
        self.assertIsNotNone(getattr(session.statements[0], "_for_update_arg", None))

    async def test_record_current_usage_uses_isolated_session_without_committing_context_session(self) -> None:
        context_session = _FakeSession()
        isolated_wallet = AITokenWallet(user_id="user-1", token_limit=1000, remaining_tokens=800, used_tokens=200)
        isolated_session = _FakeSession([isolated_wallet])

        with patch.object(
            billing_service,
            "AsyncSessionFactory",
            _FakeSessionFactory(isolated_session),
            create=True,
        ):
            async with billing_service.ai_billing_context(
                context_session,
                "user-1",
                entrypoint="ai_assistant",
                metadata={"route": "/api/assistant/sessions/session-1/stream"},
            ):
                await billing_service.record_current_usage(
                    {
                        "request_label": "assistant_chat",
                        "provider": "dashscope",
                        "model": "qwen3.7-plus",
                        "status": "success",
                        "prompt_tokens": 100,
                        "completion_tokens": 50,
                        "total_tokens": 150,
                    }
                )

        self.assertEqual(context_session.commits, 0)
        self.assertEqual(context_session.added, [])
        self.assertEqual(isolated_session.commits, 1)
        self.assertEqual(isolated_wallet.remaining_tokens, 650)


class BillingSchemaTests(unittest.TestCase):
    def test_models_define_token_billing_tables(self) -> None:
        self.assertEqual(AITokenWallet.__tablename__, "ai_token_wallets")
        self.assertEqual(AITokenUsageEvent.__tablename__, "ai_token_usage_events")
        self.assertEqual(AITokenPurchaseEvent.__tablename__, "ai_token_purchase_events")
        self.assertTrue(hasattr(AITokenWallet, "unlimited_tokens_expires_at"))
        self.assertTrue(hasattr(AITokenWallet, "unlimited_tokens_plan_name"))

    def test_database_startup_ensures_billing_tables(self) -> None:
        with open("app/database.py", "r", encoding="utf-8") as handle:
            source = handle.read()
        with open("app/main.py", "r", encoding="utf-8") as handle:
            main_source = handle.read()
        with open("schema.sql", "r", encoding="utf-8") as handle:
            schema_source = handle.read()

        self.assertIn("async def ensure_ai_token_billing_tables", source)
        self.assertRegex(source, r"ensure_runtime_schema\(\)[\s\S]*await ensure_ai_token_billing_tables\(\)")
        self.assertRegex(main_source, r"lifespan\([\s\S]*await ensure_runtime_schema\(\)")
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_token_wallets", schema_source)
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_token_usage_events", schema_source)
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_token_purchase_events", schema_source)
        self.assertIn("unlimited_tokens_expires_at TIMESTAMPTZ", schema_source)
        self.assertIn("unlimited_tokens_plan_name TEXT", schema_source)


if __name__ == "__main__":
    unittest.main()
