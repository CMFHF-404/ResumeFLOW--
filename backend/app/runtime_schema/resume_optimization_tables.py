from collections.abc import Awaitable, Callable
from typing import Any


ExecuteStatement = Callable[[Any], Awaitable[Any]]
TextFactory = Callable[[str], Any]


RESUME_OPTIMIZATION_TABLE_STATEMENTS = (
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    """
    CREATE TABLE IF NOT EXISTS resume_optimization_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,

        status TEXT NOT NULL,
        optimizer_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        prompt_version TEXT NOT NULL,

        source_resume_updated_at TIMESTAMPTZ NOT NULL,
        source_evaluation_signature TEXT NOT NULL,
        source_jd_signature TEXT NOT NULL DEFAULT '',
        source_snapshot_hash TEXT NOT NULL,

        idempotency_key_hash TEXT,
        request_hash TEXT NOT NULL,

        before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        post_evaluation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_json JSONB NOT NULL DEFAULT '{}'::jsonb,

        accepted_change_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
        applied_content_signature TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,

        CONSTRAINT ck_resume_optimization_runs_status CHECK (
            status IN (
                'planning',
                'awaiting_answers',
                'preview_ready',
                'applying',
                'applied',
                'rescoring',
                'completed',
                'failed',
                'stale',
                'cancelled',
                'reverted'
            )
        ),
        CONSTRAINT ck_resume_optimization_runs_before_snapshot_object
            CHECK (jsonb_typeof(before_snapshot) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_before_snapshot_size
            CHECK (octet_length(before_snapshot::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_plan_json_object
            CHECK (jsonb_typeof(plan_json) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_plan_json_size
            CHECK (octet_length(plan_json::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_answers_json_object
            CHECK (jsonb_typeof(answers_json) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_answers_json_size
            CHECK (octet_length(answers_json::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_result_json_object
            CHECK (jsonb_typeof(result_json) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_result_json_size
            CHECK (octet_length(result_json::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_after_snapshot_object
            CHECK (jsonb_typeof(after_snapshot) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_after_snapshot_size
            CHECK (octet_length(after_snapshot::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_post_evaluation_json_object
            CHECK (jsonb_typeof(post_evaluation_json) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_post_evaluation_json_size
            CHECK (octet_length(post_evaluation_json::text) <= 4194304),
        CONSTRAINT ck_resume_optimization_runs_error_json_object
            CHECK (jsonb_typeof(error_json) = 'object'),
        CONSTRAINT ck_resume_optimization_runs_error_json_size
            CHECK (octet_length(error_json::text) <= 4194304)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_resume_optimization_runs_user_id
    ON resume_optimization_runs(user_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_resume_optimization_runs_resume_created
    ON resume_optimization_runs(resume_id, created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_resume_optimization_runs_status
    ON resume_optimization_runs(status)
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_resume_optimization_runs_user_idempotency
    ON resume_optimization_runs(user_id, idempotency_key_hash)
    WHERE idempotency_key_hash IS NOT NULL
    """,
)


async def execute_resume_optimization_table_statements(
    *,
    execute: ExecuteStatement,
    text: TextFactory,
) -> None:
    for statement in RESUME_OPTIMIZATION_TABLE_STATEMENTS:
        await execute(text(statement))
