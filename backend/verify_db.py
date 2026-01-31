import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def test_connection():
    env_path = Path(__file__).resolve().with_name(".env")
    load_dotenv(env_path)
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL 未配置，请在 backend/.env 中设置后重试。")
        return
    print(f"正在测试连接到: {db_url}")
    
    try:
        engine = create_async_engine(db_url)
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"成功连接！数据库版本: {version}")
            
            # 检查表是否存在
            result = await conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
            tables = [row[0] for row in result.fetchall()]
            print(f"现有的表: {tables}")
            
        await engine.dispose()
        print("\n验证通过！")
    except Exception as e:
        print(f"连接失败: {e}")

if __name__ == "__main__":
    asyncio.run(test_connection())
