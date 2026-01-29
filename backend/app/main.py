from fastapi import FastAPI

from .auth_middleware import LogtoAuthMiddleware
from .routers import experience_versions, experiences, profile, resumes

app = FastAPI(title="ResumeFlow API")
app.add_middleware(LogtoAuthMiddleware)
app.include_router(profile.router)
app.include_router(experiences.router)
app.include_router(experience_versions.router)
app.include_router(resumes.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
