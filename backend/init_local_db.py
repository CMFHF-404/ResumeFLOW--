import asyncio
from pathlib import Path

import asyncpg

async def setup_database():
    # 基础连接字符串（默认连接 postgres 数据库）
    base_url = "postgresql://postgres:postgres@localhost:5432/postgres"
    target_db = "resumeflow"
    
    print(f"正在尝试连接到本地 PostgreSQL...")
    try:
        # 1. 尝试创建数据库
        conn = await asyncpg.connect(base_url)
        try:
            # 检查数据库是否存在
            exists = await conn.fetchval(f"SELECT 1 FROM pg_database WHERE datname = '{target_db}'")
            if not exists:
                print(f"数据库 '{target_db}' 不存在，正在创建...")
                # 必须在事务之外执行 CREATE DATABASE
                await conn.execute(f'CREATE DATABASE {target_db}')
                print(f"数据库 '{target_db}' 创建成功。")
            else:
                print(f"数据库 '{target_db}' 已存在。")
        finally:
            await conn.close()

        # 2. 连接到目标数据库并导入 schema
        print(f"正在连接到 '{target_db}' 数据库以导入表结构...")
        target_url = f"postgresql://postgres:postgres@localhost:5432/{target_db}"
        conn = await asyncpg.connect(target_url)
        try:
            schema_path = Path(__file__).resolve().parent / 'schema.sql'
            with schema_path.open('r', encoding='utf-8') as f:
                schema_sql = f.read()
            
            # 由于 schema.sql 可能包含多个语句和事务块（DO $$），我们简单执行整个文件
            # 这里的 schema.sql 包含了一些 ALTER TABLE ... ADD COLUMN IF NOT EXISTS 等，非常适合初始化
            await conn.execute(schema_sql)
            print("表结构导入成功！")
        finally:
            await conn.close()
            
        print("\n所有操作已完成！你现在可以启动后端服务器了。")

    except Exception as e:
        print(f"发生错误: {e}")

if __name__ == "__main__":
    asyncio.run(setup_database())
