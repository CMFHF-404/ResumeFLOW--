"""Opt-in PostgreSQL integration coverage for payment-order schema upgrades.

Run with both ``RUN_PAYMENT_MIGRATION_POSTGRES_TESTS=1`` and an explicitly
provided ``PAYMENT_MIGRATION_TEST_DATABASE_URL``.  The test creates uniquely
named temporary schemas and never falls back to the application's normal
``DATABASE_URL``.
"""

from __future__ import annotations

import asyncio
import os
import unittest
import uuid
from pathlib import Path

import asyncpg
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.runtime_schema.billing_tables import AI_TOKEN_BILLING_STATEMENTS


RUN_ENV = "RUN_PAYMENT_MIGRATION_POSTGRES_TESTS"
DATABASE_URL_ENV = "PAYMENT_MIGRATION_TEST_DATABASE_URL"

LEGACY_PAYMENT_ORDERS_SQL = """
CREATE TABLE payment_orders (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'yifut',
    merchant_order_no TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount_fen BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    benefit_type TEXT NOT NULL,
    token_amount BIGINT NOT NULL DEFAULT 0,
    unlimited_duration_days INTEGER,
    entitlement_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_trade_no TEXT UNIQUE,
    failure_reason TEXT,
    paid_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_orders_user_idempotency UNIQUE (user_id, idempotency_key)
)
"""


def _normalize_async_database_url(value: str) -> str:
    if value.startswith("postgresql+asyncpg://"):
        return value
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+asyncpg://", 1)
    raise AssertionError("PAYMENT_MIGRATION_TEST_DATABASE_URL must use PostgreSQL")


def _normalize_asyncpg_database_url(value: str) -> str:
    return _normalize_async_database_url(value).replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )


def _split_migration_statements(source: str) -> tuple[str, ...]:
    statements: list[str] = []
    current: list[str] = []
    index = 0
    quote: str | None = None
    dollar_quote: str | None = None
    line_comment = False
    block_comment = False
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            current.append(char)
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            current.append(char)
            if char == "*" and following == "/":
                current.append(following)
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if dollar_quote is not None:
            if source.startswith(dollar_quote, index):
                current.append(dollar_quote)
                index += len(dollar_quote)
                dollar_quote = None
            else:
                current.append(char)
                index += 1
            continue
        if quote is not None:
            current.append(char)
            if char == quote:
                if following == quote:
                    current.append(following)
                    index += 2
                    continue
                quote = None
            index += 1
            continue
        if char == "-" and following == "-":
            current.extend((char, following))
            line_comment = True
            index += 2
            continue
        if char == "/" and following == "*":
            current.extend((char, following))
            block_comment = True
            index += 2
            continue
        if char in {"'", '"'}:
            current.append(char)
            quote = char
            index += 1
            continue
        if char == "$":
            tag_end = source.find("$", index + 1)
            if tag_end != -1:
                tag = source[index : tag_end + 1]
                if tag == "$$" or tag[1:-1].replace("_", "a").isalnum():
                    current.append(tag)
                    dollar_quote = tag
                    index = tag_end + 1
                    continue
        if char == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    statement = "".join(current).strip()
    if statement:
        statements.append(statement)
    return tuple(statements)


class PaymentSchemaSqlStaticTests(unittest.TestCase):
    def test_migration_splitter_preserves_plpgsql_function_bodies(self) -> None:
        statements = _split_migration_statements(
            "CREATE FUNCTION sample() RETURNS trigger AS $$ BEGIN NEW.value := 1; RETURN NEW; END; $$ LANGUAGE plpgsql; SELECT 1;"
        )

        self.assertEqual(len(statements), 2)
        self.assertIn("NEW.value := 1; RETURN NEW;", statements[0])
        self.assertEqual(statements[1], "SELECT 1")

    def test_schema_sql_retrofits_legacy_payment_order_columns_before_alias_backfill(
        self,
    ) -> None:
        schema_source = (Path(__file__).resolve().parent / "schema.sql").read_text(
            encoding="utf-8"
        )
        cancellation_upgrade = """ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;"""
        state_version_upgrade = """ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1;"""
        alias_table = "CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases"
        claim_trigger = "CREATE TRIGGER trg_payment_order_claim_original_idempotency_key"
        alias_backfill = "SELECT user_id, idempotency_key, id, created_at"
        reconciliation_guard = "payment_order_reconciliation_required"
        provider_open_trigger = "trg_payment_order_enforce_provider_open_per_user"

        self.assertIn(cancellation_upgrade, schema_source)
        self.assertIn(state_version_upgrade, schema_source)
        self.assertLess(schema_source.index(cancellation_upgrade), schema_source.index(alias_table))
        self.assertLess(schema_source.index(state_version_upgrade), schema_source.index(alias_table))
        self.assertLess(schema_source.index(claim_trigger), schema_source.index(alias_backfill))
        self.assertLess(
            schema_source.index(reconciliation_guard),
            schema_source.index(provider_open_trigger),
        )


@unittest.skipUnless(
    os.getenv(RUN_ENV) == "1" and bool(os.getenv(DATABASE_URL_ENV, "").strip()),
    f"set {RUN_ENV}=1 with an isolated {DATABASE_URL_ENV} to run PostgreSQL migration coverage",
)
class PaymentPostgresMigrationTests(unittest.IsolatedAsyncioTestCase):
    engine: AsyncEngine

    async def asyncSetUp(self) -> None:
        database_url = os.getenv(DATABASE_URL_ENV, "").strip()
        self.database_url = database_url
        self.engine = create_async_engine(
            _normalize_async_database_url(database_url),
            pool_pre_ping=True,
            connect_args={"statement_cache_size": 0},
        )
        if self.engine.dialect.name != "postgresql":
            self.fail("payment migration integration coverage requires PostgreSQL")

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def _assert_upgrade_path(self, statements: tuple[str, ...]) -> None:
        schema_name = f"payment_migration_test_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        try:
            async with self.engine.begin() as connection:
                await connection.execute(text(f"CREATE SCHEMA {quoted_schema}"))
                await connection.execute(text(f"SET LOCAL search_path TO {quoted_schema}"))
                await connection.execute(text("CREATE TABLE users (id TEXT PRIMARY KEY)"))
                await connection.execute(text(LEGACY_PAYMENT_ORDERS_SQL))
                legacy_order_id = uuid.uuid4()
                await connection.execute(
                    text("INSERT INTO users (id) VALUES ('legacy-user')")
                )
                await connection.execute(
                    text(
                        """
                        INSERT INTO payment_orders (
                            id,
                            user_id,
                            merchant_order_no,
                            idempotency_key,
                            sku,
                            product_name,
                            amount_fen,
                            benefit_type,
                            token_amount,
                            entitlement_snapshot_json,
                            expires_at
                        ) VALUES (
                            :order_id,
                            'legacy-user',
                            'RF-LEGACY-ALIAS',
                            'legacy-key',
                            'tokens_100k',
                            '100K Token package',
                            198,
                            'tokens',
                            100000,
                            '{}'::jsonb,
                            now() + interval '30 minutes'
                        )
                        """
                    ),
                    {"order_id": legacy_order_id},
                )

                # Both production paths are deliberately idempotent.
                for _ in range(2):
                    for statement in statements:
                        await connection.execute(text(statement))

                column_type = (
                    await connection.execute(
                        text(
                            """
                            SELECT data_type
                            FROM information_schema.columns
                            WHERE table_schema = :schema_name
                              AND table_name = 'payment_orders'
                              AND column_name = 'cancelled_at'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).scalar_one_or_none()
                self.assertEqual(column_type, "timestamp with time zone")

                state_version_metadata = (
                    await connection.execute(
                        text(
                            """
                            SELECT data_type, is_nullable, column_default
                            FROM information_schema.columns
                            WHERE table_schema = :schema_name
                              AND table_name = 'payment_orders'
                              AND column_name = 'state_version'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).one_or_none()
                self.assertIsNotNone(state_version_metadata)
                self.assertEqual(state_version_metadata[0], "bigint")
                self.assertEqual(state_version_metadata[1], "NO")
                self.assertEqual(state_version_metadata[2], "1")

                predicate = (
                    await connection.execute(
                        text(
                            """
                            SELECT pg_get_expr(index.indpred, index.indrelid)
                            FROM pg_class AS table_rel
                            JOIN pg_namespace AS namespace
                              ON namespace.oid = table_rel.relnamespace
                            JOIN pg_index AS index
                              ON index.indrelid = table_rel.oid
                            JOIN pg_class AS index_rel
                              ON index_rel.oid = index.indexrelid
                            WHERE namespace.nspname = :schema_name
                              AND table_rel.relname = 'payment_orders'
                              AND index_rel.relname = 'idx_payment_orders_pending_expires'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).scalar_one_or_none()
                self.assertIsNotNone(predicate)
                self.assertIn("status", predicate or "")
                self.assertIn("pending", predicate or "")

                indexed_columns = (
                    await connection.execute(
                        text(
                            """
                            SELECT array_agg(attribute.attname ORDER BY key.ordinality)
                            FROM pg_class AS table_rel
                            JOIN pg_namespace AS namespace
                              ON namespace.oid = table_rel.relnamespace
                            JOIN pg_index AS index
                              ON index.indrelid = table_rel.oid
                            JOIN pg_class AS index_rel
                              ON index_rel.oid = index.indexrelid
                            JOIN unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality)
                              ON TRUE
                            JOIN pg_attribute AS attribute
                              ON attribute.attrelid = table_rel.oid
                             AND attribute.attnum = key.attnum
                            WHERE namespace.nspname = :schema_name
                              AND table_rel.relname = 'payment_orders'
                              AND index_rel.relname = 'idx_payment_orders_pending_expires'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).scalar_one_or_none()
                self.assertEqual(indexed_columns, ["expires_at"])

                alias_order_id = (
                    await connection.execute(
                        text(
                            """
                            SELECT payment_order_id
                            FROM payment_order_idempotency_aliases
                            WHERE user_id = 'legacy-user'
                              AND idempotency_key = 'legacy-key'
                            """
                        )
                    )
                ).scalar_one_or_none()
                self.assertEqual(alias_order_id, legacy_order_id)

                alias_primary_key = (
                    await connection.execute(
                        text(
                            """
                            SELECT array_agg(attribute.attname ORDER BY key.ordinality)
                            FROM pg_constraint AS constraint_row
                            JOIN pg_class AS table_rel
                              ON table_rel.oid = constraint_row.conrelid
                            JOIN pg_namespace AS namespace
                              ON namespace.oid = table_rel.relnamespace
                            JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
                              ON TRUE
                            JOIN pg_attribute AS attribute
                              ON attribute.attrelid = table_rel.oid
                             AND attribute.attnum = key.attnum
                            WHERE namespace.nspname = :schema_name
                              AND table_rel.relname = 'payment_order_idempotency_aliases'
                              AND constraint_row.contype = 'p'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).scalar_one_or_none()
                self.assertEqual(alias_primary_key, ["user_id", "idempotency_key"])

                alias_foreign_keys = set(
                    (
                        await connection.execute(
                            text(
                                """
                                SELECT pg_get_constraintdef(constraint_row.oid)
                                FROM pg_constraint AS constraint_row
                                JOIN pg_class AS table_rel
                                  ON table_rel.oid = constraint_row.conrelid
                                JOIN pg_namespace AS namespace
                                  ON namespace.oid = table_rel.relnamespace
                                WHERE namespace.nspname = :schema_name
                                  AND table_rel.relname = 'payment_order_idempotency_aliases'
                                  AND constraint_row.contype = 'f'
                                """
                            ),
                            {"schema_name": schema_name},
                        )
                    ).scalars()
                )
                self.assertTrue(
                    any("FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE" in item for item in alias_foreign_keys)
                )
                self.assertTrue(
                    any("FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id) ON DELETE CASCADE" in item for item in alias_foreign_keys)
                )

                alias_index_columns = (
                    await connection.execute(
                        text(
                            """
                            SELECT array_agg(attribute.attname ORDER BY key.ordinality)
                            FROM pg_class AS table_rel
                            JOIN pg_namespace AS namespace
                              ON namespace.oid = table_rel.relnamespace
                            JOIN pg_index AS index
                              ON index.indrelid = table_rel.oid
                            JOIN pg_class AS index_rel
                              ON index_rel.oid = index.indexrelid
                            JOIN unnest(index.indkey) WITH ORDINALITY AS key(attnum, ordinality)
                              ON TRUE
                            JOIN pg_attribute AS attribute
                              ON attribute.attrelid = table_rel.oid
                             AND attribute.attnum = key.attnum
                            WHERE namespace.nspname = :schema_name
                              AND table_rel.relname = 'payment_order_idempotency_aliases'
                              AND index_rel.relname = 'idx_payment_order_idempotency_aliases_order'
                            """
                        ),
                        {"schema_name": schema_name},
                    )
                ).scalar_one_or_none()
                self.assertEqual(alias_index_columns, ["payment_order_id"])

                trigger_names = set(
                    (
                        await connection.execute(
                            text(
                                """
                                SELECT trigger_row.tgname
                                FROM pg_trigger AS trigger_row
                                JOIN pg_class AS table_rel
                                  ON table_rel.oid = trigger_row.tgrelid
                                JOIN pg_namespace AS namespace
                                  ON namespace.oid = table_rel.relnamespace
                                WHERE namespace.nspname = :schema_name
                                  AND table_rel.relname = 'payment_orders'
                                  AND NOT trigger_row.tgisinternal
                                """
                            ),
                            {"schema_name": schema_name},
                        )
                    ).scalars()
                )
                self.assertIn(
                    "trg_payment_order_claim_original_idempotency_key",
                    trigger_names,
                )
                self.assertIn(
                    "trg_payment_order_enforce_provider_open_per_user",
                    trigger_names,
                )
                self.assertIn("trg_payment_order_bump_state_version", trigger_names)

                self.assertEqual(
                    (
                        await connection.execute(
                            text(
                                """
                                SELECT payment_order_id
                                FROM payment_order_provider_open_claims
                                WHERE user_id = 'legacy-user'
                                """
                            )
                        )
                    ).scalar_one_or_none(),
                    legacy_order_id,
                )

                # An old writer does not know about state_version. The trigger
                # must still advance it exactly once for a payment-state change.
                await connection.execute(
                    text(
                        """
                        UPDATE payment_orders
                        SET status = 'expired', updated_at = now()
                        WHERE id = :order_id
                        """
                    ),
                    {"order_id": legacy_order_id},
                )
                self.assertEqual(
                    (
                        await connection.execute(
                            text("SELECT state_version FROM payment_orders WHERE id = :order_id"),
                            {"order_id": legacy_order_id},
                        )
                    ).scalar_one(),
                    2,
                )

                # A new writer increments explicitly; the trigger must not add
                # a second revision for the same transition.
                await connection.execute(
                    text(
                        """
                        UPDATE payment_orders
                        SET status = 'cancelled',
                            cancelled_at = now(),
                            state_version = state_version + 1,
                            updated_at = now()
                        WHERE id = :order_id
                        """
                    ),
                    {"order_id": legacy_order_id},
                )
                self.assertEqual(
                    (
                        await connection.execute(
                            text("SELECT state_version FROM payment_orders WHERE id = :order_id"),
                            {"order_id": legacy_order_id},
                        )
                    ).scalar_one(),
                    3,
                )

                # Fulfillment is the boundary that permits a new purchase. It
                # also keeps the alias-collision assertion below focused on the
                # authoritative alias trigger rather than the per-user index.
                await connection.execute(
                    text(
                        """
                        UPDATE payment_orders
                        SET status = 'fulfilled',
                            fulfilled_at = now(),
                            state_version = state_version + 1,
                            updated_at = now()
                        WHERE id = :order_id
                        """
                    ),
                    {"order_id": legacy_order_id},
                )
                self.assertEqual(
                    (
                        await connection.execute(
                            text("SELECT state_version FROM payment_orders WHERE id = :order_id"),
                            {"order_id": legacy_order_id},
                        )
                    ).scalar_one(),
                    4,
                )

                # Pre-claiming a key through the alias table makes it
                # impossible for an old writer to insert a second provider
                # order using that key.
                await connection.execute(
                    text(
                        """
                        INSERT INTO payment_order_idempotency_aliases (
                            user_id, idempotency_key, payment_order_id
                        ) VALUES ('legacy-user', 'mixed-version-key', :order_id)
                        """
                    ),
                    {"order_id": legacy_order_id},
                )
                duplicate_order_id = uuid.uuid4()
                with self.assertRaises(IntegrityError):
                    async with connection.begin_nested():
                        await connection.execute(
                            text(
                                """
                                INSERT INTO payment_orders (
                                    id,
                                    user_id,
                                    merchant_order_no,
                                    idempotency_key,
                                    sku,
                                    product_name,
                                    amount_fen,
                                    benefit_type,
                                    token_amount,
                                    entitlement_snapshot_json,
                                    expires_at
                                ) VALUES (
                                    :order_id,
                                    'legacy-user',
                                    'RF-MIXED-VERSION-DUPLICATE',
                                    'mixed-version-key',
                                    'tokens_100k',
                                    '100K Token package',
                                    198,
                                    'tokens',
                                    100000,
                                    '{}'::jsonb,
                                    now() + interval '30 minutes'
                                )
                                """
                            ),
                            {"order_id": duplicate_order_id},
                        )
                self.assertEqual(
                    (
                        await connection.execute(
                            text(
                                """
                                SELECT count(*)
                                FROM payment_orders
                                WHERE merchant_order_no = 'RF-MIXED-VERSION-DUPLICATE'
                                """
                            )
                        )
                    ).scalar_one(),
                    0,
                )
        finally:
            async with self.engine.begin() as connection:
                await connection.execute(text(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE"))

    async def test_migration_and_runtime_paths_upgrade_a_legacy_table_twice(self) -> None:
        cancellation_migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "011_add_payment_order_cancellation.sql"
        ).read_text(encoding="utf-8")
        alias_migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "012_add_payment_order_idempotency_aliases.sql"
        ).read_text(encoding="utf-8")
        state_version_migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "013_add_payment_order_state_version.sql"
        ).read_text(encoding="utf-8")
        writer_guard_migration_source = (
            Path(__file__).resolve().parent
            / "migrations"
            / "014_add_payment_order_writer_guards.sql"
        ).read_text(encoding="utf-8")
        migration_statements = (
            *_split_migration_statements(cancellation_migration_source),
            *_split_migration_statements(alias_migration_source),
            *_split_migration_statements(state_version_migration_source),
            *_split_migration_statements(writer_guard_migration_source),
        )
        runtime_statements = tuple(
            statement
            for statement in AI_TOKEN_BILLING_STATEMENTS
            if "payment_order" in statement
        )

        self.assertEqual(len(migration_statements), 18)
        self.assertGreaterEqual(len(runtime_statements), 19)
        for path_name, statements in (
            ("migration", migration_statements),
            ("runtime", runtime_statements),
        ):
            with self.subTest(path=path_name):
                await self._assert_upgrade_path(statements)

    async def test_schema_sql_upgrades_a_legacy_payment_orders_table_twice(self) -> None:
        schema_source = (Path(__file__).resolve().parent / "schema.sql").read_text(
            encoding="utf-8"
        )
        schema_name = f"payment_schema_sql_test_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        connection = await asyncpg.connect(
            _normalize_asyncpg_database_url(self.database_url)
        )
        try:
            await connection.execute(f"CREATE SCHEMA {quoted_schema}")
            await connection.execute(f"SET search_path TO {quoted_schema}, public")
            await connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            await connection.execute(LEGACY_PAYMENT_ORDERS_SQL)
            legacy_order_id = uuid.uuid4()
            await connection.execute("INSERT INTO users (id) VALUES ('legacy-user')")
            await connection.execute(
                """
                INSERT INTO payment_orders (
                    id,
                    user_id,
                    merchant_order_no,
                    idempotency_key,
                    sku,
                    product_name,
                    amount_fen,
                    benefit_type,
                    token_amount,
                    entitlement_snapshot_json,
                    expires_at
                ) VALUES (
                    $1,
                    'legacy-user',
                    'RF-LEGACY-SCHEMA',
                    'legacy-schema-key',
                    'tokens_100k',
                    '100K Token package',
                    198,
                    'tokens',
                    100000,
                    '{}'::jsonb,
                    now() + interval '30 minutes'
                )
                """,
                legacy_order_id,
            )

            # Match the production bootstrap path and prove it remains idempotent.
            await connection.execute(schema_source)
            await connection.execute(schema_source)

            column_metadata = {
                record["column_name"]: record
                for record in await connection.fetch(
                    """
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_schema = $1
                      AND table_name = 'payment_orders'
                      AND column_name IN ('cancelled_at', 'state_version')
                    """,
                    schema_name,
                )
            }
            self.assertEqual(
                column_metadata["cancelled_at"]["data_type"],
                "timestamp with time zone",
            )
            self.assertEqual(column_metadata["state_version"]["data_type"], "bigint")
            self.assertEqual(column_metadata["state_version"]["is_nullable"], "NO")
            self.assertEqual(column_metadata["state_version"]["column_default"], "1")
            self.assertEqual(
                await connection.fetchval(
                    "SELECT state_version FROM payment_orders WHERE id = $1",
                    legacy_order_id,
                ),
                1,
            )

            await connection.execute("INSERT INTO users (id) VALUES ('schema-new-user')")
            new_order_id = uuid.uuid4()
            await connection.execute(
                """
                INSERT INTO payment_orders (
                    id,
                    user_id,
                    merchant_order_no,
                    idempotency_key,
                    sku,
                    product_name,
                    amount_fen,
                    benefit_type,
                    token_amount,
                    entitlement_snapshot_json,
                    expires_at
                ) VALUES (
                    $1,
                    'schema-new-user',
                    'RF-NEW-SCHEMA',
                    'new-schema-key',
                    'tokens_100k',
                    '100K Token package',
                    198,
                    'tokens',
                    100000,
                    '{}'::jsonb,
                    now() + interval '30 minutes'
                )
                """,
                new_order_id,
            )
            self.assertEqual(
                await connection.fetchval(
                    "SELECT state_version FROM payment_orders WHERE id = $1",
                    new_order_id,
                ),
                1,
            )
            self.assertEqual(
                await connection.fetchval(
                    """
                    SELECT payment_order_id
                    FROM payment_order_idempotency_aliases
                    WHERE user_id = 'schema-new-user'
                      AND idempotency_key = 'new-schema-key'
                    """
                ),
                new_order_id,
            )

            await connection.execute(
                """
                UPDATE payment_orders
                SET status = 'expired', updated_at = now()
                WHERE id = $1
                """,
                new_order_id,
            )
            self.assertEqual(
                await connection.fetchval(
                    "SELECT state_version FROM payment_orders WHERE id = $1",
                    new_order_id,
                ),
                2,
            )
            await connection.execute(
                """
                UPDATE payment_orders
                SET status = 'cancelled',
                    cancelled_at = now(),
                    state_version = state_version + 1,
                    updated_at = now()
                WHERE id = $1
                """,
                new_order_id,
            )
            self.assertEqual(
                await connection.fetchval(
                    "SELECT state_version FROM payment_orders WHERE id = $1",
                    new_order_id,
                ),
                3,
            )

            await connection.execute(
                """
                UPDATE payment_orders
                SET status = 'fulfilled',
                    fulfilled_at = now(),
                    state_version = state_version + 1,
                    updated_at = now()
                WHERE id = $1
                """,
                legacy_order_id,
            )

            await connection.execute(
                """
                INSERT INTO payment_order_idempotency_aliases (
                    user_id, idempotency_key, payment_order_id
                ) VALUES ('legacy-user', 'schema-mixed-key', $1)
                """,
                legacy_order_id,
            )
            with self.assertRaises(asyncpg.UniqueViolationError):
                await connection.execute(
                    """
                    INSERT INTO payment_orders (
                        id,
                        user_id,
                        merchant_order_no,
                        idempotency_key,
                        sku,
                        product_name,
                        amount_fen,
                        benefit_type,
                        token_amount,
                        entitlement_snapshot_json,
                        expires_at
                    ) VALUES (
                        $1,
                        'legacy-user',
                        'RF-SCHEMA-MIXED-DUPLICATE',
                        'schema-mixed-key',
                        'tokens_100k',
                        '100K Token package',
                        198,
                        'tokens',
                        100000,
                        '{}'::jsonb,
                        now() + interval '30 minutes'
                    )
                    """,
                    uuid.uuid4(),
                )
            self.assertEqual(
                await connection.fetchval(
                    """
                    SELECT count(*) FROM payment_orders
                    WHERE merchant_order_no = 'RF-SCHEMA-MIXED-DUPLICATE'
                    """
                ),
                0,
            )
        finally:
            await connection.execute("RESET search_path")
            await connection.execute(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE")
            await connection.close()

    async def test_provider_open_claim_serializes_different_keys_and_releases_on_fulfillment(
        self,
    ) -> None:
        schema_name = f"payment_claim_concurrency_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        connection_a = await asyncpg.connect(
            _normalize_asyncpg_database_url(self.database_url)
        )
        connection_b = await asyncpg.connect(
            _normalize_asyncpg_database_url(self.database_url)
        )
        blocked_insert: asyncio.Task | None = None
        transition_insert: asyncio.Task | None = None
        transaction_a = None
        try:
            await connection_a.execute(f"CREATE SCHEMA {quoted_schema}")
            for connection in (connection_a, connection_b):
                await connection.execute(f"SET search_path TO {quoted_schema}, public")
            await connection_a.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            await connection_a.execute(LEGACY_PAYMENT_ORDERS_SQL)
            for migration_name in (
                "011_add_payment_order_cancellation.sql",
                "012_add_payment_order_idempotency_aliases.sql",
                "013_add_payment_order_state_version.sql",
                "014_add_payment_order_writer_guards.sql",
            ):
                source = (
                    Path(__file__).resolve().parent / "migrations" / migration_name
                ).read_text(encoding="utf-8")
                for statement in _split_migration_statements(source):
                    await connection_a.execute(statement)
            await connection_a.execute(
                "INSERT INTO users (id) VALUES ('concurrent-user')"
            )

            insert_sql = """
                INSERT INTO payment_orders (
                    id, user_id, merchant_order_no, idempotency_key, sku,
                    product_name, amount_fen, benefit_type, token_amount,
                    entitlement_snapshot_json, expires_at
                ) VALUES (
                    $1, 'concurrent-user', $2, $3, 'tokens_100k',
                    '100K Token package', 198, 'tokens', 100000,
                    '{}'::jsonb, now() + interval '30 minutes'
                )
            """
            first_id = uuid.uuid4()
            transaction_a = connection_a.transaction()
            await transaction_a.start()
            await connection_a.execute(
                insert_sql,
                first_id,
                "RF-CONCURRENT-FIRST",
                "different-key-one",
            )
            blocked_insert = asyncio.create_task(
                connection_b.execute(
                    insert_sql,
                    uuid.uuid4(),
                    "RF-CONCURRENT-SECOND",
                    "different-key-two",
                )
            )
            await asyncio.sleep(0.1)
            self.assertFalse(blocked_insert.done())
            await transaction_a.commit()
            transaction_a = None
            with self.assertRaises(asyncpg.UniqueViolationError):
                await blocked_insert
            blocked_insert = None

            transaction_a = connection_a.transaction()
            await transaction_a.start()
            await connection_a.execute(
                """
                UPDATE payment_orders
                SET status = 'fulfilled', fulfilled_at = now()
                WHERE id = $1
                """,
                first_id,
            )
            third_id = uuid.uuid4()
            transition_insert = asyncio.create_task(
                connection_b.execute(
                    insert_sql,
                    third_id,
                    "RF-CONCURRENT-AFTER-FULFILLED",
                    "different-key-three",
                )
            )
            await asyncio.sleep(0.1)
            self.assertFalse(transition_insert.done())
            await transaction_a.commit()
            transaction_a = None
            await transition_insert
            transition_insert = None
            self.assertEqual(
                await connection_b.fetchval(
                    """
                    SELECT payment_order_id
                    FROM payment_order_provider_open_claims
                    WHERE user_id = 'concurrent-user'
                    """
                ),
                third_id,
            )

            failed_id = uuid.uuid4()
            await connection_b.execute(
                """
                INSERT INTO payment_orders (
                    id, user_id, merchant_order_no, idempotency_key, sku,
                    product_name, amount_fen, benefit_type, token_amount,
                    entitlement_snapshot_json, status, expires_at
                ) VALUES (
                    $1, 'concurrent-user', 'RF-CONCURRENT-FAILED',
                    'different-key-failed', 'tokens_100k',
                    '100K Token package', 198, 'tokens', 100000,
                    '{}'::jsonb, 'failed', now() + interval '30 minutes'
                )
                """,
                failed_id,
            )
            with self.assertRaises(asyncpg.UniqueViolationError):
                await connection_b.execute(
                    """
                    UPDATE payment_orders
                    SET status = 'paid', paid_at = now()
                    WHERE id = $1
                    """,
                    failed_id,
                )
            self.assertEqual(
                await connection_b.fetchval(
                    "SELECT status FROM payment_orders WHERE id = $1",
                    failed_id,
                ),
                "failed",
            )
        finally:
            for task in (blocked_insert, transition_insert):
                if task is not None and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            if transaction_a is not None:
                await transaction_a.rollback()
            await connection_a.execute("RESET search_path")
            await connection_b.execute("RESET search_path")
            await connection_a.execute(
                f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE"
            )
            await connection_b.close()
            await connection_a.close()

    async def test_historical_duplicates_do_not_block_install_but_remain_fail_closed(
        self,
    ) -> None:
        schema_name = f"payment_claim_dirty_{uuid.uuid4().hex}"
        quoted_schema = f'"{schema_name}"'
        connection = await asyncpg.connect(
            _normalize_asyncpg_database_url(self.database_url)
        )
        try:
            await connection.execute(f"CREATE SCHEMA {quoted_schema}")
            await connection.execute(f"SET search_path TO {quoted_schema}, public")
            await connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY)")
            await connection.execute(LEGACY_PAYMENT_ORDERS_SQL)
            await connection.execute("INSERT INTO users (id) VALUES ('dirty-user')")
            for suffix in ("ONE", "TWO"):
                await connection.execute(
                    """
                    INSERT INTO payment_orders (
                        id, user_id, merchant_order_no, idempotency_key, sku,
                        product_name, amount_fen, benefit_type, token_amount,
                        entitlement_snapshot_json, status, expires_at
                    ) VALUES (
                        $1, 'dirty-user', $2, $3, 'tokens_100k',
                        '100K Token package', 198, 'tokens', 100000,
                        '{}'::jsonb, 'expired', now() - interval '30 minutes'
                    )
                    """,
                    uuid.uuid4(),
                    f"RF-DIRTY-{suffix}",
                    f"dirty-key-{suffix.lower()}",
                )
            statements: list[str] = []
            for migration_name in (
                "011_add_payment_order_cancellation.sql",
                "012_add_payment_order_idempotency_aliases.sql",
                "013_add_payment_order_state_version.sql",
                "014_add_payment_order_writer_guards.sql",
            ):
                source = (
                    Path(__file__).resolve().parent / "migrations" / migration_name
                ).read_text(encoding="utf-8")
                statements.extend(_split_migration_statements(source))
            for _ in range(2):
                for statement in statements:
                    await connection.execute(statement)

            self.assertIsNone(
                await connection.fetchval(
                    """
                    SELECT payment_order_id
                    FROM payment_order_provider_open_claims
                    WHERE user_id = 'dirty-user'
                    """
                )
            )
            await connection.execute(
                """
                UPDATE payment_orders
                SET status = 'cancelled', cancelled_at = now()
                WHERE merchant_order_no = 'RF-DIRTY-ONE'
                """
            )
            with self.assertRaises(asyncpg.UniqueViolationError) as raised:
                await connection.execute(
                    """
                    INSERT INTO payment_orders (
                        id, user_id, merchant_order_no, idempotency_key, sku,
                        product_name, amount_fen, benefit_type, token_amount,
                        entitlement_snapshot_json, expires_at
                    ) VALUES (
                        $1, 'dirty-user', 'RF-DIRTY-THREE', 'dirty-key-three',
                        'tokens_100k', '100K Token package', 198, 'tokens',
                        100000, '{}'::jsonb, now() + interval '30 minutes'
                    )
                    """,
                    uuid.uuid4(),
                )
            self.assertIn(
                "payment_order_reconciliation_required",
                str(raised.exception),
            )
        finally:
            await connection.execute("RESET search_path")
            await connection.execute(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE")
            await connection.close()


if __name__ == "__main__":
    unittest.main()
