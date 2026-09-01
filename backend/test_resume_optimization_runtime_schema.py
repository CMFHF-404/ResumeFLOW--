import os
import re
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID


JSON_COLUMNS = (
    "before_snapshot",
    "plan_json",
    "answers_json",
    "result_json",
    "after_snapshot",
    "post_evaluation_json",
    "error_json",
)

EXPECTED_COLUMNS = (
    "id",
    "user_id",
    "resume_id",
    "status",
    "optimizer_version",
    "policy_version",
    "prompt_version",
    "source_resume_updated_at",
    "source_evaluation_signature",
    "source_jd_signature",
    "source_snapshot_hash",
    "idempotency_key_hash",
    "request_hash",
    *JSON_COLUMNS,
    "accepted_change_ids",
    "applied_content_signature",
    "created_at",
    "updated_at",
    "applied_at",
    "completed_at",
)

EXPECTED_STATUSES = (
    "planning",
    "awaiting_answers",
    "preview_ready",
    "applying",
    "applied",
    "rescoring",
    "completed",
    "failed",
    "stale",
    "cancelled",
    "reverted",
)


class ResumeOptimizationRuntimeSchemaTests(unittest.IsolatedAsyncioTestCase):
    def _schema_authorities(self) -> dict[str, str]:
        backend_root = Path(__file__).resolve().parent
        return {
            "runtime": (
                backend_root
                / "app"
                / "runtime_schema"
                / "resume_optimization_tables.py"
            ).read_text(encoding="utf-8"),
            "bootstrap": (backend_root / "schema.sql").read_text(encoding="utf-8"),
            "migration": (
                backend_root
                / "migrations"
                / "020_add_resume_optimization_runs.sql"
            ).read_text(encoding="utf-8"),
        }

    @staticmethod
    def _normalize_sql(source: str) -> str:
        return re.sub(r"\s+", " ", source.replace(";", "")).strip()

    @staticmethod
    def _table_and_index_ddl(source: str) -> str:
        start_marker = "CREATE TABLE IF NOT EXISTS resume_optimization_runs"
        end_marker = "WHERE idempotency_key_hash IS NOT NULL"
        start = source.index(start_marker)
        end = source.index(end_marker, start) + len(end_marker)
        return source[start:end]

    def test_schema_authorities_contain_the_complete_table_contract(self) -> None:
        authorities = self._schema_authorities()
        required_fragments = (
            "CREATE TABLE IF NOT EXISTS resume_optimization_runs",
            "id UUID PRIMARY KEY DEFAULT gen_random_uuid()",
            "user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE",
            "resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE",
            "status TEXT NOT NULL",
            "optimizer_version TEXT NOT NULL",
            "policy_version TEXT NOT NULL",
            "prompt_version TEXT NOT NULL",
            "source_resume_updated_at TIMESTAMPTZ NOT NULL",
            "source_evaluation_signature TEXT NOT NULL",
            "source_jd_signature TEXT NOT NULL DEFAULT ''",
            "source_snapshot_hash TEXT NOT NULL",
            "idempotency_key_hash TEXT",
            "request_hash TEXT NOT NULL",
            "before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",
            "plan_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "answers_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "result_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",
            "post_evaluation_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "error_json JSONB NOT NULL DEFAULT '{}'::jsonb",
            "accepted_change_ids TEXT[] NOT NULL DEFAULT '{}'::text[]",
            "applied_content_signature TEXT",
            "created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
            "applied_at TIMESTAMPTZ",
            "completed_at TIMESTAMPTZ",
            "ck_resume_optimization_runs_status",
            "idx_resume_optimization_runs_user_id",
            "idx_resume_optimization_runs_resume_created",
            "idx_resume_optimization_runs_status",
            "uniq_resume_optimization_runs_user_idempotency",
            "WHERE idempotency_key_hash IS NOT NULL",
        )

        for authority_name, source in authorities.items():
            for fragment in required_fragments:
                with self.subTest(authority=authority_name, fragment=fragment):
                    self.assertIn(fragment, source)

            for status in EXPECTED_STATUSES:
                with self.subTest(authority=authority_name, status=status):
                    self.assertIn(f"'{status}'", source)

            for column_name in JSON_COLUMNS:
                with self.subTest(authority=authority_name, json_column=column_name):
                    self.assertIn(
                        f"jsonb_typeof({column_name}) = 'object'",
                        source,
                    )
                    self.assertIn(
                        f"octet_length({column_name}::text) <= 4194304",
                        source,
                    )

    def test_numbered_migration_is_idempotent(self) -> None:
        migration = self._schema_authorities()["migration"]

        self.assertIn('CREATE EXTENSION IF NOT EXISTS "pgcrypto"', migration)
        self.assertIn("CREATE TABLE IF NOT EXISTS resume_optimization_runs", migration)
        self.assertEqual(
            migration.count("CREATE INDEX IF NOT EXISTS idx_resume_optimization_runs_"),
            3,
        )
        self.assertIn(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uniq_resume_optimization_runs_user_idempotency",
            migration,
        )

    def test_table_and_index_ddl_is_aligned_across_all_authorities(self) -> None:
        from app.runtime_schema.resume_optimization_tables import (
            RESUME_OPTIMIZATION_TABLE_STATEMENTS,
        )

        authorities = self._schema_authorities()
        runtime_ddl = "\n".join(RESUME_OPTIMIZATION_TABLE_STATEMENTS[1:])
        expected = self._normalize_sql(runtime_ddl)

        for authority_name in ("bootstrap", "migration"):
            with self.subTest(authority=authority_name):
                actual = self._table_and_index_ddl(authorities[authority_name])
                self.assertEqual(self._normalize_sql(actual), expected)

    async def test_runtime_helper_executes_each_statement_in_order(self) -> None:
        from app.runtime_schema.resume_optimization_tables import (
            RESUME_OPTIMIZATION_TABLE_STATEMENTS,
            execute_resume_optimization_table_statements,
        )

        execute = AsyncMock()

        await execute_resume_optimization_table_statements(
            execute=execute,
            text=lambda statement: statement,
        )

        self.assertEqual(
            [call.args[0] for call in execute.await_args_list],
            list(RESUME_OPTIMIZATION_TABLE_STATEMENTS),
        )

    def test_sqlmodel_matches_columns_types_constraints_and_indexes(self) -> None:
        from app.domain.resume_optimization.models import ResumeOptimizationRun

        table = ResumeOptimizationRun.__table__
        self.assertEqual(tuple(table.columns.keys()), EXPECTED_COLUMNS)

        self.assertIsInstance(table.columns.id.type, PG_UUID)
        self.assertIsInstance(table.columns.resume_id.type, PG_UUID)
        for column_name in (
            "user_id",
            "status",
            "optimizer_version",
            "policy_version",
            "prompt_version",
            "source_evaluation_signature",
            "source_jd_signature",
            "source_snapshot_hash",
            "idempotency_key_hash",
            "request_hash",
            "applied_content_signature",
        ):
            with self.subTest(text_column=column_name):
                self.assertIsInstance(table.columns[column_name].type, Text)

        for column_name in JSON_COLUMNS:
            with self.subTest(json_column=column_name):
                self.assertIsInstance(table.columns[column_name].type, JSONB)
                self.assertFalse(table.columns[column_name].nullable)

        self.assertIsInstance(table.columns.accepted_change_ids.type, ARRAY)
        self.assertIsInstance(table.columns.accepted_change_ids.type.item_type, Text)
        for column_name in (
            "source_resume_updated_at",
            "created_at",
            "updated_at",
            "applied_at",
            "completed_at",
        ):
            with self.subTest(timestamp_column=column_name):
                self.assertIsInstance(table.columns[column_name].type, DateTime)
                self.assertTrue(table.columns[column_name].type.timezone)

        foreign_keys = {
            column.name: next(iter(column.foreign_keys))
            for column in table.columns
            if column.foreign_keys
        }
        self.assertEqual(foreign_keys["user_id"].target_fullname, "users.id")
        self.assertEqual(foreign_keys["resume_id"].target_fullname, "resumes.id")
        self.assertEqual(foreign_keys["user_id"].ondelete, "CASCADE")
        self.assertEqual(foreign_keys["resume_id"].ondelete, "CASCADE")

        constraint_names = {constraint.name for constraint in table.constraints}
        self.assertIn("ck_resume_optimization_runs_status", constraint_names)
        for column_name in JSON_COLUMNS:
            self.assertIn(
                f"ck_resume_optimization_runs_{column_name}_object",
                constraint_names,
            )
            self.assertIn(
                f"ck_resume_optimization_runs_{column_name}_size",
                constraint_names,
            )

        indexes = {index.name: index for index in table.indexes}
        self.assertEqual(
            set(indexes),
            {
                "idx_resume_optimization_runs_user_id",
                "idx_resume_optimization_runs_resume_created",
                "idx_resume_optimization_runs_status",
                "uniq_resume_optimization_runs_user_idempotency",
            },
        )
        self.assertEqual(
            [str(expression) for expression in indexes[
                "idx_resume_optimization_runs_resume_created"
            ].expressions],
            ["resume_optimization_runs.resume_id", "created_at DESC"],
        )
        idempotency_index = indexes[
            "uniq_resume_optimization_runs_user_idempotency"
        ]
        self.assertTrue(idempotency_index.unique)
        self.assertEqual(
            str(idempotency_index.dialect_options["postgresql"]["where"]),
            "idempotency_key_hash IS NOT NULL",
        )

    def test_init_db_explicitly_registers_the_domain_model(self) -> None:
        database_source = (
            Path(__file__).resolve().parent / "app" / "database.py"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "from .domain.resume_optimization import "
            "models as _resume_optimization_models  # noqa: F401",
            database_source,
        )

        env = os.environ.copy()
        env["DATABASE_URL"] = (
            "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
        )
        script = """
import asyncio
from app import database

assert not database.SQLModel.metadata.tables

class Connection:
    async def run_sync(self, callback):
        assert 'resume_optimization_runs' in database.SQLModel.metadata.tables

class Transaction:
    async def __aenter__(self):
        return Connection()

    async def __aexit__(self, exc_type, exc, traceback):
        return None

class Engine:
    def begin(self):
        return Transaction()

database.engine = Engine()
asyncio.run(database.init_db())
print('resume optimization model registration ok')
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
        self.assertIn("resume optimization model registration ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
