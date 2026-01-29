from fastapi import FastAPI

from .auth_middleware import LogtoAuthMiddleware
from .domain.experience import experience_router
from .domain.profile import profile_router
from .domain.resume import resume_router
from .routers import experience_versions

app = FastAPI(title="ResumeFlow API")
app.add_middleware(LogtoAuthMiddleware)
app.include_router(profile_router.router)
app.include_router(experience_router.router)
app.include_router(experience_versions.router)
app.include_router(resume_router.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
