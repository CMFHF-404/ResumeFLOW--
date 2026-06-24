from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from .config import load_settings

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
    async with engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)


async def verify_db_connection() -> None:
    """验证数据库连接是否正常"""
    try:
        async with AsyncSessionFactory() as session:
            await session.execute(text("SELECT 1"))
            print("Database connection verified successfully.")
    except Exception as e:
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
                    consumed_at TIMESTAMPTZ
                )
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
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS agent_api_keys (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    key_prefix TEXT NOT NULL,
                    key_hash TEXT NOT NULL,
                    key_plaintext TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    last_used_at TIMESTAMPTZ,
                    revoked_at TIMESTAMPTZ
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                ALTER TABLE agent_api_keys
                ADD COLUMN IF NOT EXISTS key_plaintext TEXT
                """
            )
        )
        await connection.execute(
            text(
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
                    revoked_at = now(),
                    key_plaintext = NULL
                FROM ranked_active_keys
                WHERE key.id = ranked_active_keys.id
                  AND ranked_active_keys.active_rank > 1
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_id
                ON agent_api_keys(user_id)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_api_keys_key_prefix
                ON agent_api_keys(key_prefix)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_api_keys_active_user
                ON agent_api_keys(user_id)
                WHERE revoked_at IS NULL
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS agent_plugin_configs (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    selected_template_id TEXT NOT NULL DEFAULT 'modern-slate',
                    polish_before_output BOOLEAN NOT NULL DEFAULT true,
                    polish_level TEXT NOT NULL DEFAULT '标准',
                    force_one_page BOOLEAN NOT NULL DEFAULT true,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )


async def ensure_ai_token_billing_tables() -> None:
    """确保 AI token 钱包、用量与占位购买表存在，兼容老环境升级。"""
    if engine.dialect.name != "postgresql":
        return

    async with engine.begin() as connection:
        await connection.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_token_wallets (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    token_limit INTEGER NOT NULL DEFAULT 0,
                    remaining_tokens INTEGER NOT NULL DEFAULT 0,
                    used_tokens INTEGER NOT NULL DEFAULT 0,
                    last_purchase_id UUID,
                    last_purchase_tokens INTEGER NOT NULL DEFAULT 0,
                    last_purchase_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_token_usage_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    entrypoint TEXT NOT NULL DEFAULT 'unknown',
                    request_label TEXT NOT NULL DEFAULT 'ai_request',
                    provider TEXT NOT NULL DEFAULT 'unknown',
                    model TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'success',
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    total_tokens INTEGER NOT NULL DEFAULT 0,
                    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS ai_token_purchase_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    option_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    tokens INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'placeholder_succeeded',
                    before_remaining_tokens INTEGER NOT NULL DEFAULT 0,
                    after_remaining_tokens INTEGER NOT NULL DEFAULT 0,
                    before_token_limit INTEGER NOT NULL DEFAULT 0,
                    after_token_limit INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_user_created
                ON ai_token_usage_events(user_id, created_at DESC)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_entrypoint
                ON ai_token_usage_events(entrypoint)
                """
            )
        )
        await connection.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_user_created
                ON ai_token_purchase_events(user_id, created_at DESC)
                """
            )
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


async def ensure_dev_schema() -> None:
    """开发环境下的结构自检与补齐。"""
    await init_db()
    await ensure_experience_version_tags_column()
    await ensure_experience_drafts_table()
    await ensure_export_render_snapshots_table()
    await ensure_ai_assistant_tables()
    await ensure_agent_api_keys_table()
    await ensure_ai_token_billing_tables()
    await ensure_feedback_contact_type_column()
    await ensure_feedback_images_column()
