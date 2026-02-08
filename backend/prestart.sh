#!/usr/bin/env sh
set -e

# 初始化数据库结构（如果已存在会跳过）
python app/init_db.py

# 启动应用
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
