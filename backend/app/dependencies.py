from fastapi import HTTPException
from starlette.requests import Request
from starlette.status import HTTP_401_UNAUTHORIZED

from .auth_middleware import AuthenticatedUser
from .config import load_settings


def get_current_user(request: Request) -> AuthenticatedUser:
    user = getattr(request.state, "user", None)
    if not user:
        settings = load_settings()
        if settings.enable_dev_auth_bypass:
            # 仅在显式开启开发绕过时返回模拟用户
            return AuthenticatedUser(id=settings.dev_user_id)
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return user
