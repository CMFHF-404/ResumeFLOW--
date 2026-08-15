import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app.models import (
    PaymentOrder,
    PaymentOrderIdempotencyAlias,
    PaymentOrderProviderOpenClaim,
    PaymentOrderStateRevision,
)
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
        self.assertTrue(any("cancelled_at TIMESTAMPTZ" in item for item in executed))
        self.assertTrue(any("ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ" in item for item in executed))
        self.assertTrue(any("state_version BIGINT NOT NULL DEFAULT 1" in item for item in executed))
        self.assertTrue(any("idx_payment_orders_pending_expires" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases" in item for item in executed))
        self.assertTrue(any("INSERT INTO payment_order_idempotency_aliases" in item for item in executed))
        self.assertTrue(any("idx_payment_order_idempotency_aliases_order" in item for item in executed))
        self.assertTrue(any("payment_order_claim_original_idempotency_key" in item for item in executed))
        self.assertTrue(any("payment_order_bump_state_version" in item for item in executed))
        self.assertTrue(any("trg_payment_order_claim_original_idempotency_key" in item for item in executed))
        self.assertTrue(any("trg_payment_order_bump_state_version" in item for item in executed))
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS payment_order_state_revisions" in item for item in executed))
        self.assertTrue(any("payment_order_advance_state_revision" in item for item in executed))
        self.assertTrue(any("trg_payment_order_advance_state_revision" in item for item in executed))
        state_revision_backfill = next(
            item
            for item in executed
            if "SUM(orders.state_version) OVER (PARTITION BY orders.user_id)" in item
        )
        self.assertIn("WHERE NOT EXISTS", state_revision_backfill)
        self.assertIn(
            "FROM payment_order_state_revisions AS existing_revision",
            state_revision_backfill,
        )
        self.assertIn(
            "existing_revision.user_id = orders.user_id",
            state_revision_backfill,
        )
        claim_trigger_index = next(
            index
            for index, item in enumerate(executed)
            if "CREATE TRIGGER trg_payment_order_claim_original_idempotency_key" in item
        )
        alias_backfill_index = next(
            index
            for index, item in enumerate(executed)
            if "SELECT user_id, idempotency_key, id, created_at" in item
        )
        self.assertLess(claim_trigger_index, alias_backfill_index)
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
            "cancelled_at TIMESTAMPTZ",
            "state_version BIGINT NOT NULL DEFAULT 1",
            "idx_payment_orders_pending_expires",
            "CREATE TABLE IF NOT EXISTS payment_order_provider_open_claims",
            "INSERT INTO payment_order_provider_open_claims",
            "payment_order_enforce_provider_open_per_user",
            "trg_payment_order_enforce_provider_open_per_user",
            "payment_order_reconciliation_required",
            "status IN ('pending', 'paid')",
            "existing.status NOT IN ('pending', 'paid')",
            "CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases",
            "PRIMARY KEY (user_id, idempotency_key)",
            "INSERT INTO payment_order_idempotency_aliases",
            "idx_payment_order_idempotency_aliases_order",
            "payment_order_claim_original_idempotency_key",
            "trg_payment_order_claim_original_idempotency_key",
            "payment_order_bump_state_version",
            "trg_payment_order_bump_state_version",
            "CREATE TABLE IF NOT EXISTS payment_order_state_revisions",
            "payment_order_advance_state_revision",
            "trg_payment_order_advance_state_revision",
            "SUM(orders.state_version) OVER (PARTITION BY orders.user_id)",
            "FROM payment_order_state_revisions AS existing_revision",
            "existing_revision.user_id = orders.user_id",
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
        cancellation_migration = (
            backend_root / "migrations" / "011_add_payment_order_cancellation.sql"
        ).read_text(encoding="utf-8")
        alias_migration = (
            backend_root / "migrations" / "012_add_payment_order_idempotency_aliases.sql"
        ).read_text(encoding="utf-8")
        state_version_migration = (
            backend_root / "migrations" / "013_add_payment_order_state_version.sql"
        ).read_text(encoding="utf-8")
        writer_guard_migration = (
            backend_root / "migrations" / "014_add_payment_order_writer_guards.sql"
        ).read_text(encoding="utf-8")
        terminal_repurchase_migration = (
            backend_root
            / "migrations"
            / "015_allow_repurchase_after_terminal_order.sql"
        ).read_text(encoding="utf-8")
        state_revision_migration = (
            backend_root
            / "migrations"
            / "016_add_payment_order_state_revisions.sql"
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
        for fragment in (
            "ALTER TABLE payment_orders",
            "ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ",
            "idx_payment_orders_pending_expires",
            "WHERE status = 'pending'",
        ):
            with self.subTest(migration="cancellation", fragment=fragment):
                self.assertIn(fragment, cancellation_migration)
        for fragment in (
            "CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases",
            "PRIMARY KEY (user_id, idempotency_key)",
            "REFERENCES payment_orders(id) ON DELETE CASCADE",
            "INSERT INTO payment_order_idempotency_aliases",
            "SELECT user_id, idempotency_key, id, created_at",
            "ON CONFLICT (user_id, idempotency_key) DO NOTHING",
            "idx_payment_order_idempotency_aliases_order",
        ):
            with self.subTest(migration="idempotency_alias", fragment=fragment):
                self.assertIn(fragment, alias_migration)
        for fragment in (
            "ALTER TABLE payment_orders",
            "ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1",
        ):
            with self.subTest(migration="state_version", fragment=fragment):
                self.assertIn(fragment, state_version_migration)
        for fragment in (
            "payment_order_claim_original_idempotency_key",
            "INSERT INTO payment_order_idempotency_aliases",
            "trg_payment_order_claim_original_idempotency_key",
            "AFTER INSERT ON payment_orders",
            "payment_order_bump_state_version",
            "NEW.state_version = OLD.state_version",
            "trg_payment_order_bump_state_version",
            "BEFORE UPDATE ON payment_orders",
            "payment_order_reconciliation_required",
            "CREATE TABLE IF NOT EXISTS payment_order_provider_open_claims",
            "INSERT INTO payment_order_provider_open_claims",
            "payment_order_enforce_provider_open_per_user",
            "trg_payment_order_enforce_provider_open_per_user",
            "status IN ('pending', 'paid', 'cancelled', 'expired')",
        ):
            with self.subTest(migration="writer_guards", fragment=fragment):
                self.assertIn(fragment, writer_guard_migration)
        self.assertLess(
            writer_guard_migration.index(
                "CREATE TRIGGER trg_payment_order_claim_original_idempotency_key"
            ),
            writer_guard_migration.index(
                "SELECT user_id, idempotency_key, id, created_at"
            ),
        )

        for fragment in (
            "CREATE TABLE IF NOT EXISTS payment_order_state_revisions",
            "revision BIGINT NOT NULL DEFAULT 0",
            "payment_order_advance_state_revision",
            "trg_payment_order_advance_state_revision",
            "AFTER INSERT OR UPDATE OR DELETE ON payment_orders",
            "SUM(orders.state_version) OVER (PARTITION BY orders.user_id)",
            "WHERE NOT EXISTS",
            "FROM payment_order_state_revisions AS existing_revision",
            "existing_revision.user_id = orders.user_id",
            "ON CONFLICT (user_id) DO NOTHING",
        ):
            with self.subTest(migration="state_revision", fragment=fragment):
                self.assertIn(fragment, state_revision_migration)

        self.assertLess(
            writer_guard_migration.index("payment_order_reconciliation_required"),
            writer_guard_migration.index(
                "CREATE TRIGGER trg_payment_order_enforce_provider_open_per_user"
            ),
        )

        for fragment in (
            "CREATE OR REPLACE FUNCTION payment_order_enforce_provider_open_per_user",
            "status IN ('pending', 'paid')",
            "existing.status NOT IN ('pending', 'paid')",
            "DELETE FROM payment_order_provider_open_claims AS claim",
            "INSERT INTO payment_order_provider_open_claims",
        ):
            with self.subTest(migration="terminal_repurchase", fragment=fragment):
                self.assertIn(fragment, terminal_repurchase_migration)
        self.assertLess(
            terminal_repurchase_migration.index(
                "DELETE FROM payment_order_provider_open_claims AS claim"
            ),
            terminal_repurchase_migration.rindex(
                "INSERT INTO payment_order_provider_open_claims"
            ),
        )

    def test_payment_order_state_version_model_matches_ddl_contract(self) -> None:
        column = PaymentOrder.__table__.columns.state_version
        self.assertFalse(column.nullable)
        self.assertEqual(str(column.type), "BIGINT")
        self.assertEqual(str(column.server_default.arg), "1")

    def test_payment_order_state_revision_model_matches_ddl_contract(self) -> None:
        table = PaymentOrderStateRevision.__table__
        self.assertEqual(
            [column.name for column in table.primary_key.columns],
            ["user_id"],
        )
        self.assertEqual(str(table.columns.revision.type), "BIGINT")
        self.assertFalse(table.columns.revision.nullable)
        self.assertEqual(str(table.columns.revision.server_default.arg), "0")
        self.assertIsNone(next(iter(table.columns.latest_order_id.foreign_keys), None))

    def test_payment_order_idempotency_alias_model_matches_ddl_contract(self) -> None:
        table = PaymentOrderIdempotencyAlias.__table__
        self.assertEqual(
            [column.name for column in table.primary_key.columns],
            ["user_id", "idempotency_key"],
        )
        self.assertEqual(
            {index.name for index in table.indexes},
            {"idx_payment_order_idempotency_aliases_order"},
        )
        foreign_keys = {
            column.name: next(iter(column.foreign_keys))
            for column in table.columns
            if column.foreign_keys
        }
        self.assertEqual(foreign_keys["user_id"].target_fullname, "users.id")
        self.assertEqual(foreign_keys["payment_order_id"].target_fullname, "payment_orders.id")
        self.assertEqual(foreign_keys["user_id"].ondelete, "CASCADE")
        self.assertEqual(foreign_keys["payment_order_id"].ondelete, "CASCADE")

    def test_payment_order_provider_open_claim_model_matches_ddl_contract(self) -> None:
        table = PaymentOrderProviderOpenClaim.__table__
        self.assertEqual([column.name for column in table.primary_key], ["user_id"])
        self.assertTrue(table.columns.payment_order_id.unique)
        self.assertFalse(table.columns.payment_order_id.nullable)
        foreign_keys = {
            column.name: next(iter(column.foreign_keys))
            for column in table.columns
            if column.foreign_keys
        }
        self.assertEqual(foreign_keys["user_id"].target_fullname, "users.id")
        self.assertEqual(
            foreign_keys["payment_order_id"].target_fullname,
            "payment_orders.id",
        )


if __name__ == "__main__":
    unittest.main()
