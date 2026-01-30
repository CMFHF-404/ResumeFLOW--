from typing import AsyncGenerator

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
            from sqlalchemy import text
            await session.execute(text("SELECT 1"))
            print("Database connection verified successfully.")
    except Exception as e:
        print(f"Database connection failed: {e}")
        raise e

