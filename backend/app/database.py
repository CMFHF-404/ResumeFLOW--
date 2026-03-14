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


async def ensure_dev_schema() -> None:
    """开发环境下的结构自检与补齐。"""
    await init_db()
    await ensure_experience_version_tags_column()
    await ensure_export_render_snapshots_table()
