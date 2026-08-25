from collections.abc import Awaitable, Callable
from typing import Any


ExecuteStatement = Callable[[Any], Awaitable[Any]]
TextFactory = Callable[[str], Any]


AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER_TABLE = "runtime_schema_migration_markers"
AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER = "agent_api_keys.key_plaintext_phase_b"
# Decimal encoding of the stable namespace token ``RFAGPHBL``. Runtime schema
# startup and the manual Phase-B migration must hold this transaction lock
# before they inspect or change the plaintext-column boundary.
AGENT_API_KEY_PLAINTEXT_PHASE_B_LOCK_KEY = 5928497734025232972


AGENT_API_TABLE_STATEMENTS = (
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    f"""
                DO $agent_api_key_plaintext_phase_b_runtime_guard$
                BEGIN
                    PERFORM pg_advisory_xact_lock({AGENT_API_KEY_PLAINTEXT_PHASE_B_LOCK_KEY});
                    CREATE TABLE IF NOT EXISTS {AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER_TABLE} (
                        marker TEXT PRIMARY KEY,
                        completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );
                    CREATE TABLE IF NOT EXISTS agent_api_keys (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        key_prefix TEXT NOT NULL,
                        key_hash TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        last_used_at TIMESTAMPTZ,
                        revoked_at TIMESTAMPTZ
                    );
                    IF NOT EXISTS (
                        SELECT 1
                        FROM {AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER_TABLE}
                        WHERE marker = '{AGENT_API_KEY_PLAINTEXT_PHASE_B_MARKER}'
                    ) THEN
                        ALTER TABLE agent_api_keys
                        ADD COLUMN IF NOT EXISTS key_plaintext TEXT;
                    END IF;
                END;
                $agent_api_key_plaintext_phase_b_runtime_guard$;
                """,
    # Phase A intentionally removes the rejected scrub trigger while retaining
    # the column and its values for rolling-deploy/rollback compatibility. Run
    # migrations/017_drop_agent_api_key_plaintext_phase_b.sql only after every
    # legacy plaintext writer has been drained.
    """
                DROP TRIGGER IF EXISTS trg_agent_api_keys_discard_plaintext
                ON agent_api_keys
                """,
    """
                DROP FUNCTION IF EXISTS discard_agent_api_key_plaintext()
                """,
    """
                WITH ranked_active_keys AS (
                    SELECT
                        id,
                        row_number() OVER (
                            PARTITION BY user_id
                            ORDER BY created_at DESC, id DESC
                        ) AS active_rank
                    FROM agent_api_keys
                    WHERE revoked_at IS NULL
                )
                UPDATE agent_api_keys AS key
                SET
                    revoked_at = now()
                FROM ranked_active_keys
                WHERE key.id = ranked_active_keys.id
                  AND ranked_active_keys.active_rank > 1
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_id
                ON agent_api_keys(user_id)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_agent_api_keys_key_prefix
                ON agent_api_keys(key_prefix)
                """,
    """
                CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_api_keys_active_user
                ON agent_api_keys(user_id)
                WHERE revoked_at IS NULL
                """,
    """
                CREATE TABLE IF NOT EXISTS agent_plugin_configs (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    selected_template_id TEXT NOT NULL DEFAULT 'modern-slate',
                    polish_before_output BOOLEAN NOT NULL DEFAULT true,
                    polish_level TEXT NOT NULL DEFAULT '标准',
                    force_one_page BOOLEAN NOT NULL DEFAULT true,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
)


async def execute_agent_api_table_statements(
    *,
    execute: ExecuteStatement,
    text: TextFactory,
) -> None:
    for statement in AGENT_API_TABLE_STATEMENTS:
        await execute(text(statement))
