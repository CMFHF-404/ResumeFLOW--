from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Dict, Optional

import httpx
from jose import JWTError, jwt
from sqlalchemy.dialects.postgresql import insert as pg_insert

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED

from .config import load_settings
from .database import AsyncSessionFactory
from .models import User

AUTH_HEADER = "Authorization"
BEARER_PREFIX = "Bearer "
ALLOWED_ALGORITHMS = {"RS256", "ES384"}
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str


class AuthError(Exception):
    pass


class LogtoJWKSCache:
    def __init__(self, jwks_url: str, ttl_seconds: int) -> None:
        self._jwks_url = jwks_url
        self._ttl_seconds = ttl_seconds
        self._expires_at = 0.0
        self._jwks: Dict[str, Any] = {}

    async def get_key(self, kid: str) -> Dict[str, Any]:
        if not kid:
            raise AuthError("Missing kid in token header")
        if self._is_cache_valid() and self._find_key(kid):
            return self._find_key(kid)
        try:
            await self._refresh()
        except httpx.HTTPError as exc:
            raise AuthError("JWKS fetch failed") from exc
        key = self._find_key(kid)
        if not key:
            raise AuthError("Signing key not found")
        return key

    def _is_cache_valid(self) -> bool:
        return time.time() < self._expires_at

    def _find_key(self, kid: str) -> Optional[Dict[str, Any]]:
        keys = self._jwks.get("keys", [])
        for key in keys:
            if key.get("kid") == kid:
                return key
        return None

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(self._jwks_url)
            response.raise_for_status()
            self._jwks = response.json()
            self._expires_at = time.time() + self._ttl_seconds


settings = load_settings()
_jwks_cache = LogtoJWKSCache(settings.jwks_url, settings.jwks_ttl_seconds)


def _extract_token(request: Request) -> Optional[str]:
    header = request.headers.get(AUTH_HEADER)
    if not header or not header.startswith(BEARER_PREFIX):
        return None
    return header[len(BEARER_PREFIX) :].strip()


def _is_public_request(request: Request) -> bool:
    return request.url.path in PUBLIC_PATHS or request.method == "OPTIONS"


async def _verify_token(token: str) -> Dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise AuthError("Invalid token header") from exc

    alg = header.get("alg")
    if alg not in ALLOWED_ALGORITHMS:
        raise AuthError("Unsupported token algorithm")

    key = await _jwks_cache.get_key(header.get("kid"))
    try:
        return jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=settings.logto_audience,
            issuer=settings.logto_issuer,
        )
    except JWTError as exc:
        raise AuthError("Invalid token") from exc


async def _ensure_user_exists(user_id: str) -> None:
    async with AsyncSessionFactory() as session:
        # 使用数据库层幂等插入，避免并发请求引发唯一键冲突
        stmt = pg_insert(User).values(id=user_id).on_conflict_do_nothing(
            index_elements=[User.id]
        )
        await session.exec(stmt)
        await session.commit()


class LogtoAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if _is_public_request(request):
            return await call_next(request)

        token = _extract_token(request)
        if not token:
            return JSONResponse(
                {"error": {"code": "unauthorized", "message": "Missing token"}},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        try:
            claims = await _verify_token(token)
        except AuthError as exc:
            return JSONResponse(
                {"error": {"code": "unauthorized", "message": str(exc)}},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        user_id = claims.get("sub")
        if not user_id:
            return JSONResponse(
                {"error": {"code": "unauthorized", "message": "Missing sub"}},
                status_code=HTTP_401_UNAUTHORIZED,
            )

        await _ensure_user_exists(user_id)
        request.state.user = AuthenticatedUser(id=user_id)
        request.state.claims = claims
        return await call_next(request)
