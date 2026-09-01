#!/usr/bin/env sh
set -e

# The Docker build marker is intentionally stronger than a runtime env var:
# production containers cannot be downgraded to local by `docker run -e`.
# A repository checkout outside /app has no marker and keeps local defaults.
if [ -f /app/.resumeflow-production-image ]; then
    export RESUMEFLOW_DEPLOYMENT_MODE=production
fi

# Validate the public frontend Logto mirror before any database migration or
# Uvicorn startup. Remote deployments fail closed on cross-container drift.
python -c 'from app.config import load_settings; load_settings()'

# 初始化数据库结构（如果已存在会跳过）
python app/init_db.py

# 启动应用
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
