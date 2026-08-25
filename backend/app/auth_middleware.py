from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, Optional

import httpx
from jose import JWTError, jwt

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED

from .auth_types import AuthenticatedUser as _AuthenticatedUser
from .config import load_settings
from .database import AsyncSessionFactory
from .domain.account.user_onboarding_service import ensure_user_with_signup_bonus

AUTH_HEADER = "Authorization"
BEARER_PREFIX = "Bearer "
MAX_AUTHORIZATION_HEADER_CHARACTERS = 8192
MAX_BEARER_TOKEN_CHARACTERS = MAX_AUTHORIZATION_HEADER_CHARACTERS - len(BEARER_PREFIX)
MAX_JWT_HEADER_SEGMENT_CHARACTERS = 2048
MAX_JWT_KID_CHARACTERS = 256
JWKS_UNKNOWN_KID_REFRESH_COOLDOWN_SECONDS = 30.0
JWKS_REFRESH_FAILURE_COOLDOWN_SECONDS = 5.0
ALLOWED_ALGORITHMS = {"RS256", "ES384"}
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}
PUBLIC_GET_PATH_PREFIXES = (
    "/exports/render-snapshots/",
    "/exports/experience-bank-render-snapshots/",
)
LEGACY_EXPORT_DOWNLOAD_PATH_PATTERN = re.compile(
    r"^/exports/download/(?:resume-pdf|experience-bank-pdf)/[^/]+$"
)
PUBLIC_PATH_PREFIXES = (
    "/agent/v1/",
)
YIFUT_NOTIFY_PATH = "/api/billing/payments/yifut/notify"

class AuthError(Exception):
    pass


class LogtoJWKSCache:
    def __init__(
        self,
        jwks_url: str,
        ttl_seconds: int,
        *,
        unknown_kid_refresh_cooldown_seconds: float = (
            JWKS_UNKNOWN_KID_REFRESH_COOLDOWN_SECONDS
        ),
        refresh_failure_cooldown_seconds: float = (
            JWKS_REFRESH_FAILURE_COOLDOWN_SECONDS
        ),
    ) -> None:
        self._jwks_url = jwks_url
        self._ttl_seconds = ttl_seconds
        self._expires_at = 0.0
        self._jwks: Dict[str, Any] = {}
        self._unknown_kid_refresh_cooldown_seconds = max(
            0.0,
            float(unknown_kid_refresh_cooldown_seconds),
        )
        self._refresh_failure_cooldown_seconds = max(
            0.0,
            float(refresh_failure_cooldown_seconds),
        )
        self._unknown_kid_refresh_after = 0.0
        self._refresh_retry_after = 0.0
        self._refresh_lock = asyncio.Lock()

    async def get_key(self, kid: str) -> Dict[str, Any]:
        if not isinstance(kid, str) or not kid or len(kid) > MAX_JWT_KID_CHARACTERS:
            raise AuthError("Missing kid in token header")
        now = time.monotonic()
        cached_key = self._find_key(kid)
        if self._is_cache_valid(now):
            if cached_key is not None:
                return cached_key
            if now < self._refresh_retry_after:
                raise AuthError("JWKS fetch failed")
            if now < self._unknown_kid_refresh_after:
                raise AuthError("Signing key not found")
        elif now < self._refresh_retry_after:
            raise AuthError("JWKS fetch failed")

        async with self._refresh_lock:
            # Another request may have completed the only required refresh
            # while this request waited for the lock. Recheck every boundary.
            now = time.monotonic()
            cached_key = self._find_key(kid)
            if self._is_cache_valid(now):
                if cached_key is not None:
                    return cached_key
                if now < self._refresh_retry_after:
                    raise AuthError("JWKS fetch failed")
                if now < self._unknown_kid_refresh_after:
                    raise AuthError("Signing key not found")
            elif now < self._refresh_retry_after:
                raise AuthError("JWKS fetch failed")

            try:
                await self._refresh()
            except (httpx.HTTPError, TypeError, ValueError) as exc:
                self._refresh_retry_after = (
                    time.monotonic() + self._refresh_failure_cooldown_seconds
                )
                raise AuthError("JWKS fetch failed") from exc
            refreshed_at = time.monotonic()
            self._refresh_retry_after = 0.0
            self._unknown_kid_refresh_after = (
                refreshed_at + self._unknown_kid_refresh_cooldown_seconds
            )
            key = self._find_key(kid)
            if key is None:
                raise AuthError("Signing key not found")
            return key

    def _is_cache_valid(self, now: Optional[float] = None) -> bool:
        current = time.monotonic() if now is None else now
        return current < self._expires_at

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
            payload = response.json()
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("keys"), list)
            or not all(isinstance(key, dict) for key in payload["keys"])
        ):
            raise ValueError("Invalid JWKS payload")
        self._jwks = payload
        self._expires_at = time.monotonic() + max(0, self._ttl_seconds)


settings = load_settings()
_jwks_cache = LogtoJWKSCache(settings.jwks_url, settings.jwks_ttl_seconds)


def _extract_token(request: Request) -> Optional[str]:
    header = request.headers.get(AUTH_HEADER)
    if not header:
        return None
    if len(header) > MAX_AUTHORIZATION_HEADER_CHARACTERS:
        raise AuthError("Authorization header is too long")
    if not header.startswith(BEARER_PREFIX):
        return None
    token = header[len(BEARER_PREFIX) :].strip()
    if len(token) > MAX_BEARER_TOKEN_CHARACTERS:
        raise AuthError("Authorization header is too long")
    return token


def _has_single_non_empty_legacy_export_token(request: Request) -> bool:
    if request.method != "GET" or not LEGACY_EXPORT_DOWNLOAD_PATH_PATTERN.fullmatch(
        request.url.path
    ):
        return False
    tokens = request.query_params.getlist("token")
    return len(tokens) == 1 and bool(tokens[0].strip())


def _is_public_request(request: Request) -> bool:
    path = request.url.path
    if path in PUBLIC_PATHS or request.method == "OPTIONS":
        return True
    if request.method == "GET" and path == YIFUT_NOTIFY_PATH:
        return True
    if any(path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES):
        return True
    if _has_single_non_empty_legacy_export_token(request):
        return True
    return request.method == "GET" and any(
        path.startswith(prefix) for prefix in PUBLIC_GET_PATH_PREFIXES
    )


async def _verify_token(token: str) -> Dict[str, Any]:
    if len(token) > MAX_BEARER_TOKEN_CHARACTERS:
        raise AuthError("Token is too long")
    header_segment = token.partition(".")[0]
    if not header_segment or len(header_segment) > MAX_JWT_HEADER_SEGMENT_CHARACTERS:
        raise AuthError("Invalid token header")
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
            audience=settings.logto_app_id,
            issuer=settings.logto_issuer,
            options={"verify_at_hash": False},
        )
    except JWTError as exc:
        raise AuthError("Invalid token") from exc


async def _ensure_user_exists(user_id: str) -> None:
    async with AsyncSessionFactory() as session:
        # 使用数据库层幂等插入，避免并发请求引发唯一键冲突
        await ensure_user_with_signup_bonus(session, user_id)
        await session.commit()


class LogtoAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if _is_public_request(request):
            return await call_next(request)

        try:
            token = _extract_token(request)
        except AuthError as exc:
            return JSONResponse(
                {"error": {"code": "unauthorized", "message": str(exc)}},
                status_code=HTTP_401_UNAUTHORIZED,
            )
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
        request.state.user = _AuthenticatedUser(id=user_id)
        request.state.claims = claims
        return await call_next(request)
