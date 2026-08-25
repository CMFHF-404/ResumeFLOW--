"""Opt-in PostgreSQL proof for the Agent API-key Phase-B boundary.

The test requires an explicitly supplied local PostgreSQL URL, creates a
uniquely named schema, and removes only that schema in ``finally``. It never
falls back to the application's normal ``DATABASE_URL``.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import unittest
from urllib.parse import urlsplit
import uuid

import asyncpg

from app.runtime_schema.agent_api_tables import (
    AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
    AGENT_API_TABLE_STATEMENTS,
)


RUN_ENV = "RUN_AGENT_API_PHASE_B_POSTGRES_TESTS"
DATABASE_URL_ENV = "AGENT_API_PHASE_B_TEST_DATABASE_URL"
LOCAL_POSTGRES_HOSTS = {"127.0.0.1", "::1", "localhost"}
PHASE_B_LOCK_KEY = 5928497734025232972


def _normalize_asyncpg_url(value: str) -> str:
    if value.startswith("postgresql+asyncpg://"):
        value = value.replace("postgresql+asyncpg://", "postgresql://", 1)
    elif value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql://", 1)
    if not value.startswith("postgresql://"):
        raise AssertionError(f"{DATABASE_URL_ENV} must use PostgreSQL")
    parsed = urlsplit(value)
    if parsed.hostname not in LOCAL_POSTGRES_HOSTS:
        raise AssertionError(
            f"{DATABASE_URL_ENV} must target an explicitly local PostgreSQL host"
        )
    return value


@unittest.skipUnless(
    os.getenv(RUN_ENV) == "1" and bool(os.getenv(DATABASE_URL_ENV, "").strip()),
    f"set {RUN_ENV}=1 with a local isolated {DATABASE_URL_ENV}",
)
class AgentApiPhaseBPostgresTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    async def _apply_runtime_schema(connection) -> None:
        async with connection.transaction():
            for statement in AGENT_API_TABLE_STATEMENTS:
                await connection.execute(statement)

    async def test_phase_b_marker_survives_runtime_restart_and_repeat(self) -> None:
        database_url = _normalize_asyncpg_url(
            os.environ[DATABASE_URL_ENV].strip()
        )
        schema_name = f"agent_phase_b_test_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        connection = await asyncpg.connect(database_url)
        migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "017_drop_agent_api_key_plaintext_phase_b.sql"
        ).read_text(encoding="utf-8")

        async def plaintext_column_exists() -> bool:
            return bool(
                await connection.fetchval(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = $1
                          AND table_name = 'agent_api_keys'
                          AND column_name = 'key_plaintext'
                    )
                    """,
                    schema_name,
                )
            )

        try:
            await connection.execute(f"CREATE SCHEMA {quoted_schema}")
            await connection.execute(f"SET search_path TO {quoted_schema}")
            await connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")

            await self._apply_runtime_schema(connection)
            self.assertTrue(await plaintext_column_exists())

            await connection.execute(
                "INSERT INTO users (id) VALUES ('phase-b-user'), ('hash-only-user')"
            )
            await connection.execute(
                """
                INSERT INTO agent_api_keys (
                    user_id, name, key_prefix, key_hash, key_plaintext
                ) VALUES (
                    'phase-b-user', 'legacy', 'rfag_phaseb', 'hash-before-b',
                    'rfag_plaintext_must_be_scrubbed'
                )
                """
            )
            await connection.execute(
                """
                INSERT INTO agent_api_keys (
                    user_id, name, key_prefix, key_hash
                ) VALUES (
                    'hash-only-user', 'hash-only-existing', 'rfag_hash_existing',
                    'hash-only-must-remain-active'
                )
                """
            )

            await connection.execute(
                "SET resumeflow.agent_api_key_plaintext_phase_b = 'old-writers-drained'"
            )
            await connection.execute(migration_source)
            self.assertFalse(await plaintext_column_exists())
            self.assertTrue(
                await connection.fetchval(
                    """
                    SELECT revoked_at IS NOT NULL
                    FROM agent_api_keys
                    WHERE user_id = 'phase-b-user'
                    """
                )
            )
            self.assertTrue(
                await connection.fetchval(
                    """
                    SELECT revoked_at IS NULL
                    FROM agent_api_keys
                    WHERE user_id = 'hash-only-user'
                    """
                )
            )
            self.assertEqual(
                await connection.fetchval(
                    """
                    SELECT key_hash
                    FROM agent_api_keys
                    WHERE user_id = 'hash-only-user'
                    """
                ),
                "hash-only-must-remain-active",
            )
            self.assertEqual(
                await connection.fetchval(
                    """
                    SELECT marker
                    FROM runtime_schema_migration_markers
                    WHERE marker = $1
                    """,
                    AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
                ),
                AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
            )

            # Model the next application startup. The durable marker must make
            # the runtime guard skip its legacy ADD COLUMN.
            await self._apply_runtime_schema(connection)
            self.assertFalse(await plaintext_column_exists())

            # New writers only need the hash-era columns after Phase B.
            await connection.execute(
                """
                INSERT INTO agent_api_keys (user_id, name, key_prefix, key_hash)
                VALUES ('phase-b-user', 'hash-only', 'rfag_hashonly', 'hash-after-b')
                ON CONFLICT (user_id) WHERE revoked_at IS NULL
                DO UPDATE SET
                    name = EXCLUDED.name,
                    key_prefix = EXCLUDED.key_prefix,
                    key_hash = EXCLUDED.key_hash
                """
            )
            self.assertEqual(
                await connection.fetchval(
                    """
                    SELECT key_hash
                    FROM agent_api_keys
                    WHERE user_id = 'phase-b-user'
                      AND revoked_at IS NULL
                    """
                ),
                "hash-after-b",
            )

            # A guarded retry is idempotent and still cannot recreate the
            # retired column.
            await connection.execute(
                "SET resumeflow.agent_api_key_plaintext_phase_b = 'old-writers-drained'"
            )
            await connection.execute(migration_source)
            self.assertFalse(await plaintext_column_exists())
        finally:
            await connection.execute("RESET search_path")
            if not schema_name.startswith("agent_phase_b_test_"):
                raise AssertionError("refusing to drop a non-test schema")
            await connection.execute(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE")
            await connection.close()

    async def test_concurrent_runtime_startup_cannot_readd_plaintext_after_phase_b(
        self,
    ) -> None:
        database_url = _normalize_asyncpg_url(os.environ[DATABASE_URL_ENV].strip())
        schema_name = f"agent_phase_b_test_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        setup_connection = await asyncpg.connect(database_url)
        migration_connection = await asyncpg.connect(database_url)
        runtime_connection = await asyncpg.connect(database_url)
        runtime_task: asyncio.Task | None = None
        migration_committed = False
        migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "017_drop_agent_api_key_plaintext_phase_b.sql"
        ).read_text(encoding="utf-8")

        async def plaintext_column_exists() -> bool:
            return bool(
                await setup_connection.fetchval(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = $1
                          AND table_name = 'agent_api_keys'
                          AND column_name = 'key_plaintext'
                    )
                    """,
                    schema_name,
                )
            )

        try:
            await setup_connection.execute(f"CREATE SCHEMA {quoted_schema}")
            for connection in (setup_connection, migration_connection, runtime_connection):
                await connection.execute(f"SET search_path TO {quoted_schema}")
            await setup_connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            await self._apply_runtime_schema(setup_connection)
            self.assertTrue(await plaintext_column_exists())

            await migration_connection.execute(
                "SET resumeflow.agent_api_key_plaintext_phase_b = 'old-writers-drained'"
            )
            await migration_connection.execute("BEGIN")
            await migration_connection.execute(
                f"SELECT pg_advisory_xact_lock({PHASE_B_LOCK_KEY})"
            )
            await migration_connection.execute(
                "LOCK TABLE agent_api_keys IN ACCESS EXCLUSIVE MODE"
            )

            runtime_pid = runtime_connection.get_server_pid()
            runtime_task = asyncio.create_task(
                self._apply_runtime_schema(runtime_connection)
            )
            for _ in range(200):
                blocked = await setup_connection.fetchval(
                    "SELECT cardinality(pg_blocking_pids($1)) > 0",
                    runtime_pid,
                )
                if blocked:
                    break
                await asyncio.sleep(0.01)
            else:
                self.fail("runtime startup did not reach the migration lock boundary")

            # Execute the real migration source while the runtime startup is
            # waiting. BEGIN/lock acquisition are repeat-safe in this session.
            await migration_connection.execute(migration_source)
            migration_committed = True
            await asyncio.wait_for(runtime_task, timeout=10)

            self.assertEqual(
                await setup_connection.fetchval(
                    """
                    SELECT marker
                    FROM runtime_schema_migration_markers
                    WHERE marker = $1
                    """,
                    AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
                ),
                AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER,
            )
            self.assertFalse(await plaintext_column_exists())
        finally:
            if runtime_task is not None and not runtime_task.done():
                runtime_task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await runtime_task
            if not migration_committed:
                await migration_connection.execute("ROLLBACK")
            await runtime_connection.close()
            await migration_connection.close()
            await setup_connection.execute("RESET search_path")
            if not schema_name.startswith("agent_phase_b_test_"):
                raise AssertionError("refusing to drop a non-test schema")
            await setup_connection.execute(
                f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE"
            )
            await setup_connection.close()

    async def test_cas_user_lock_is_compatible_with_legacy_foreign_key_insert(
        self,
    ) -> None:
        database_url = _normalize_asyncpg_url(os.environ[DATABASE_URL_ENV].strip())
        schema_name = f"agent_phase_b_test_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        setup_connection = await asyncpg.connect(database_url)
        cas_connection = await asyncpg.connect(database_url)
        legacy_connection = await asyncpg.connect(database_url)
        cas_transaction_open = False

        try:
            await setup_connection.execute(f"CREATE SCHEMA {quoted_schema}")
            for connection in (
                setup_connection,
                cas_connection,
                legacy_connection,
            ):
                await connection.execute(f"SET search_path TO {quoted_schema}")
            await setup_connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            await self._apply_runtime_schema(setup_connection)
            await setup_connection.execute("INSERT INTO users (id) VALUES ('mixed-user')")

            await cas_connection.execute("BEGIN")
            cas_transaction_open = True
            await cas_connection.execute(
                "SELECT id FROM users WHERE id = 'mixed-user' FOR NO KEY UPDATE"
            )

            # A legacy writer flushes the key row and therefore performs a
            # users FK check. KEY SHARE must remain compatible with the CAS
            # user lock; FOR UPDATE would block here and recreate the mixed
            # User -> key / key -> User deadlock cycle.
            await asyncio.wait_for(
                legacy_connection.execute(
                    """
                    INSERT INTO agent_api_keys (
                        user_id, name, key_prefix, key_hash, key_plaintext
                    ) VALUES (
                        'mixed-user', 'legacy', 'rfag_mixed', 'mixed-hash',
                        'rfag_mixed-secret'
                    )
                    """
                ),
                timeout=2,
            )
        finally:
            if cas_transaction_open:
                await cas_connection.execute("ROLLBACK")
            await legacy_connection.close()
            await cas_connection.close()
            await setup_connection.execute("RESET search_path")
            if not schema_name.startswith("agent_phase_b_test_"):
                raise AssertionError("refusing to drop a non-test schema")
            await setup_connection.execute(
                f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE"
            )
            await setup_connection.close()


if __name__ == "__main__":
    unittest.main()
