from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from typing import Any, Dict, Optional

import httpx
from jose import JWTError, jwk, jwt
from jose.exceptions import JWKError

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_503_SERVICE_UNAVAILABLE

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
JWKS_STALE_IF_ERROR_SECONDS = 15 * 60.0
JWKS_REFRESH_ATTEMPTS = 3
JWKS_REFRESH_BACKOFF_SECONDS = 0.1
ALLOWED_ALGORITHMS = {"RS256", "ES384"}
PUBLIC_PATHS = {"/health", "/ready", "/docs", "/openapi.json", "/redoc"}
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

logger = logging.getLogger(__name__)

class AuthError(Exception):
    pass


class TokenValidationError(AuthError):
    """The caller's bearer token cannot be accepted."""


class AuthDependencyUnavailable(AuthError):
    """Authentication could not be evaluated because the key service failed."""

    def __init__(self, message: str, *, retry_after_seconds: float = 1.0) -> None:
        super().__init__(message)
        self.retry_after_seconds = max(1, math.ceil(retry_after_seconds))


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
        stale_if_error_seconds: float = JWKS_STALE_IF_ERROR_SECONDS,
        refresh_attempts: int = JWKS_REFRESH_ATTEMPTS,
        refresh_backoff_seconds: float = JWKS_REFRESH_BACKOFF_SECONDS,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._jwks_url = jwks_url
        self._ttl_seconds = ttl_seconds
        self._expires_at = 0.0
        self._stale_until = 0.0
        self._jwks: Dict[str, Any] = {}
        self._unknown_kid_refresh_cooldown_seconds = max(
            0.0,
            float(unknown_kid_refresh_cooldown_seconds),
        )
        self._refresh_failure_cooldown_seconds = max(
            0.0,
            float(refresh_failure_cooldown_seconds),
        )
        self._stale_if_error_seconds = max(0.0, float(stale_if_error_seconds))
        self._refresh_attempts = max(1, int(refresh_attempts))
        self._refresh_backoff_seconds = max(0.0, float(refresh_backoff_seconds))
        self._unknown_kid_refresh_after = 0.0
        self._refresh_retry_after = 0.0
        self._refresh_lock = asyncio.Lock()
        self._client = client
        self._owns_client = client is None

    @property
    def is_ready(self) -> bool:
        keys = self._jwks.get("keys")
        return bool(keys) and time.monotonic() < self._stale_until

    async def start(self) -> None:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(5.0, connect=3.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
            self._owns_client = True

    async def close(self) -> None:
        if self._owns_client and self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def warmup(self) -> None:
        """Populate the cold cache without turning an upstream outage into startup death."""
        async with self._refresh_lock:
            if self.is_ready:
                return
            if time.monotonic() < self._refresh_retry_after:
                raise self._dependency_error()
            try:
                await self._refresh()
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                self._mark_refresh_failure()
                logger.warning(
                    "auth_jwks_warmup_failed failure_type=%s",
                    type(exc).__name__,
                )
                raise self._dependency_error() from exc

    def _mark_refresh_failure(self) -> None:
        self._refresh_retry_after = (
            time.monotonic() + self._refresh_failure_cooldown_seconds
        )

    def _dependency_error(self) -> AuthDependencyUnavailable:
        retry_after = max(1.0, self._refresh_retry_after - time.monotonic())
        return AuthDependencyUnavailable(
            "JWKS fetch failed",
            retry_after_seconds=retry_after,
        )

    def _can_use_stale_key(self, kid: str, now: float) -> bool:
        return self._find_key(kid) is not None and now < self._stale_until

    async def get_key(self, kid: str) -> Dict[str, Any]:
        if not isinstance(kid, str) or not kid or len(kid) > MAX_JWT_KID_CHARACTERS:
            raise TokenValidationError("Missing kid in token header")
        now = time.monotonic()
        cached_key = self._find_key(kid)
        if self._is_cache_valid(now):
            if cached_key is not None:
                return cached_key
            if now < self._refresh_retry_after:
                raise self._dependency_error()
            if now < self._unknown_kid_refresh_after:
                raise TokenValidationError("Signing key not found")
        elif now < self._refresh_retry_after:
            if self._can_use_stale_key(kid, now):
                stale_key = self._find_key(kid)
                if stale_key is not None:
                    return stale_key
            raise self._dependency_error()

        async with self._refresh_lock:
            # Another request may have completed the only required refresh
            # while this request waited for the lock. Recheck every boundary.
            now = time.monotonic()
            cached_key = self._find_key(kid)
            if self._is_cache_valid(now):
                if cached_key is not None:
                    return cached_key
                if now < self._refresh_retry_after:
                    raise self._dependency_error()
                if now < self._unknown_kid_refresh_after:
                    raise TokenValidationError("Signing key not found")
            elif now < self._refresh_retry_after:
                if self._can_use_stale_key(kid, now):
                    stale_key = self._find_key(kid)
                    if stale_key is not None:
                        return stale_key
                raise self._dependency_error()

            try:
                await self._refresh()
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                self._mark_refresh_failure()
                failed_at = time.monotonic()
                logger.warning(
                    "auth_jwks_refresh_failed failure_type=%s stale_key_available=%s",
                    type(exc).__name__,
                    self._can_use_stale_key(kid, failed_at),
                )
                if self._can_use_stale_key(kid, failed_at):
                    stale_key = self._find_key(kid)
                    if stale_key is not None:
                        return stale_key
                raise self._dependency_error() from exc
            refreshed_at = time.monotonic()
            self._refresh_retry_after = 0.0
            self._unknown_kid_refresh_after = (
                refreshed_at + self._unknown_kid_refresh_cooldown_seconds
            )
            key = self._find_key(kid)
            if key is None:
                raise TokenValidationError("Signing key not found")
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

    @staticmethod
    def _validated_jwks(payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict) or not isinstance(payload.get("keys"), list):
            raise ValueError("Invalid JWKS payload")

        usable_keys: list[Dict[str, Any]] = []
        seen_kids: set[str] = set()
        for key in payload["keys"]:
            if not isinstance(key, dict):
                raise ValueError("Invalid JWKS payload")
            kid = key.get("kid")
            if (
                not isinstance(kid, str)
                or not kid
                or len(kid) > MAX_JWT_KID_CHARACTERS
                or kid in seen_kids
            ):
                raise ValueError("Invalid JWKS payload")
            kty = key.get("kty")
            if kty == "RSA":
                required_members = ("n", "e")
            elif kty == "EC":
                required_members = ("crv", "x", "y")
            else:
                # Ignore key types that cannot verify the accepted algorithms.
                continue
            if not all(
                isinstance(key.get(member), str) and key[member]
                for member in required_members
            ):
                raise ValueError("Invalid JWKS payload")
            validation_algorithm = "RS256" if kty == "RSA" else "ES384"
            try:
                # Presence checks do not prove that base64url parameters form
                # a usable public key. Use the same JOSE backend as decode so
                # malformed provider data can never escape later as a 500.
                jwk.construct(key, validation_algorithm)
            except (JWKError, KeyError, TypeError, ValueError) as exc:
                raise ValueError("Invalid JWKS payload") from exc
            seen_kids.add(kid)
            usable_keys.append(key)

        if not usable_keys:
            raise ValueError("Invalid JWKS payload")
        return {"keys": usable_keys}

    async def _refresh(self) -> None:
        await self.start()
        last_error: Optional[Exception] = None
        for attempt in range(self._refresh_attempts):
            try:
                assert self._client is not None
                response = await self._client.get(self._jwks_url)
                response.raise_for_status()
                payload = self._validated_jwks(response.json())
                refreshed_at = time.monotonic()
                self._jwks = payload
                self._expires_at = refreshed_at + max(0, self._ttl_seconds)
                self._stale_until = self._expires_at + self._stale_if_error_seconds
                logger.info(
                    "auth_jwks_refresh_succeeded key_count=%d",
                    len(payload["keys"]),
                )
                return
            except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
                last_error = exc
                if attempt + 1 < self._refresh_attempts:
                    await asyncio.sleep(
                        self._refresh_backoff_seconds * (2 ** attempt)
                    )
        assert last_error is not None
        raise last_error


settings = load_settings()
jwks_cache = LogtoJWKSCache(settings.jwks_url, settings.jwks_ttl_seconds)
# Compatibility alias retained for existing tests and narrow integrations.
_jwks_cache = jwks_cache


def _extract_token(request: Request) -> Optional[str]:
    header = request.headers.get(AUTH_HEADER)
    if not header:
        return None
    if len(header) > MAX_AUTHORIZATION_HEADER_CHARACTERS:
        raise TokenValidationError("Authorization header is too long")
    if not header.startswith(BEARER_PREFIX):
        return None
    token = header[len(BEARER_PREFIX) :].strip()
    if len(token) > MAX_BEARER_TOKEN_CHARACTERS:
        raise TokenValidationError("Authorization header is too long")
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
        raise TokenValidationError("Token is too long")
    header_segment = token.partition(".")[0]
    if not header_segment or len(header_segment) > MAX_JWT_HEADER_SEGMENT_CHARACTERS:
        raise TokenValidationError("Invalid token header")
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise TokenValidationError("Invalid token header") from exc

    alg = header.get("alg")
    if alg not in ALLOWED_ALGORITHMS:
        raise TokenValidationError("Unsupported token algorithm")

    key = await jwks_cache.get_key(header.get("kid"))
    if (
        (alg == "RS256" and key.get("kty") != "RSA")
        or (alg == "ES384" and key.get("kty") != "EC")
    ):
        raise TokenValidationError("Signing key does not match token algorithm")
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
        raise TokenValidationError("Invalid token") from exc
    except (TypeError, ValueError) as exc:
        # python-jose raises these directly for malformed registered claims
        # such as exp=[] or nbf=[]. The key was already validated when the
        # JWKS cache was populated, so caller-controlled claim formats remain
        # an invalid-token response instead of masquerading as an outage.
        raise TokenValidationError("Invalid token") from exc
    except (JWKError, KeyError) as exc:
        raise AuthDependencyUnavailable(
            "JWKS key parsing failed",
            retry_after_seconds=JWKS_REFRESH_FAILURE_COOLDOWN_SECONDS,
        ) from exc


async def _ensure_user_exists(user_id: str) -> None:
    async with AsyncSessionFactory() as session:
        # 使用数据库层幂等插入，避免并发请求引发唯一键冲突
        await ensure_user_with_signup_bonus(session, user_id)
        await session.commit()


class LogtoAuthMiddleware(BaseHTTPMiddleware):
    @staticmethod
    def _invalid_token_response(message: str) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": "invalid_token", "message": message}},
            status_code=HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )

    async def dispatch(self, request: Request, call_next):
        if _is_public_request(request):
            return await call_next(request)

        try:
            token = _extract_token(request)
        except TokenValidationError as exc:
            return self._invalid_token_response(str(exc))
        if not token:
            return self._invalid_token_response("Missing token")

        try:
            claims = await _verify_token(token)
        except AuthDependencyUnavailable as exc:
            return JSONResponse(
                {
                    "error": {
                        "code": "auth_dependency_unavailable",
                        "message": str(exc),
                    }
                },
                status_code=HTTP_503_SERVICE_UNAVAILABLE,
                headers={"Retry-After": str(exc.retry_after_seconds)},
            )
        except TokenValidationError as exc:
            return self._invalid_token_response(str(exc))

        user_id = claims.get("sub")
        if not user_id:
            return self._invalid_token_response("Missing sub")

        await _ensure_user_exists(user_id)
        request.state.user = _AuthenticatedUser(id=user_id)
        request.state.claims = claims
        return await call_next(request)
