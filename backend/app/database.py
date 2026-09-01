from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from .config import load_settings
from .runtime_schema.billing_tables import (
    execute_ai_token_billing_statements,
    execute_redemption_code_statements,
)
from .runtime_schema.agent_api_tables import execute_agent_api_table_statements

settings = load_settings()
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    # 禁用 prepared statement cache 以兼容 PgBouncer
    connect_args={"statement_cache_size": 0},
)
AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionFactory() as session:
        yield session


async def init_db() -> None:
    # SQLModel only knows tables after the model module has registered them.
    from . import models as _models  # noqa: F401

    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)


async def verify_db_connection(*, log_result: bool = True) -> None:
    """验证数据库连接是否正常"""
    try:
        async with AsyncSessionFactory() as session:
            await session.execute(text("SELECT 1"))
            if log_result:
                print("Database connection verified successfully.")
    except Exception as e:
        if log_result:
            print(f"Database connection failed: {e}")
        raise e


async def ensure_experience_version_tags_column() -> None:
    """确保 experience_versions.tags 列存在（启动时的轻量同步）。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'experience_versions'
                  AND column_name = 'tags'
                """
            )
        )
        if result.first():
            return

        await connection.execute(
            text(
                """
                ALTER TABLE experience_versions
                ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'
                """
            )
        )


async def ensure_experience_drafts_table() -> None:
    """确保经历库实时草稿表存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS experience_drafts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    category experience_category NOT NULL,
                    client_draft_key TEXT NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'simple',
                    simple_text TEXT NOT NULL DEFAULT '',
                    card_data JSONB NOT NULL DEFAULT '{}'::jsonb,
                    target_master_id UUID REFERENCES master_experiences(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uq_experience_drafts_user_category_key UNIQUE (user_id, category, client_draft_key)
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_experience_drafts_user_category
                ON experience_drafts(user_id, category)
                """
            )
        )


async def ensure_export_render_snapshots_table() -> None:
    """确保 export_render_snapshots 表存在，兼容老环境直接升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS export_render_snapshots (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    consumed_at TIMESTAMPTZ,
                    render_claim_id UUID,
                    render_claim_expires_at TIMESTAMPTZ,
                    rendered_pdf BYTEA,
                    rendered_pdf_expires_at TIMESTAMPTZ
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE export_render_snapshots
                    ADD COLUMN IF NOT EXISTS render_claim_id UUID,
                    ADD COLUMN IF NOT EXISTS render_claim_expires_at TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS rendered_pdf BYTEA,
                    ADD COLUMN IF NOT EXISTS rendered_pdf_expires_at TIMESTAMPTZ
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_user_id
                ON export_render_snapshots(user_id)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_expires_at
                ON export_render_snapshots(expires_at)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_render_claim_expires_at
                ON export_render_snapshots(render_claim_expires_at)
                WHERE render_claim_id IS NOT NULL
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_rendered_pdf_expires_at
                ON export_render_snapshots(rendered_pdf_expires_at)
                WHERE rendered_pdf IS NOT NULL
                """
            )
        )


async def ensure_ai_assistant_tables() -> None:
    """确保 AI 助理会话与消息表存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_assistant_sessions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    entry_source TEXT NOT NULL DEFAULT 'direct',
                    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    latest_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_assistant_messages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_assistant_image_blobs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
                    mime_type TEXT NOT NULL DEFAULT '',
                    payload_base64 TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                DO $assistant_storage_constraints$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_sessions_title_length'
                          AND conrelid = 'ai_assistant_sessions'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_sessions
                            ADD CONSTRAINT ck_ai_assistant_sessions_title_length
                            CHECK (char_length(title) <= 200) NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_sessions_context_object'
                          AND conrelid = 'ai_assistant_sessions'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_sessions
                            ADD CONSTRAINT ck_ai_assistant_sessions_context_object
                            CHECK (jsonb_typeof(context_json) = 'object') NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_sessions_context_size'
                          AND conrelid = 'ai_assistant_sessions'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_sessions
                            ADD CONSTRAINT ck_ai_assistant_sessions_context_size
                            CHECK (octet_length(context_json::text) <= 262144) NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_messages_content_object'
                          AND conrelid = 'ai_assistant_messages'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_messages
                            ADD CONSTRAINT ck_ai_assistant_messages_content_object
                            CHECK (jsonb_typeof(content_json) = 'object') NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_messages_content_size'
                          AND conrelid = 'ai_assistant_messages'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_messages
                            ADD CONSTRAINT ck_ai_assistant_messages_content_size
                            CHECK (octet_length(content_json::text) <= 8388608) NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_image_blobs_mime_length'
                          AND conrelid = 'ai_assistant_image_blobs'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_image_blobs
                            ADD CONSTRAINT ck_ai_assistant_image_blobs_mime_length
                            CHECK (char_length(mime_type) <= 255) NOT VALID;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_ai_assistant_image_blobs_payload_size'
                          AND conrelid = 'ai_assistant_image_blobs'::regclass
                    ) THEN
                        ALTER TABLE ai_assistant_image_blobs
                            ADD CONSTRAINT ck_ai_assistant_image_blobs_payload_size
                            CHECK (octet_length(payload_base64) <= 6990508) NOT VALID;
                    END IF;
                END
                $assistant_storage_constraints$
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_assistant_sessions_user_id
                ON ai_assistant_sessions(user_id)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_assistant_sessions_updated_at
                ON ai_assistant_sessions(updated_at DESC)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_session_id
                ON ai_assistant_messages(session_id, created_at)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_assistant_image_blobs_session_id
                ON ai_assistant_image_blobs(session_id, created_at)
                """
            )
        )


async def ensure_agent_api_keys_table() -> None:
    """确保 Agent API Key 与插件配置表存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await execute_agent_api_table_statements(
            execute=connection.execute,
            text=text,
        )


async def ensure_ai_token_billing_tables() -> None:
    """确保 AI token 钱包、用量与占位购买表存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await execute_ai_token_billing_statements(
            execute=connection.execute,
            text=text,
        )


async def ensure_redemption_code_tables() -> None:
    """确保卡密套餐、批次与卡密库表存在，兼容生产环境直接升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await execute_redemption_code_statements(
            execute=connection.execute,
            text=text,
        )


async def ensure_feedback_images_column() -> None:
    """确保 feedback.image_base64_list 列存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'feedback'
                  AND column_name = 'image_base64_list'
                """
            )
        )
        if result.first():
            return

        await connection.execute(
            text(
                """
                ALTER TABLE feedback
                ADD COLUMN IF NOT EXISTS image_base64_list TEXT[] NOT NULL DEFAULT '{}'
                """
            )
        )


async def ensure_feedback_contact_type_column() -> None:
    """确保 feedback.contact_type 列存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        result = await connection.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'feedback'
                  AND column_name = 'contact_type'
                """
            )
        )
        if result.first():
            return

        await connection.execute(
            text(
                """
                ALTER TABLE feedback
                ADD COLUMN IF NOT EXISTS contact_type TEXT
                """
            )
        )


async def ensure_runtime_schema() -> None:
    """补齐应用运行所需的数据库结构，供所有启动入口共用。"""
    await ensure_experience_version_tags_column()
    await ensure_experience_drafts_table()
    await ensure_export_render_snapshots_table()
    await ensure_ai_assistant_tables()
    await ensure_agent_api_keys_table()
    await ensure_ai_token_billing_tables()
    await ensure_redemption_code_tables()
    await ensure_feedback_contact_type_column()
    await ensure_feedback_images_column()


async def ensure_dev_schema() -> None:
    """开发环境下初始化模型表，并补齐应用运行所需结构。"""
    await init_db()
    await ensure_runtime_schema()
