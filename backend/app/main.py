from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List

from .auth_middleware import LogtoAuthMiddleware
from .config import load_settings
from .domain.ai.ai_router import router as ai_router
from .domain.certifications.certification_router import router as certifications_router
from .domain.experience import experience_router
from .domain.feedback.feedback_router import router as feedback_router
from .domain.parser.parser_router import router as parser_router
from .domain.profile import profile_router
from .domain.skills.skill_router import router as skills_router
from .routers import analytics, experience_versions, resumes

from contextlib import asynccontextmanager
from .database import ensure_experience_version_tags_column, verify_db_connection

def build_cors_allow_credentials(allow_origins: List[str]) -> bool:
    return "*" not in allow_origins

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时：检查数据库连接
    print("Verifying database connection on startup...")
    try:
        await verify_db_connection()
        await ensure_experience_version_tags_column()
    except Exception as e:
        # 如果连不上数据库，直接抛出异常阻止启动
        print(f"CRITICAL: Failed to connect to database. {e}")
        # 在某些环境（如 Uvicorn）下，抛出异常会直接停止进程
        raise RuntimeError("Stopped application startup due to database connection failure.") from e
    
    yield
    # 关闭时：清理工作（如果有）

app = FastAPI(title="ResumeFlow API", lifespan=lifespan)
settings = load_settings()
allow_credentials = build_cors_allow_credentials(settings.cors_allow_origins)

# CORS配置 - 必须在认证中间件之前，确保所有响应都有CORS头
# FastAPI中间件采用洋葱模型，先注册的后执行响应处理
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    # 若允许所有来源，必须禁用凭证，避免跨域凭证泄露风险。
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 认证中间件放在CORS之后，这样即使认证失败，响应也会包含CORS头
if not settings.enable_dev_auth_bypass:
    app.add_middleware(LogtoAuthMiddleware)
app.include_router(profile_router.router)
app.include_router(experience_router.router)
app.include_router(experience_versions.router)
app.include_router(resumes.router)
app.include_router(analytics.router)
app.include_router(skills_router)
app.include_router(certifications_router)
app.include_router(ai_router)
app.include_router(parser_router)
app.include_router(feedback_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
