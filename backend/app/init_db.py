import asyncio
import os
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

ENV_DATABASE_URL = "DATABASE_URL"
ENV_FILE_NAME = ".env"
SCHEMA_FILE_NAME = "schema.sql"
SQLALCHEMY_ASYNCPG_PREFIX = "postgresql+asyncpg://"
POSTGRES_PREFIX = "postgresql://"
DEFAULT_MAX_RETRIES = 10
DEFAULT_RETRY_DELAY_SECONDS = 1.5
RETRY_BACKOFF_FACTOR = 1.5
MAX_RETRY_DELAY_SECONDS = 8.0


def _load_env_file() -> None:
    """在存在 .env 时加载，便于本地调试；生产环境依赖容器环境变量。"""
    env_path = Path(__file__).resolve().parents[1] / ENV_FILE_NAME
    if env_path.exists():
        load_dotenv(env_path)


def _normalize_database_url(database_url: str) -> str:
    """兼容 SQLAlchemy 异步连接串格式，转换为 asyncpg 可识别的 DSN。"""
    if database_url.startswith(SQLALCHEMY_ASYNCPG_PREFIX):
        return POSTGRES_PREFIX + database_url[len(SQLALCHEMY_ASYNCPG_PREFIX) :]
    return database_url


def _get_database_url() -> str:
    _load_env_file()
    database_url = os.getenv(ENV_DATABASE_URL)
    if not database_url:
        raise RuntimeError(f"缺少环境变量: {ENV_DATABASE_URL}")
    return _normalize_database_url(database_url)


def _get_schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / SCHEMA_FILE_NAME


def _read_schema_sql(schema_path: Path) -> str:
    if not schema_path.exists():
        raise FileNotFoundError(f"未找到 schema 文件: {schema_path}")
    return schema_path.read_text(encoding="utf-8")


def _calculate_retry_delay(attempt: int) -> float:
    delay = DEFAULT_RETRY_DELAY_SECONDS * (RETRY_BACKOFF_FACTOR ** (attempt - 1))
    return min(delay, MAX_RETRY_DELAY_SECONDS)


async def _connect_with_retry(database_url: str) -> asyncpg.Connection:
    """带重试的数据库连接，避免容器启动时数据库尚未就绪导致失败。"""
    attempt = 0
    while True:
        try:
            return await asyncpg.connect(database_url)
        except Exception as exc:
            attempt += 1
            if attempt > DEFAULT_MAX_RETRIES:
                raise
            delay = _calculate_retry_delay(attempt)
            print(f"数据库连接失败（第 {attempt} 次），{delay:.1f}s 后重试: {exc}")
            await asyncio.sleep(delay)


async def _apply_schema(database_url: str, schema_sql: str) -> None:
    connection = await _connect_with_retry(database_url)
    try:
        await connection.execute(schema_sql)
    finally:
        await connection.close()


async def init_db() -> None:
    """读取 schema.sql 并执行初始化。"""
    database_url = _get_database_url()
    schema_path = _get_schema_path()
    schema_sql = _read_schema_sql(schema_path)
    print(f"开始初始化数据库结构: {schema_path}")
    await _apply_schema(database_url, schema_sql)
    print("数据库结构初始化完成。")


if __name__ == "__main__":
    asyncio.run(init_db())
