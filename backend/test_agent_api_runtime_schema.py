import re
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import database
from app.runtime_schema.agent_api_tables import (
    AGENT_API_TABLE_STATEMENTS,
    execute_agent_api_table_statements,
)


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
        self.assertIn("ADD COLUMN IF NOT EXISTS key_plaintext", executed[2])
        self.assertIn("ranked_active_keys", executed[3])
        self.assertIn("uniq_agent_api_keys_active_user", executed[6])

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
