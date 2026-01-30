from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth_middleware import LogtoAuthMiddleware
from .domain.ai.ai_router import router as ai_router
from .domain.certifications.certification_router import router as certifications_router
from .domain.experience import experience_router
from .domain.profile import profile_router
from .domain.skills.skill_router import router as skills_router
from .routers import experience_versions, resumes

from contextlib import asynccontextmanager
from .database import verify_db_connection

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时：检查数据库连接
    print("Verifying database connection on startup...")
    try:
        await verify_db_connection()
    except Exception as e:
        # 如果连不上数据库，直接抛出异常阻止启动
        print(f"CRITICAL: Failed to connect to database. {e}")
        # 在某些环境（如 Uvicorn）下，抛出异常会直接停止进程
        raise RuntimeError("Stopped application startup due to database connection failure.") from e
    
    yield
    # 关闭时：清理工作（如果有）

app = FastAPI(title="ResumeFlow API", lifespan=lifespan)

app.add_middleware(LogtoAuthMiddleware)
# CORS配置 - 允许前端开发服务器的跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(profile_router.router)
app.include_router(experience_router.router)
app.include_router(experience_versions.router)
app.include_router(resumes.router)
app.include_router(skills_router)
app.include_router(certifications_router)
app.include_router(ai_router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
