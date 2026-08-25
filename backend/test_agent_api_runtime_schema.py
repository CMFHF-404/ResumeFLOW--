import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app.runtime_schema.agent_api_tables import (
    AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
    AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER_TABLE,
    AGENT_API_TABLE_STATEMENTS,
    execute_agent_api_table_statements,
)


PHASE_B_MIGRATION_LOCK_SQL = "select pg_advisory_xact_lock(5928497734025232972)"
PHASE_B_RUNTIME_LOCK_SQL = "perform pg_advisory_xact_lock(5928497734025232972)"


class _FakeConnection:
    async def execute(self, statement) -> None:
        raise AssertionError("wrapper tests patch the leaf executor")


class _FakeTransaction:
    def __init__(self, connection: _FakeConnection) -> None:
        self.connection = connection
        self.exited = False
        self.exit_exception_type = None

    async def __aenter__(self) -> _FakeConnection:
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


class _AgentApiKeySchemaState:
    """Minimal SQL-state model for the runtime's Phase-A/Phase-B boundary."""

    def __init__(
        self,
        *,
        table_exists: bool,
        phase_b_completed: bool,
        plaintext_column_exists: bool,
    ) -> None:
        self.table_exists = table_exists
        self.phase_b_completed = phase_b_completed
        self.plaintext_column_exists = plaintext_column_exists
        self.marker_table_exists = phase_b_completed
        self.marker_recorded_after_drop = False

    async def execute(self, statement: str) -> None:
        normalized = re.sub(r"\s+", " ", statement).strip().lower()
        if "agent_api_key_plaintext_phase_b_runtime_guard" in normalized:
            self.marker_table_exists = True
            if not self.table_exists:
                self.table_exists = True
            if not self.phase_b_completed:
                self.plaintext_column_exists = True

    def apply_phase_b_sql_state(self) -> None:
        """Model Phase B's conditional scrub, DROP IF EXISTS, then marker write."""
        if self.plaintext_column_exists:
            # The migration's UPDATE only runs while the legacy column exists.
            self.plaintext_column_exists = False
        self.marker_recorded_after_drop = not self.plaintext_column_exists
        self.phase_b_completed = True
        self.marker_table_exists = True


class AgentApiRuntimeSchemaLeafTests(unittest.IsolatedAsyncioTestCase):
    async def test_statements_execute_in_declared_order(self) -> None:
        compiled: list[str] = []
        executed: list[str] = []

        def text_factory(statement: str) -> str:
            compiled.append(statement)
            return statement

        async def execute(statement: str) -> None:
            executed.append(statement)

        await execute_agent_api_table_statements(
            execute=execute,
            text=text_factory,
        )

        self.assertEqual(compiled, list(AGENT_API_TABLE_STATEMENTS))
        self.assertEqual(executed, list(AGENT_API_TABLE_STATEMENTS))
        runtime_guard = self._normalize_sql(executed[1])
        self.assertIn(PHASE_B_RUNTIME_LOCK_SQL, runtime_guard)
        self.assertLess(
            runtime_guard.index(PHASE_B_RUNTIME_LOCK_SQL),
            runtime_guard.index(
                f"create table if not exists {AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER_TABLE}"
            ),
        )
        self.assertLess(
            runtime_guard.index(PHASE_B_RUNTIME_LOCK_SQL),
            runtime_guard.index("create table if not exists agent_api_keys"),
        )
        self.assertLess(
            runtime_guard.index(PHASE_B_RUNTIME_LOCK_SQL),
            runtime_guard.index("if not exists"),
        )
        self.assertIn(AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER, executed[1])
        self.assertIn("ADD COLUMN IF NOT EXISTS key_plaintext", executed[1])
        self.assertIn("DROP TRIGGER IF EXISTS trg_agent_api_keys_discard_plaintext", executed[2])
        self.assertIn("DROP FUNCTION IF EXISTS discard_agent_api_key_plaintext", executed[3])
        self.assertIn("ranked_active_keys", executed[4])
        self.assertIn("uniq_agent_api_keys_active_user", executed[7])

    async def test_runtime_schema_state_model_keeps_phase_b_column_dropped(self) -> None:
        state = _AgentApiKeySchemaState(
            table_exists=True,
            phase_b_completed=True,
            plaintext_column_exists=False,
        )

        await execute_agent_api_table_statements(
            execute=state.execute,
            text=lambda statement: statement,
        )

        self.assertTrue(state.table_exists)
        self.assertTrue(state.phase_b_completed)
        self.assertFalse(state.plaintext_column_exists)

    async def test_runtime_schema_state_model_keeps_phase_a_legacy_column(self) -> None:
        state = _AgentApiKeySchemaState(
            table_exists=False,
            phase_b_completed=False,
            plaintext_column_exists=False,
        )

        await execute_agent_api_table_statements(
            execute=state.execute,
            text=lambda statement: statement,
        )

        self.assertTrue(state.table_exists)
        self.assertFalse(state.phase_b_completed)
        self.assertTrue(state.plaintext_column_exists)

    async def test_runtime_schema_state_model_preserves_existing_phase_a_column(self) -> None:
        state = _AgentApiKeySchemaState(
            table_exists=True,
            phase_b_completed=False,
            plaintext_column_exists=True,
        )

        await execute_agent_api_table_statements(
            execute=state.execute,
            text=lambda statement: statement,
        )

        self.assertTrue(state.plaintext_column_exists)

    async def test_phase_b_sql_state_model_is_repeat_safe_then_blocks_runtime_readd(self) -> None:
        state = _AgentApiKeySchemaState(
            table_exists=True,
            phase_b_completed=False,
            plaintext_column_exists=True,
        )

        state.apply_phase_b_sql_state()
        state.apply_phase_b_sql_state()
        await execute_agent_api_table_statements(
            execute=state.execute,
            text=lambda statement: statement,
        )

        self.assertTrue(state.marker_recorded_after_drop)
        self.assertTrue(state.phase_b_completed)
        self.assertFalse(state.plaintext_column_exists)

    async def test_phase_a_removes_rejected_trigger_without_scrubbing_legacy_values(self) -> None:
        trigger_installed = True
        stored_plaintexts = ["rfag_existing-secret"]

        async def execute(statement: str) -> None:
            nonlocal trigger_installed
            normalized = re.sub(r"\s+", " ", statement).strip().lower()
            if "create trigger trg_agent_api_keys_discard_plaintext" in normalized:
                trigger_installed = True
            if "drop trigger if exists trg_agent_api_keys_discard_plaintext" in normalized:
                trigger_installed = False
            if (
                "update agent_api_keys" in normalized
                and "set key_plaintext = null" in normalized
            ):
                stored_plaintexts[:] = [None for _ in stored_plaintexts]

        await execute_agent_api_table_statements(
            execute=execute,
            text=lambda statement: statement,
        )

        # Model the old writer's INSERT contract after Phase A completes. A
        # scrub trigger would turn this value into NULL and break its response.
        legacy_insert = "rfag_legacy-writer-secret"
        stored_plaintexts.append(None if trigger_installed else legacy_insert)

        self.assertFalse(trigger_installed)
        self.assertEqual(
            stored_plaintexts,
            ["rfag_existing-secret", "rfag_legacy-writer-secret"],
        )

    async def test_statement_error_stops_the_sequence(self) -> None:
        attempted: list[str] = []

        async def execute(statement: str) -> None:
            attempted.append(statement)
            if len(attempted) == 4:
                raise RuntimeError("ddl failed")

        with self.assertRaisesRegex(RuntimeError, "ddl failed"):
            await execute_agent_api_table_statements(
                execute=execute,
                text=lambda statement: statement,
            )

        self.assertEqual(attempted, list(AGENT_API_TABLE_STATEMENTS[:4]))

    @staticmethod
    def _normalize_sql(statement: str) -> str:
        return re.sub(r"\s+", " ", statement).strip().rstrip(";").lower()


class AgentApiRuntimeSchemaWrapperTests(unittest.IsolatedAsyncioTestCase):
    async def test_non_postgresql_wrapper_is_a_no_op(self) -> None:
        fake_engine = _FakeEngine("sqlite")
        executor = AsyncMock()

        with (
            patch.object(database, "engine", fake_engine),
            patch.object(database, "execute_agent_api_table_statements", executor),
        ):
            await database.ensure_agent_api_keys_table()

        executor.assert_not_awaited()
        self.assertEqual(fake_engine.transactions, [])

    async def test_postgresql_wrapper_delegates_inside_one_transaction(self) -> None:
        fake_engine = _FakeEngine("postgresql")
        executor = AsyncMock()
        text_factory = object()

        with (
            patch.object(database, "engine", fake_engine),
            patch.object(database, "text", text_factory),
            patch.object(database, "execute_agent_api_table_statements", executor),
        ):
            await database.ensure_agent_api_keys_table()

        self.assertEqual(len(fake_engine.transactions), 1)
        transaction = fake_engine.transactions[0]
        self.assertTrue(transaction.exited)
        executor.assert_awaited_once()
        kwargs = executor.await_args.kwargs
        self.assertIs(kwargs["execute"].__self__, fake_engine.connection)
        self.assertIs(kwargs["text"], text_factory)

    async def test_postgresql_wrapper_propagates_leaf_errors(self) -> None:
        fake_engine = _FakeEngine("postgresql")
        executor = AsyncMock(side_effect=RuntimeError("ddl failed"))

        with (
            patch.object(database, "engine", fake_engine),
            patch.object(database, "execute_agent_api_table_statements", executor),
        ):
            with self.assertRaisesRegex(RuntimeError, "ddl failed"):
                await database.ensure_agent_api_keys_table()

        transaction = fake_engine.transactions[0]
        self.assertTrue(transaction.exited)
        self.assertIs(transaction.exit_exception_type, RuntimeError)


class AgentApiRuntimeSchemaStaticTests(unittest.TestCase):
    @staticmethod
    def _normalize_sql(statement: str) -> str:
        return re.sub(r"\s+", " ", statement).strip().rstrip(";").lower()

    def test_schema_sql_contains_each_runtime_statement(self) -> None:
        schema = (Path(__file__).resolve().parent / "schema.sql").read_text(
            encoding="utf-8"
        )
        normalized_schema = self._normalize_sql(schema)
        search_start = 0

        for statement in AGENT_API_TABLE_STATEMENTS:
            with self.subTest(statement=statement[:80]):
                normalized_statement = self._normalize_sql(statement)
                statement_index = normalized_schema.find(
                    normalized_statement,
                    search_start,
                )
                self.assertNotEqual(statement_index, -1)
                search_start = statement_index + len(normalized_statement)

    def test_phase_a_contains_no_plaintext_scrub_or_trigger_install(self) -> None:
        runtime_sql = self._normalize_sql("\n".join(AGENT_API_TABLE_STATEMENTS))
        schema = (Path(__file__).resolve().parent / "schema.sql").read_text(
            encoding="utf-8"
        )
        schema_sql = self._normalize_sql(schema)

        for source in (runtime_sql, schema_sql):
            with self.subTest(source=source[:80]):
                self.assertIn("key_plaintext text", source)
                self.assertIn(
                    "drop trigger if exists trg_agent_api_keys_discard_plaintext",
                    source,
                )
                self.assertIn(
                    "drop function if exists discard_agent_api_key_plaintext()",
                    source,
                )
                self.assertNotIn(
                    "create trigger trg_agent_api_keys_discard_plaintext",
                    source,
                )
                self.assertNotIn("new.key_plaintext := null", source)
                self.assertNotIn("set key_plaintext = null", source)

    def test_phase_b_migration_is_manual_guarded_and_ordered(self) -> None:
        phase_b = (
            Path(__file__).resolve().parent
            / "migrations"
            / "017_drop_agent_api_key_plaintext_phase_b.sql"
        ).read_text(encoding="utf-8")
        normalized = self._normalize_sql(phase_b)
        runtime_sql = self._normalize_sql("\n".join(AGENT_API_TABLE_STATEMENTS))

        guard_index = normalized.index(
            "current_setting( 'resumeflow.agent_api_key_plaintext_phase_b', true )"
        )
        migration_lock_index = normalized.index(PHASE_B_MIGRATION_LOCK_SQL)
        runtime_lock_index = runtime_sql.index(PHASE_B_RUNTIME_LOCK_SQL)
        runtime_condition_index = runtime_sql.index(
            "if not exists",
            runtime_lock_index,
        )
        runtime_marker_create_index = runtime_sql.index(
            "create table if not exists runtime_schema_migration_markers",
            runtime_lock_index,
        )
        runtime_agent_create_index = runtime_sql.index(
            "create table if not exists agent_api_keys",
            runtime_lock_index,
        )
        table_lock_index = normalized.index(
            "lock table agent_api_keys in access exclusive mode"
        )
        revoke_index = normalized.index(
            "update agent_api_keys set revoked_at = now() where key_plaintext is not null and revoked_at is null"
        )
        scrub_index = normalized.index(
            "update agent_api_keys set key_plaintext = null where key_plaintext is not null"
        )
        drop_index = normalized.index(
            "alter table agent_api_keys drop column if exists key_plaintext"
        )
        marker_index = normalized.index(
            "insert into runtime_schema_migration_markers (marker) values ('agent_api_keys.key_plaintext_phase_b')"
        )

        self.assertIn("old-writers-drained", normalized)
        self.assertIn("lock table agent_api_keys in access exclusive mode", normalized)
        self.assertIn("create table if not exists runtime_schema_migration_markers", normalized)
        self.assertIn("from pg_attribute", normalized)
        self.assertIn("'agent_api_keys'::regclass", normalized)
        self.assertLess(runtime_lock_index, runtime_marker_create_index)
        self.assertLess(runtime_lock_index, runtime_agent_create_index)
        self.assertLess(runtime_lock_index, runtime_condition_index)
        self.assertLess(guard_index, migration_lock_index)
        self.assertLess(migration_lock_index, table_lock_index)
        self.assertLess(table_lock_index, revoke_index)
        self.assertLess(revoke_index, scrub_index)
        self.assertLess(scrub_index, drop_index)
        self.assertLess(drop_index, marker_index)

    def test_phase_b_runbook_documents_irreversible_revoke_boundary(self) -> None:
        runbook = (
            Path(__file__).resolve().parent
            / "migrations"
            / "017_drop_agent_api_key_plaintext_phase_b.md"
        ).read_text(encoding="utf-8")
        normalized_runbook = " ".join(runbook.split())

        self.assertIn("old-writers-drained", runbook)
        self.assertIn("will be revoked", normalized_runbook)
        self.assertIn("hash-only keys", normalized_runbook)
        self.assertIn("plaintext_column_still_exists", runbook)
        self.assertIn("irreversible", runbook.lower())

    def test_leaf_module_has_no_database_reverse_dependency(self) -> None:
        source = (
            Path(__file__).resolve().parent
            / "app"
            / "runtime_schema"
            / "agent_api_tables.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("from ..database", source)
        self.assertNotIn("from app.database", source)
        self.assertNotIn("import app.database", source)
