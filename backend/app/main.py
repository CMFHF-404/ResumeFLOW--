from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth_middleware import LogtoAuthMiddleware
from .domain.ai.ai_router import router as ai_router
from .domain.certifications.certification_router import router as certifications_router
from .domain.experience import experience_router
from .domain.profile import profile_router
from .domain.skills.skill_router import router as skills_router
from .routers import experience_versions, resumes

app = FastAPI(title="ResumeFlow API")

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
