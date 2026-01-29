from fastapi import FastAPI

from .auth_middleware import LogtoAuthMiddleware

app = FastAPI(title="ResumeFlow API")
app.add_middleware(LogtoAuthMiddleware)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
