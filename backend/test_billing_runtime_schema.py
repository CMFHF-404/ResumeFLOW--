import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app.runtime_schema.billing_tables import (
    AI_TOKEN_BILLING_STATEMENTS,
    REDEMPTION_CODE_STATEMENTS,
    execute_ai_token_billing_statements,
    execute_redemption_code_statements,
)


class _FakeConnection:
    async def execute(self, statement) -> None:
        raise AssertionError("wrapper tests patch the leaf executor")


class _FakeTransaction:
    def __init__(self, connection: _FakeConnection) -> None:
        self.connection = connection
        self.entered = False
        self.exited = False
        self.exit_exception_type = None

    async def __aenter__(self) -> _FakeConnection:
        self.entered = True
        return self.connection

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        self.exited = True
        self.exit_exception_type = exc_type


class _FakeEngine:
    def __init__(self, dialect_name: str) -> None:
        self.dialect = type("Dialect", (), {"name": dialect_name})()
        self.connection = _FakeConnection()
        self.transactions: list[_FakeTransaction] = []

    def begin(self) -> _FakeTransaction:
        transaction = _FakeTransaction(self.connection)
        self.transactions.append(transaction)
        return transaction


class BillingRuntimeSchemaLeafTests(unittest.IsolatedAsyncioTestCase):
    async def test_billing_statements_execute_in_declared_order(self) -> None:
        compiled: list[str] = []
        executed: list[str] = []

        def text_factory(statement: str) -> str:
            compiled.append(statement)
            return statement

        async def execute(statement: str) -> None:
            executed.append(statement)

        await execute_ai_token_billing_statements(
            execute=execute,
            text=text_factory,
        )

        self.assertEqual(compiled, list(AI_TOKEN_BILLING_STATEMENTS))
        self.assertEqual(executed, list(AI_TOKEN_BILLING_STATEMENTS))
        self.assertGreaterEqual(len(executed), 19)
        self.assertIn("CREATE EXTENSION", executed[0])
        self.assertIn("CREATE TABLE IF NOT EXISTS ai_token_wallets", executed[1])
        self.assertTrue(any("ALTER COLUMN token_limit TYPE BIGINT" in item for item in executed))
        self.assertTrue(any("uq_ai_token_purchase_events_source_id" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS payment_orders" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS payment_webhook_events" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS ai_unlimited_usage_alerts" in item for item in executed))

    async def test_redemption_statements_execute_in_declared_order(self) -> None:
        compiled: list[str] = []
        executed: list[str] = []

        def text_factory(statement: str) -> str:
            compiled.append(statement)
            return statement

        async def execute(statement: str) -> None:
            executed.append(statement)

        await execute_redemption_code_statements(
            execute=execute,
            text=text_factory,
        )

        self.assertEqual(compiled, list(REDEMPTION_CODE_STATEMENTS))
        self.assertEqual(executed, list(REDEMPTION_CODE_STATEMENTS))
        self.assertEqual(len(executed), 12)
        self.assertIn("CREATE EXTENSION", executed[0])
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_packages", executed[1])
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_batches", executed[3])
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_codes", executed[5])
        self.assertIn("idx_redemption_codes_code_prefix", executed[11])

    async def test_statement_error_propagates_and_stops_sequence(self) -> None:
        attempted: list[str] = []

        async def execute(statement: str) -> None:
            attempted.append(statement)
            if len(attempted) == 4:
                raise RuntimeError("ddl failed")

        with self.assertRaisesRegex(RuntimeError, "ddl failed"):
            await execute_ai_token_billing_statements(
                execute=execute,
                text=lambda statement: statement,
            )

        self.assertEqual(attempted, list(AI_TOKEN_BILLING_STATEMENTS[:4]))


class BillingRuntimeSchemaWrapperTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_postgresql_wrappers_are_no_ops(self) -> None:
        fake_engine = _FakeEngine("sqlite")
        billing_executor = AsyncMock()
        redemption_executor = AsyncMock()

        with (
            patch.object(database, "engine", fake_engine),
            patch.object(
                database,
                "execute_ai_token_billing_statements",
                billing_executor,
            ),
            patch.object(
                database,
                "execute_redemption_code_statements",
                redemption_executor,
            ),
        ):
            await database.ensure_ai_token_billing_tables()
            await database.ensure_redemption_code_tables()

        self.assertEqual(fake_engine.transactions, [])
        billing_executor.assert_not_awaited()
        redemption_executor.assert_not_awaited()

    async def test_postgresql_wrappers_delegate_inside_engine_transaction(self) -> None:
        for wrapper_name, executor_name in (
            (
                "ensure_ai_token_billing_tables",
                "execute_ai_token_billing_statements",
            ),
            (
                "ensure_redemption_code_tables",
                "execute_redemption_code_statements",
            ),
        ):
            with self.subTest(wrapper=wrapper_name):
                fake_engine = _FakeEngine("postgresql")
                executor = AsyncMock()
                text_factory = object()

                with (
                    patch.object(database, "engine", fake_engine),
                    patch.object(database, "text", text_factory),
                    patch.object(database, executor_name, executor),
                ):
                    await getattr(database, wrapper_name)()

                self.assertEqual(len(fake_engine.transactions), 1)
                transaction = fake_engine.transactions[0]
                self.assertTrue(transaction.entered)
                self.assertTrue(transaction.exited)
                executor.assert_awaited_once()
                kwargs = executor.await_args.kwargs
                self.assertIs(kwargs["execute"].__self__, fake_engine.connection)
                self.assertIs(kwargs["text"], text_factory)

    async def test_postgresql_wrappers_propagate_leaf_errors(self) -> None:
        for wrapper_name, executor_name in (
            (
                "ensure_ai_token_billing_tables",
                "execute_ai_token_billing_statements",
            ),
            (
                "ensure_redemption_code_tables",
                "execute_redemption_code_statements",
            ),
        ):
            with self.subTest(wrapper=wrapper_name):
                fake_engine = _FakeEngine("postgresql")
                executor = AsyncMock(side_effect=RuntimeError("ddl failed"))

                with (
                    patch.object(database, "engine", fake_engine),
                    patch.object(database, executor_name, executor),
                ):
                    with self.assertRaisesRegex(RuntimeError, "ddl failed"):
                        await getattr(database, wrapper_name)()

                transaction = fake_engine.transactions[0]
                self.assertTrue(transaction.exited)
                self.assertIs(transaction.exit_exception_type, RuntimeError)


class BillingRuntimeSchemaStaticTests(unittest.TestCase):
    def test_leaf_module_has_no_database_reverse_dependency(self) -> None:
        source = (
            Path(__file__).resolve().parent
            / "app"
            / "runtime_schema"
            / "billing_tables.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("from ..database", source)
        self.assertNotIn("from app.database", source)
        self.assertNotIn("import app.database", source)

    def test_schema_sql_covers_runtime_billing_and_redemption_surface(self) -> None:
        schema = (Path(__file__).resolve().parent / "schema.sql").read_text(
            encoding="utf-8"
        )
        expected_fragments = (
            "CREATE TABLE IF NOT EXISTS ai_token_wallets",
            "CREATE TABLE IF NOT EXISTS ai_token_usage_events",
            "CREATE TABLE IF NOT EXISTS ai_token_purchase_events",
            "unlimited_tokens_expires_at TIMESTAMPTZ",
            "unlimited_tokens_plan_name TEXT",
            "source TEXT NOT NULL DEFAULT 'placeholder_purchase'",
            "source_id TEXT",
            "metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "idx_ai_token_usage_events_user_created",
            "idx_ai_token_usage_events_entrypoint",
            "idx_ai_token_purchase_events_user_created",
            "idx_ai_token_purchase_events_source",
            "uq_ai_token_purchase_events_source_id",
            "CREATE TABLE IF NOT EXISTS payment_orders",
            "CREATE TABLE IF NOT EXISTS payment_webhook_events",
            "uq_payment_orders_user_idempotency",
            "idx_payment_orders_user_created",
            "idx_payment_orders_status",
            "idx_payment_webhook_events_order",
            "CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases",
            "CREATE TABLE IF NOT EXISTS ai_unlimited_usage_alerts",
            "idx_ai_unlimited_request_leases_user_recent",
            "idx_ai_unlimited_request_leases_active",
            "threshold_tokens BIGINT",
            "CREATE TABLE IF NOT EXISTS redemption_packages",
            "CREATE TABLE IF NOT EXISTS redemption_batches",
            "CREATE TABLE IF NOT EXISTS redemption_codes",
            "benefit_type TEXT NOT NULL DEFAULT 'tokens'",
            "unlimited_duration_days INTEGER",
            "unlimited_duration_hours INTEGER",
            "idx_redemption_batches_package_id",
            "idx_redemption_codes_batch_id",
            "idx_redemption_codes_package_id",
            "idx_redemption_codes_status",
            "idx_redemption_codes_code_prefix",
        )

        for fragment in expected_fragments:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, schema)

    def test_payment_and_guard_migrations_are_self_contained(self) -> None:
        backend_root = Path(__file__).resolve().parent
        payment_migration = (
            backend_root / "migrations" / "009_add_yifut_payments.sql"
        ).read_text(encoding="utf-8")
        guard_migration = (
            backend_root / "migrations" / "010_add_unlimited_usage_guard.sql"
        ).read_text(encoding="utf-8")

        for fragment in (
            "ADD COLUMN IF NOT EXISTS source TEXT",
            "ADD COLUMN IF NOT EXISTS source_id TEXT",
            "CREATE TABLE IF NOT EXISTS payment_orders",
            "CREATE TABLE IF NOT EXISTS payment_webhook_events",
            "uq_ai_token_purchase_events_source_id",
        ):
            with self.subTest(migration="payment", fragment=fragment):
                self.assertIn(fragment, payment_migration)
        for fragment in (
            "CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases",
            "CREATE TABLE IF NOT EXISTS ai_unlimited_usage_alerts",
            "TIMESTAMPTZ",
            "threshold_tokens BIGINT",
        ):
            with self.subTest(migration="guard", fragment=fragment):
                self.assertIn(fragment, guard_migration)


if __name__ == "__main__":
    unittest.main()
