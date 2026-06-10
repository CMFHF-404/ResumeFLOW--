import asyncio
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from typing import List

from .auth_middleware import LogtoAuthMiddleware
from .config import load_settings
from .domain.account.account_router import router as account_router
from .domain.agent.agent_router import router as agent_router
from .domain.ai.ai_router import router as ai_router
from .domain.assistant.assistant_router import router as assistant_router
from .domain.certifications.certification_router import router as certifications_router
from .domain.experience import experience_router
from .domain.experience.draft_router import router as experience_draft_router
from .domain.export.export_router import router as export_router
from .domain.export.schemas import (
    ExperienceBankPdfExportRequest,
    ResumePdfExportRequest,
)
from .domain.feedback.feedback_router import router as feedback_router
from .domain.parser.parser_router import router as parser_router
from .domain.profile import profile_router
from .domain.skills.skill_router import router as skills_router
from .routers import experience_versions, resumes

from contextlib import asynccontextmanager
from .database import (
    ensure_agent_api_keys_table,
    ensure_ai_assistant_tables,
    ensure_experience_drafts_table,
    ensure_experience_version_tags_column,
    ensure_feedback_contact_type_column,
    ensure_feedback_images_column,
    ensure_export_render_snapshots_table,
    verify_db_connection,
)
from .domain.export.browser_pdf_service import close_browser

def build_cors_allow_credentials(allow_origins: List[str]) -> bool:
    return "*" not in allow_origins

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时：检查数据库连接
    print("Verifying database connection on startup...")
    try:
        await verify_db_connection()
        await ensure_experience_version_tags_column()
        await ensure_experience_drafts_table()
        await ensure_export_render_snapshots_table()
        await ensure_ai_assistant_tables()
        await ensure_agent_api_keys_table()
        await ensure_feedback_contact_type_column()
        await ensure_feedback_images_column()
    except Exception as e:
        # 如果连不上数据库，直接抛出异常阻止启动
        print(f"CRITICAL: Failed to connect to database. {e}")
        # 在某些环境（如 Uvicorn）下，抛出异常会直接停止进程
        raise RuntimeError("Stopped application startup due to database connection failure.") from e
    
    yield
    # 关闭时：清理工作（如果有）
    await close_browser()

app = FastAPI(title="ResumeFlow API", lifespan=lifespan)
settings = load_settings()
allow_credentials = build_cors_allow_credentials(settings.cors_allow_origins)

if not settings.enable_dev_auth_bypass:
    app.add_middleware(LogtoAuthMiddleware)
# CORS 必须放在最外层，确保包括鉴权失败在内的所有响应都带上跨域头
# Starlette/FastAPI 中后注册的中间件会包裹先注册的中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    # 若允许所有来源，必须禁用凭证，避免跨域凭证泄露风险。
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
app.include_router(profile_router.router)
app.include_router(account_router)
app.include_router(experience_router.router)
app.include_router(experience_draft_router)
app.include_router(experience_versions.router)
app.include_router(resumes.router)
app.include_router(skills_router)
app.include_router(certifications_router)
app.include_router(agent_router)
app.include_router(ai_router)
app.include_router(assistant_router)
app.include_router(parser_router)
app.include_router(feedback_router)
app.include_router(export_router)


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    components = schema.setdefault("components", {}).setdefault("schemas", {})

    for model in (ResumePdfExportRequest, ExperienceBankPdfExportRequest):
        model_schema = model.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
        model_defs = model_schema.pop("$defs", {})
        for name, definition in model_defs.items():
            components.setdefault(name, definition)
        components[model.__name__] = model_schema

    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/health")
async def health_check():
    return {"status": "ok"}
