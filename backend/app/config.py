from dataclasses import dataclass
import hashlib
import ipaddress
import os
from pathlib import Path
import re
from typing import List, Optional
from urllib.parse import unquote, urlsplit

from dotenv import load_dotenv

from .ai_model_capabilities import is_openai_responses_streaming_unsupported

DEFAULT_JWKS_PATH = "/jwks"
ENV_DATABASE_URL = "DATABASE_URL"
ENV_LOGTO_ISSUER = "LOGTO_ISSUER"
ENV_LOGTO_APP_ID = "LOGTO_APP_ID"
ENV_LOGTO_JWKS_TTL = "LOGTO_JWKS_TTL_SECONDS"
ENV_RESUMEFLOW_DEPLOYMENT_MODE = "RESUMEFLOW_DEPLOYMENT_MODE"
ENV_FRONTEND_LOGTO_ENDPOINT = "FRONTEND_LOGTO_ENDPOINT"
ENV_FRONTEND_LOGTO_APP_ID = "FRONTEND_LOGTO_APP_ID"
ENV_FRONTEND_LOGTO_REDIRECT_URI = "FRONTEND_LOGTO_REDIRECT_URI"
ENV_AI_API_KEY = "AI_API_KEY"
ENV_AI_BASE_URL = "AI_BASE_URL"
ENV_AI_RESPONSES_BASE_URL = "AI_RESPONSES_BASE_URL"
ENV_AI_MODEL = "AI_MODEL"
ENV_AI_ROUTE_PROFILE = "AI_ROUTE_PROFILE"
ENV_AI_FAST_API_KEY = "AI_FAST_API_KEY"
ENV_AI_FAST_BASE_URL = "AI_FAST_BASE_URL"
ENV_AI_FAST_MODEL = "AI_FAST_MODEL"
ENV_AI_DEDUPE_ENABLED = "AI_DEDUPE_ENABLED"
ENV_AI_DEDUPE_MODEL = "AI_DEDUPE_MODEL"
ENV_AI_DEDUPE_MAX_CANDIDATES = "AI_DEDUPE_MAX_CANDIDATES"
ENV_AI_TIMEOUT_SECONDS = "AI_TIMEOUT_SECONDS"
ENV_AI_MAX_REQUEST_BODY_BYTES = "AI_MAX_REQUEST_BODY_BYTES"
ENV_AI_MAX_TEXT_FIELD_CHARS = "AI_MAX_TEXT_FIELD_CHARS"
ENV_AI_STREAM_MAX_EVENT_BYTES = "AI_STREAM_MAX_EVENT_BYTES"
ENV_AI_STREAM_MAX_TOTAL_BYTES = "AI_STREAM_MAX_TOTAL_BYTES"
ENV_AI_STREAM_MAX_EVENTS = "AI_STREAM_MAX_EVENTS"
ENV_AI_ASSISTANT_BUFFER_MAX_CHARS = "AI_ASSISTANT_BUFFER_MAX_CHARS"
ENV_AI_STREAM_TOTAL_TIMEOUT_SECONDS = "AI_STREAM_TOTAL_TIMEOUT_SECONDS"
ENV_AI_STREAM_QUEUE_MAX_EVENTS = "AI_STREAM_QUEUE_MAX_EVENTS"
ENV_AI_MAX_OUTPUT_TOKENS = "AI_MAX_OUTPUT_TOKENS"
ENV_GEMINI_API_KEY = "GEMINI_API_KEY"
ENV_GEMINI_BASE_URL = "GEMINI_BASE_URL"
ENV_GEMINI_MODEL = "GEMINI_MODEL"
ENV_AI_THINKING_BUDGET_JD_ANALYSIS = "AI_THINKING_BUDGET_JD_ANALYSIS"
ENV_AI_THINKING_BUDGET_POLISH = "AI_THINKING_BUDGET_POLISH"
ENV_AI_THINKING_BUDGET_BOSS_GREETING = "AI_THINKING_BUDGET_BOSS_GREETING"
ENV_ENABLE_DEV_AUTH_BYPASS = "ENABLE_DEV_AUTH_BYPASS"
ENV_ENABLE_RESUME_OPTIMIZATION = "ENABLE_RESUME_OPTIMIZATION"
ENV_RESUME_OPTIMIZATION_MAX_QUESTIONS = "RESUME_OPTIMIZATION_MAX_QUESTIONS"
ENV_RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS = (
    "RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS"
)
ENV_DEV_USER_ID = "DEV_USER_ID"
ENV_CORS_ALLOW_ORIGINS = "CORS_ALLOW_ORIGINS"
ENV_FEISHU_WEBHOOK_URL = "FEISHU_WEBHOOK_URL"
ENV_FEISHU_APP_ID = "FEISHU_APP_ID"
ENV_FEISHU_APP_SECRET = "FEISHU_APP_SECRET"
ENV_FRONTEND_ORIGIN = "FRONTEND_ORIGIN"
ENV_PUBLIC_API_ORIGIN = "PUBLIC_API_ORIGIN"
ENV_EXPORT_SNAPSHOT_TTL_SECONDS = "EXPORT_SNAPSHOT_TTL_SECONDS"
ENV_EXPORT_TOKEN_SECRET = "EXPORT_TOKEN_SECRET"
ENV_EXPORT_RENDER_TIMEOUT_SECONDS = "EXPORT_RENDER_TIMEOUT_SECONDS"
ENV_REDEMPTION_CODE_ENCRYPTION_KEY = "REDEMPTION_CODE_ENCRYPTION_KEY"
ENV_YIFUT_ENABLED = "YIFUT_ENABLED"
ENV_YIFUT_TEST_USER_IDS = "YIFUT_TEST_USER_IDS"
ENV_YIFUT_MERCHANT_ID = "YIFUT_MERCHANT_ID"
ENV_YIFUT_MERCHANT_PRIVATE_KEY = "YIFUT_MERCHANT_PRIVATE_KEY"
ENV_YIFUT_PLATFORM_PUBLIC_KEY = "YIFUT_PLATFORM_PUBLIC_KEY"
ENV_YIFUT_BASE_URL = "YIFUT_BASE_URL"
DEFAULT_JWKS_TTL_SECONDS = 3600
DEFAULT_RESUMEFLOW_DEPLOYMENT_MODE = "local"
VALID_RESUMEFLOW_DEPLOYMENT_MODES = {"local", "production"}
DEFAULT_AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_AI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_AI_ROUTE_PROFILE = "gemini_primary"
VALID_AI_ROUTE_PROFILES = {
    "hybrid_gemini_aifast",
    "gemini_primary",
    "openai_primary",
    "qwen_primary",
}
DEFAULT_AI_TIMEOUT_SECONDS = 300
DEFAULT_AI_DEDUPE_MAX_CANDIDATES = 24
DEFAULT_AI_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024
DEFAULT_AI_MAX_TEXT_FIELD_CHARS = 200_000
DEFAULT_AI_STREAM_MAX_EVENT_BYTES = 256 * 1024
DEFAULT_AI_STREAM_MAX_TOTAL_BYTES = 4 * 1024 * 1024
DEFAULT_AI_STREAM_MAX_EVENTS = 10_000
DEFAULT_AI_ASSISTANT_BUFFER_MAX_CHARS = 1_048_576
DEFAULT_AI_STREAM_TOTAL_TIMEOUT_SECONDS = 360
DEFAULT_AI_STREAM_QUEUE_MAX_EVENTS = 64
DEFAULT_AI_MAX_OUTPUT_TOKENS = 16_384
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_AI_THINKING_BUDGET_JD_ANALYSIS = 1024
DEFAULT_AI_THINKING_BUDGET_POLISH = 1024
DEFAULT_AI_THINKING_BUDGET_BOSS_GREETING = 0
DEFAULT_DEV_USER_ID = "dev-user-test-123"
DEFAULT_ENABLE_RESUME_OPTIMIZATION = False
DEFAULT_RESUME_OPTIMIZATION_MAX_QUESTIONS = 5
DEFAULT_RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS = 3
DEFAULT_CORS_ALLOW_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]
DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
DEFAULT_PUBLIC_API_ORIGIN = "http://localhost:8000"
DEFAULT_YIFUT_BASE_URL = "https://www.yifut.com"
DEFAULT_EXPORT_SNAPSHOT_TTL_SECONDS = 300
DEFAULT_EXPORT_RENDER_TIMEOUT_SECONDS = 45
MIN_EXPORT_SNAPSHOT_TTL_SECONDS = 30
MAX_EXPORT_SNAPSHOT_TTL_SECONDS = 3600
MIN_EXPORT_RENDER_TIMEOUT_SECONDS = 5
MAX_EXPORT_RENDER_TIMEOUT_SECONDS = 120
ENV_FILE_NAME = ".env"
ASYNC_POSTGRES_SCHEME = "postgresql+asyncpg://"
POSTGRES_SCHEMES = ("postgresql://", "postgres://")


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _normalize_database_url(value: str) -> str:
    """兼容托管平台注入的标准 PostgreSQL URL，统一转换为 asyncpg 方言。"""
    if value.startswith(ASYNC_POSTGRES_SCHEME):
        return value
    for scheme in POSTGRES_SCHEMES:
        if value.startswith(scheme):
            return f"{ASYNC_POSTGRES_SCHEME}{value[len(scheme):]}"
    return value


def derive_qwen_responses_base_url(ai_base_url: Optional[str]) -> str:
    normalized = (ai_base_url or "").rstrip("/")
    responses_suffix = "/api/v2/apps/protocols/compatible-mode/v1"
    if normalized.endswith(responses_suffix):
        return normalized

    chat_suffix = "/compatible-mode/v1"
    if normalized.endswith(chat_suffix):
        return f"{normalized[: -len(chat_suffix)]}{responses_suffix}"

    return normalized


def _resolve_ai_responses_base_url(ai_base_url: str) -> str:
    configured = os.getenv(ENV_AI_RESPONSES_BASE_URL)
    if configured:
        return configured.rstrip("/")

    return derive_qwen_responses_base_url(ai_base_url)


def _configured_env_value(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip()
    return normalized or None


def _has_same_http_origin(first_url: str, second_url: str) -> bool:
    try:
        first = urlsplit(first_url)
        second = urlsplit(second_url)
        first_scheme = first.scheme.lower()
        second_scheme = second.scheme.lower()
        if first_scheme not in {"http", "https"} or second_scheme not in {
            "http",
            "https",
        }:
            return False
        default_ports = {"http": 80, "https": 443}
        first_port = first.port if first.port is not None else default_ports[first_scheme]
        second_port = (
            second.port if second.port is not None else default_ports[second_scheme]
        )
        return (
            bool(first.scheme and first.hostname and second.scheme and second.hostname)
            and first_scheme == second_scheme
            and first.hostname.lower() == second.hostname.lower()
            and first_port == second_port
        )
    except ValueError:
        return False


def validate_ai_responses_base_url_origin(
    *, ai_base_url: str, ai_responses_base_url: str
) -> None:
    """Responses requests share AI_API_KEY, so their endpoint cannot cross origins."""
    if not _has_same_http_origin(ai_base_url, ai_responses_base_url):
        raise RuntimeError(
            f"{ENV_AI_RESPONSES_BASE_URL} must share an origin with "
            f"{ENV_AI_BASE_URL} because no independent Responses API key is configured"
        )


def resolve_ai_fast_lane_credentials(
    *,
    ai_api_key: Optional[str],
    ai_base_url: str,
    configured_fast_api_key: Optional[str],
    configured_fast_base_url: Optional[str],
) -> tuple[Optional[str], str]:
    """Resolve the fast lane without attaching a primary key to another endpoint."""
    fast_api_key = _configured_env_value(configured_fast_api_key)
    fast_base_url = _configured_env_value(configured_fast_base_url)
    if bool(fast_api_key) != bool(fast_base_url):
        raise RuntimeError(
            f"{ENV_AI_FAST_BASE_URL} and {ENV_AI_FAST_API_KEY} must be configured together"
        )
    return fast_api_key or ai_api_key, fast_base_url or ai_base_url


def validate_production_ai_lane_credentials(
    *,
    deployment_mode: str,
    route_profile: str,
    ai_api_key: Optional[str],
    gemini_api_key: Optional[str],
    ai_fast_api_key: Optional[str],
) -> None:
    """Fail startup when any production AI lane lacks usable credentials."""
    if deployment_mode != "production":
        return

    has_ai_key = bool(_configured_env_value(ai_api_key))
    has_gemini_key = bool(_configured_env_value(gemini_api_key))
    has_fast_key = bool(_configured_env_value(ai_fast_api_key))

    if route_profile == "gemini_primary":
        if not has_gemini_key:
            raise RuntimeError(
                f"Missing required environment variable: {ENV_GEMINI_API_KEY} when "
                f"{ENV_AI_ROUTE_PROFILE}=gemini_primary in production"
            )
        return

    if route_profile in {"openai_primary", "qwen_primary"}:
        if not has_ai_key:
            raise RuntimeError(
                f"Missing required environment variable: {ENV_AI_API_KEY} when "
                f"{ENV_AI_ROUTE_PROFILE}={route_profile} in production"
            )
        return

    if route_profile == "hybrid_gemini_aifast":
        if not has_fast_key:
            raise RuntimeError(
                f"Missing required environment variable: {ENV_AI_API_KEY} or "
                f"{ENV_AI_FAST_API_KEY} for the resume_parse lane when "
                f"{ENV_AI_ROUTE_PROFILE}=hybrid_gemini_aifast in production"
            )
        if not (has_gemini_key or has_ai_key):
            raise RuntimeError(
                f"Missing required environment variable: {ENV_AI_API_KEY} or "
                f"{ENV_GEMINI_API_KEY} for the default/tool/thinking lanes when "
                f"{ENV_AI_ROUTE_PROFILE}=hybrid_gemini_aifast in production"
            )


def _is_dashscope_url(value: str) -> bool:
    try:
        hostname = (urlsplit(value).hostname or "").lower()
    except ValueError:
        return False
    return hostname == "dashscope.aliyuncs.com" or hostname.endswith(
        ".dashscope.aliyuncs.com"
    )


def _is_official_openai_api_url(value: str) -> bool:
    try:
        hostname = (urlsplit(value).hostname or "").lower()
    except ValueError:
        return False
    return hostname == "api.openai.com" or hostname.endswith(".api.openai.com")


def validate_openai_responses_streaming_model(
    *,
    model: str,
    responses_base_url: str,
) -> None:
    if (
        _is_official_openai_api_url(responses_base_url)
        and is_openai_responses_streaming_unsupported(model)
    ):
        raise RuntimeError(
            f"Invalid {ENV_AI_MODEL}: {model} does not support the streaming "
            "Responses transport required by this application"
        )


def validate_openai_primary_provider_urls(
    *,
    ai_base_url: str,
    ai_responses_base_url: Optional[str],
    ai_base_url_is_explicit: bool,
) -> None:
    """Keep an OpenAI-primary route from silently inheriting Qwen endpoints."""
    if not ai_base_url_is_explicit:
        raise RuntimeError(
            f"{ENV_AI_BASE_URL} must be explicitly configured when "
            f"{ENV_AI_ROUTE_PROFILE}=openai_primary"
        )
    if _is_dashscope_url(ai_base_url):
        raise RuntimeError(
            f"Invalid {ENV_AI_BASE_URL}: DashScope endpoints cannot be used when "
            f"{ENV_AI_ROUTE_PROFILE}=openai_primary"
        )
    if ai_responses_base_url and _is_dashscope_url(ai_responses_base_url):
        raise RuntimeError(
            f"Invalid {ENV_AI_RESPONSES_BASE_URL}: DashScope Responses endpoints "
            f"cannot be used when {ENV_AI_ROUTE_PROFILE}=openai_primary"
        )


def _normalize_issuer(issuer: str) -> str:
    return issuer.rstrip("/")


def _resolve_deployment_mode(value: Optional[str]) -> str:
    mode = (value or DEFAULT_RESUMEFLOW_DEPLOYMENT_MODE).strip().lower()
    if mode not in VALID_RESUMEFLOW_DEPLOYMENT_MODES:
        valid = ", ".join(sorted(VALID_RESUMEFLOW_DEPLOYMENT_MODES))
        raise RuntimeError(
            f"Invalid {ENV_RESUMEFLOW_DEPLOYMENT_MODE}: expected one of: {valid}"
        )
    return mode

def _get_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _get_bounded_int_env(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = os.getenv(name)
    try:
        value = default if raw_value is None else int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"Invalid {name}: expected an integer") from exc
    if value < minimum or value > maximum:
        raise RuntimeError(
            f"Invalid {name}: expected a value between {minimum} and {maximum}"
        )
    return value


def _resolve_ai_route_profile(value: Optional[str]) -> str:
    normalized = (value or DEFAULT_AI_ROUTE_PROFILE).strip().lower()
    if normalized not in VALID_AI_ROUTE_PROFILES:
        valid = ", ".join(sorted(VALID_AI_ROUTE_PROFILES))
        raise RuntimeError(f"Invalid {ENV_AI_ROUTE_PROFILE}: {normalized}. Expected one of: {valid}")
    return normalized


def _resolve_ai_model_for_profile(
    value: Optional[str],
    *,
    route_profile: str,
    gemini_model: str,
    gemini_api_key: Optional[str],
    fast_model: Optional[str],
) -> str:
    if route_profile == "gemini_primary":
        return gemini_model
    if (
        route_profile == "hybrid_gemini_aifast"
        and _configured_env_value(gemini_api_key)
        and not _configured_env_value(value)
        and _configured_env_value(fast_model)
    ):
        return _configured_env_value(fast_model) or ""
    if value is None or not value.strip():
        raise RuntimeError(
            f"Invalid {ENV_AI_MODEL}: a compatible model must be explicitly configured "
            f"through {ENV_AI_MODEL} or {ENV_AI_FAST_MODEL} when "
            f"{ENV_AI_ROUTE_PROFILE}={route_profile}"
        )
    normalized = value.strip()
    if normalized.lower().startswith("gemini"):
        raise RuntimeError(
            f"Invalid {ENV_AI_MODEL}: a Gemini model cannot be used with "
            f"{ENV_AI_ROUTE_PROFILE}={route_profile}"
        )
    return normalized


def validate_gemini_model(value: Optional[str]) -> str:
    normalized = (value or "").strip()
    if re.fullmatch(r"gemini-[A-Za-z0-9][A-Za-z0-9._-]*", normalized) is None:
        raise RuntimeError(
            f"Invalid {ENV_GEMINI_MODEL}: expected a non-empty Gemini model ID"
        )
    return normalized


def normalize_ai_provider_base_url(
    value: str,
    env_name: str,
    *,
    production: bool,
) -> str:
    if production:
        return _normalize_deployment_http_base_url(value, env_name)
    return (value or "").rstrip("/")


def _validate_compatible_lane_model(
    value: str,
    *,
    env_name: str,
    route_profile: str,
) -> str:
    normalized = value.strip()
    if route_profile != "gemini_primary" and normalized.lower().startswith("gemini"):
        raise RuntimeError(
            f"Invalid {env_name}: a Gemini model cannot be used with "
            f"{ENV_AI_ROUTE_PROFILE}={route_profile}"
        )
    return normalized

def _parse_csv_env(name: str, default: List[str]) -> List[str]:
    value = os.getenv(name)
    if not value:
        return list(default)
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


def _load_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ENV_FILE_NAME
    load_dotenv(env_path)


def _normalize_origin(value: str) -> str:
    return _normalize_deployment_http_base_url(value, ENV_FRONTEND_ORIGIN)


def _normalize_deployment_http_base_url(value: str, env_name: str) -> str:
    """Validate a deployment URL with an optional safe mount prefix.

    Remote traffic must use HTTPS because these URLs carry authentication
    tokens or exported resume data. Plain HTTP remains available only for a
    strict loopback development target.
    """
    raw_value = value or ""
    candidate = raw_value.strip()
    try:
        parsed = urlsplit(candidate)
        parsed_port = parsed.port
    except ValueError as exc:
        raise RuntimeError(
            f"Invalid {env_name}: expected a secure HTTP(S) base URL with an optional safe path prefix"
        ) from exc

    hostname = parsed.hostname or ""
    hostname_labels = hostname.split(".") if hostname else []
    try:
        parsed_ip = ipaddress.ip_address(hostname)
    except ValueError:
        parsed_ip = None
    hostname_is_valid = parsed_ip is not None or (
        re.fullmatch(r"[A-Za-z0-9.-]+", hostname) is not None
        and all(
            label and not label.startswith("-") and not label.endswith("-")
            for label in hostname_labels
        )
    )
    is_loopback = hostname.lower() == "localhost" or bool(
        parsed_ip is not None and parsed_ip.is_loopback
    )
    normalized_path = parsed.path.rstrip("/")
    path_segments = [segment for segment in normalized_path.split("/") if segment]
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed_port == 0
        or not hostname_is_valid
        or (parsed.scheme == "http" and not is_loopback)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or candidate != raw_value
        or re.fullmatch(r"(?:/[A-Za-z0-9._~-]+)*/?", parsed.path) is None
        or any(segment in {".", ".."} for segment in path_segments)
    ):
        raise RuntimeError(
            f"Invalid {env_name}: expected a secure HTTP(S) base URL with an optional safe path prefix"
        )

    return f"{parsed.scheme}://{parsed.netloc}{normalized_path}"


def _normalize_public_api_origin(value: str) -> str:
    """Validate the trusted public API base URL used in returned links."""
    return _normalize_deployment_http_base_url(value, ENV_PUBLIC_API_ORIGIN)


def _normalize_public_api_relative_path(path: str) -> str:
    """Accept one unambiguous, absolute-path API route without an authority."""
    if not isinstance(path, str):
        raise ValueError("Expected a relative API path")
    parsed = urlsplit(path)
    if (
        not path.startswith("/")
        or path.startswith("//")
        or parsed.scheme
        or parsed.netloc
        or parsed.query
        or parsed.fragment
        or "//" in parsed.path
    ):
        raise ValueError("Expected a relative API path")

    segments = parsed.path.split("/")[1:]
    for segment in segments:
        decoded = unquote(segment)
        if (
            not segment
            or re.fullmatch(r"[A-Za-z0-9._~%\-]+", segment) is None
            or re.search(r"%(?![0-9A-Fa-f]{2})", segment) is not None
            or decoded in {".", ".."}
            or "/" in decoded
            or "\\" in decoded
        ):
            raise ValueError("Expected a relative API path")
    return parsed.path


def build_public_api_url(public_api_origin: str, path: str) -> str:
    """Join a trusted public API base URL with a route without losing its mount.

    If an application is externally mounted at ``/api``, callers that already
    name a ``/api/...`` route retain exactly one such boundary. Other routes
    (including Agent routes) are appended below the configured mount.
    """
    normalized_base = _normalize_public_api_origin(public_api_origin)
    normalized_path = _normalize_public_api_relative_path(path)
    parsed_base = urlsplit(normalized_base)
    base_path = parsed_base.path
    if base_path and (
        normalized_path == base_path
        or normalized_path.startswith(f"{base_path}/")
    ):
        combined_path = normalized_path
    elif base_path.endswith("/api") and (
        normalized_path == "/api"
        or normalized_path.startswith("/api/")
    ):
        # A gateway mount can already end at the application's /api boundary,
        # for example ``/gateway/api``. Remove exactly that adjacent duplicate
        # while retaining every segment before it; Agent and export routes do
        # not begin with /api and therefore remain simple append operations.
        combined_path = f"{base_path}{normalized_path[len('/api') :]}"
    else:
        combined_path = f"{base_path}{normalized_path}"
    return f"{parsed_base.scheme}://{parsed_base.netloc}{combined_path}"


def _require_exact_https_origin(value: str, env_name: str) -> str:
    """Accept only a CSP-safe HTTPS origin, never a URL with path or credentials."""
    raw_value = value or ""
    candidate = raw_value.strip()
    try:
        parsed = urlsplit(candidate)
        # Accessing port also rejects malformed or out-of-range ports.
        parsed_port = parsed.port
    except ValueError as exc:
        raise RuntimeError(f"Invalid {env_name}: expected an exact HTTPS origin") from exc

    expected = f"https://{parsed.netloc}"
    canonical_candidate = candidate[:-1] if candidate.endswith("/") else candidate
    hostname_labels = parsed.hostname.split(".") if parsed.hostname else []
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed_port == 0
        or re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname) is None
        or any(
            not label or label.startswith("-") or label.endswith("-")
            for label in hostname_labels
        )
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or candidate != raw_value
        or canonical_candidate != expected
    ):
        raise RuntimeError(f"Invalid {env_name}: expected an exact HTTPS origin")
    return expected


def _derive_logto_endpoint(logto_issuer: str) -> str:
    issuer_suffix = "/oidc"
    if not logto_issuer.endswith(issuer_suffix):
        raise RuntimeError(
            f"Invalid {ENV_LOGTO_ISSUER}: expected a Logto issuer ending in {issuer_suffix}"
        )
    endpoint = logto_issuer[: -len(issuer_suffix)]
    return _require_exact_https_origin(endpoint, ENV_LOGTO_ISSUER)


def validate_logto_app_id(value: str, env_name: str) -> str:
    """Accept the public Logto SPA identifier format shared by both services."""
    if (
        not isinstance(value, str)
        or value != value.strip()
        or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None
    ):
        raise RuntimeError(
            f"Invalid {env_name}: expected a non-empty Logto app ID containing only letters, numbers, hyphens, or underscores"
        )
    return value


def validate_frontend_auth_config(
    *,
    logto_issuer: str,
    logto_app_id: str,
    frontend_origin: str,
    cors_allow_origins: List[str],
    frontend_logto_endpoint: Optional[str],
    frontend_logto_app_id: Optional[str],
    frontend_logto_redirect_uri: Optional[str],
    require_explicit: bool,
) -> None:
    """Fail closed when the separately deployed browser auth config drifts.

    The mirrored values are public Logto SPA configuration, never a client
    secret. Remote deployments must provide them explicitly; strict loopback
    development can derive them from the backend values for local ergonomics.
    """
    expected_endpoint = _derive_logto_endpoint(logto_issuer)
    validate_logto_app_id(logto_app_id, ENV_LOGTO_APP_ID)
    if urlsplit(frontend_origin).path:
        raise RuntimeError(
            f"Invalid {ENV_FRONTEND_ORIGIN}: expected an exact origin for frontend auth"
        )
    expected_redirect_uri = f"{frontend_origin}/callback"

    if require_explicit and not frontend_logto_endpoint:
        raise RuntimeError(f"Missing required environment variable: {ENV_FRONTEND_LOGTO_ENDPOINT}")
    if require_explicit and not frontend_logto_app_id:
        raise RuntimeError(f"Missing required environment variable: {ENV_FRONTEND_LOGTO_APP_ID}")
    if require_explicit and not frontend_logto_redirect_uri:
        raise RuntimeError(f"Missing required environment variable: {ENV_FRONTEND_LOGTO_REDIRECT_URI}")

    configured_endpoint = frontend_logto_endpoint or expected_endpoint
    configured_app_id = frontend_logto_app_id or logto_app_id
    configured_redirect_uri = frontend_logto_redirect_uri or expected_redirect_uri

    _require_exact_https_origin(configured_endpoint, ENV_FRONTEND_LOGTO_ENDPOINT)
    validate_logto_app_id(configured_app_id, ENV_FRONTEND_LOGTO_APP_ID)
    if configured_endpoint != expected_endpoint:
        raise RuntimeError(
            f"Invalid {ENV_FRONTEND_LOGTO_ENDPOINT}: must match {ENV_LOGTO_ISSUER} without /oidc"
        )
    if configured_app_id != logto_app_id:
        raise RuntimeError(
            f"Invalid {ENV_FRONTEND_LOGTO_APP_ID}: must match {ENV_LOGTO_APP_ID}"
        )
    if configured_redirect_uri != expected_redirect_uri:
        raise RuntimeError(
            f"Invalid {ENV_FRONTEND_LOGTO_REDIRECT_URI}: must exactly equal {ENV_FRONTEND_ORIGIN}/callback"
        )
    if frontend_origin not in cors_allow_origins:
        raise RuntimeError(
            f"Invalid {ENV_CORS_ALLOW_ORIGINS}: must include {ENV_FRONTEND_ORIGIN}"
        )


def _resolve_yifut_base_url(value: str, *, enabled: bool) -> str:
    """Keep disabled deployments bootable without weakening enabled checkout.

    A stale or placeholder provider URL is irrelevant while payments are
    disabled. Enabled deployments must still fail closed before they can sign
    or submit a checkout to an unsafe destination.
    """
    if enabled:
        return _require_exact_https_origin(value, ENV_YIFUT_BASE_URL)
    try:
        return _require_exact_https_origin(value, ENV_YIFUT_BASE_URL)
    except RuntimeError:
        return DEFAULT_YIFUT_BASE_URL


def _resolve_frontend_origin(cors_allow_origins: List[str]) -> str:
    value = os.getenv(ENV_FRONTEND_ORIGIN)
    if value:
        return _normalize_origin(value)

    for origin in cors_allow_origins:
        if origin and origin != "*":
            return _normalize_origin(origin)

    return DEFAULT_FRONTEND_ORIGIN


def _resolve_export_token_secret(
    database_url: str,
    logto_issuer: str,
    logto_app_id: str,
) -> str:
    configured_secret = os.getenv(ENV_EXPORT_TOKEN_SECRET)
    if configured_secret:
        return configured_secret

    seed = "|".join([database_url, logto_issuer, logto_app_id])
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Settings:
    database_url: str
    logto_issuer: str
    logto_app_id: str
    jwks_url: str
    jwks_ttl_seconds: int
    ai_api_key: Optional[str]
    ai_base_url: str
    ai_responses_base_url: str
    ai_model: str
    ai_route_profile: str
    ai_fast_api_key: Optional[str]
    ai_fast_base_url: str
    ai_fast_model: str
    ai_dedupe_enabled: bool
    ai_dedupe_model: str
    ai_dedupe_max_candidates: int
    ai_timeout_seconds: int
    ai_max_request_body_bytes: int
    ai_max_text_field_chars: int
    ai_stream_max_event_bytes: int
    ai_stream_max_total_bytes: int
    ai_stream_max_events: int
    ai_assistant_buffer_max_chars: int
    ai_stream_total_timeout_seconds: int
    ai_stream_queue_max_events: int
    ai_max_output_tokens: int
    gemini_api_key: Optional[str]
    gemini_base_url: str
    gemini_model: str
    ai_thinking_budget_jd_analysis: int
    ai_thinking_budget_polish: int
    ai_thinking_budget_boss_greeting: int
    enable_dev_auth_bypass: bool
    enable_resume_optimization: bool
    resume_optimization_max_questions: int
    resume_optimization_max_bank_suggestions: int
    dev_user_id: str
    cors_allow_origins: List[str]
    feishu_webhook_url: Optional[str]
    feishu_app_id: Optional[str]
    feishu_app_secret: Optional[str]
    frontend_origin: str
    public_api_origin: str
    export_snapshot_ttl_seconds: int
    export_token_secret: str
    export_render_timeout_seconds: int
    redemption_code_encryption_key: Optional[str]
    yifut_enabled: bool
    yifut_test_user_ids: List[str]
    yifut_merchant_id: Optional[str]
    yifut_merchant_private_key: Optional[str]
    yifut_platform_public_key: Optional[str]
    yifut_base_url: str


_settings: Optional[Settings] = None


def load_settings() -> Settings:
    global _settings
    if _settings is not None:
        return _settings

    _load_env()
    deployment_mode = _resolve_deployment_mode(
        os.getenv(ENV_RESUMEFLOW_DEPLOYMENT_MODE)
    )
    database_url = _normalize_database_url(_require_env(ENV_DATABASE_URL))
    logto_issuer = _normalize_issuer(_require_env(ENV_LOGTO_ISSUER))
    logto_app_id = validate_logto_app_id(
        _require_env(ENV_LOGTO_APP_ID),
        ENV_LOGTO_APP_ID,
    )
    jwks_url = f"{logto_issuer}{DEFAULT_JWKS_PATH}"
    jwks_ttl_seconds = int(os.getenv(ENV_LOGTO_JWKS_TTL, DEFAULT_JWKS_TTL_SECONDS))
    ai_route_profile = _resolve_ai_route_profile(os.getenv(ENV_AI_ROUTE_PROFILE))
    ai_api_key = _configured_env_value(os.getenv(ENV_AI_API_KEY))
    gemini_api_key = _configured_env_value(os.getenv(ENV_GEMINI_API_KEY))
    gemini_base_url = os.getenv(ENV_GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL)
    configured_gemini_model = os.getenv(ENV_GEMINI_MODEL)
    gemini_model = (
        configured_gemini_model
        if configured_gemini_model is not None
        else DEFAULT_GEMINI_MODEL
    )
    gemini_lane_active = ai_route_profile == "gemini_primary" or (
        ai_route_profile == "hybrid_gemini_aifast" and bool(gemini_api_key)
    )
    if gemini_lane_active:
        gemini_model = validate_gemini_model(gemini_model)

    configured_ai_fast_model = os.getenv(ENV_AI_FAST_MODEL)
    ai_model = _resolve_ai_model_for_profile(
        os.getenv(ENV_AI_MODEL),
        route_profile=ai_route_profile,
        gemini_model=gemini_model,
        gemini_api_key=gemini_api_key,
        fast_model=configured_ai_fast_model,
    )
    configured_ai_base_url = os.getenv(ENV_AI_BASE_URL)
    ai_base_url = configured_ai_base_url or DEFAULT_AI_BASE_URL
    configured_ai_fast_api_key = os.getenv(ENV_AI_FAST_API_KEY)
    configured_ai_fast_base_url = os.getenv(ENV_AI_FAST_BASE_URL)
    has_independent_fast_lane = bool(
        _configured_env_value(configured_ai_fast_api_key)
        and _configured_env_value(configured_ai_fast_base_url)
    )
    primary_base_active = ai_route_profile in {
        "openai_primary",
        "qwen_primary",
    } or (
        ai_route_profile == "hybrid_gemini_aifast"
        and (not gemini_api_key or not has_independent_fast_lane)
    )
    if deployment_mode == "production":
        if gemini_lane_active:
            gemini_base_url = _normalize_deployment_http_base_url(
                gemini_base_url,
                ENV_GEMINI_BASE_URL,
            )
        if primary_base_active:
            ai_base_url = _normalize_deployment_http_base_url(
                ai_base_url,
                ENV_AI_BASE_URL,
            )
        if ai_route_profile != "gemini_primary" and has_independent_fast_lane:
            configured_ai_fast_base_url = _normalize_deployment_http_base_url(
                configured_ai_fast_base_url or "",
                ENV_AI_FAST_BASE_URL,
            )
    ai_responses_base_url = _resolve_ai_responses_base_url(ai_base_url)
    if (
        deployment_mode == "production"
        and ai_route_profile in {"openai_primary", "qwen_primary"}
    ):
        ai_responses_base_url = _normalize_deployment_http_base_url(
            ai_responses_base_url,
            ENV_AI_RESPONSES_BASE_URL,
        )
    if ai_route_profile == "openai_primary":
        validate_openai_primary_provider_urls(
            ai_base_url=ai_base_url,
            ai_responses_base_url=ai_responses_base_url,
            ai_base_url_is_explicit=bool(
                configured_ai_base_url and configured_ai_base_url.strip()
            ),
        )
        validate_openai_responses_streaming_model(
            model=ai_model,
            responses_base_url=ai_responses_base_url,
        )
    if ai_route_profile in {"openai_primary", "qwen_primary"}:
        validate_ai_responses_base_url_origin(
            ai_base_url=ai_base_url,
            ai_responses_base_url=ai_responses_base_url,
        )
    if ai_route_profile == "gemini_primary":
        ai_fast_api_key = _configured_env_value(configured_ai_fast_api_key) or ai_api_key
        ai_fast_base_url = configured_ai_fast_base_url or ai_base_url
    else:
        ai_fast_api_key, ai_fast_base_url = resolve_ai_fast_lane_credentials(
            ai_api_key=ai_api_key,
            ai_base_url=ai_base_url,
            configured_fast_api_key=configured_ai_fast_api_key,
            configured_fast_base_url=configured_ai_fast_base_url,
        )
    validate_production_ai_lane_credentials(
        deployment_mode=deployment_mode,
        route_profile=ai_route_profile,
        ai_api_key=ai_api_key,
        gemini_api_key=gemini_api_key,
        ai_fast_api_key=ai_fast_api_key,
    )
    ai_fast_model = _validate_compatible_lane_model(
        (
            gemini_model
            if ai_route_profile == "gemini_primary"
            else configured_ai_fast_model
            if configured_ai_fast_model and configured_ai_fast_model.strip()
            else ai_model
        ),
        env_name=ENV_AI_FAST_MODEL,
        route_profile=ai_route_profile,
    )
    ai_dedupe_enabled = _get_bool_env(ENV_AI_DEDUPE_ENABLED, True)
    configured_ai_dedupe_model = os.getenv(ENV_AI_DEDUPE_MODEL)
    ai_dedupe_model = _validate_compatible_lane_model(
        (
            gemini_model
            if ai_route_profile == "gemini_primary"
            else configured_ai_dedupe_model
            if configured_ai_dedupe_model and configured_ai_dedupe_model.strip()
            else ai_fast_model or ai_model
        ),
        env_name=ENV_AI_DEDUPE_MODEL,
        route_profile=ai_route_profile,
    )
    ai_dedupe_max_candidates = int(
        os.getenv(ENV_AI_DEDUPE_MAX_CANDIDATES, DEFAULT_AI_DEDUPE_MAX_CANDIDATES)
    )
    ai_timeout_seconds = int(os.getenv(ENV_AI_TIMEOUT_SECONDS, DEFAULT_AI_TIMEOUT_SECONDS))
    ai_max_request_body_bytes = _get_bounded_int_env(
        ENV_AI_MAX_REQUEST_BODY_BYTES,
        DEFAULT_AI_MAX_REQUEST_BODY_BYTES,
        minimum=1024,
        maximum=64 * 1024 * 1024,
    )
    ai_max_text_field_chars = _get_bounded_int_env(
        ENV_AI_MAX_TEXT_FIELD_CHARS,
        DEFAULT_AI_MAX_TEXT_FIELD_CHARS,
        minimum=1000,
        maximum=2_000_000,
    )
    ai_stream_max_event_bytes = _get_bounded_int_env(
        ENV_AI_STREAM_MAX_EVENT_BYTES,
        DEFAULT_AI_STREAM_MAX_EVENT_BYTES,
        minimum=1024,
        maximum=4 * 1024 * 1024,
    )
    ai_stream_max_total_bytes = _get_bounded_int_env(
        ENV_AI_STREAM_MAX_TOTAL_BYTES,
        DEFAULT_AI_STREAM_MAX_TOTAL_BYTES,
        minimum=64 * 1024,
        maximum=64 * 1024 * 1024,
    )
    ai_stream_max_events = _get_bounded_int_env(
        ENV_AI_STREAM_MAX_EVENTS,
        DEFAULT_AI_STREAM_MAX_EVENTS,
        minimum=100,
        maximum=100_000,
    )
    ai_assistant_buffer_max_chars = _get_bounded_int_env(
        ENV_AI_ASSISTANT_BUFFER_MAX_CHARS,
        DEFAULT_AI_ASSISTANT_BUFFER_MAX_CHARS,
        minimum=16 * 1024,
        maximum=16 * 1024 * 1024,
    )
    ai_stream_total_timeout_seconds = _get_bounded_int_env(
        ENV_AI_STREAM_TOTAL_TIMEOUT_SECONDS,
        DEFAULT_AI_STREAM_TOTAL_TIMEOUT_SECONDS,
        minimum=10,
        maximum=1800,
    )
    ai_stream_queue_max_events = _get_bounded_int_env(
        ENV_AI_STREAM_QUEUE_MAX_EVENTS,
        DEFAULT_AI_STREAM_QUEUE_MAX_EVENTS,
        minimum=1,
        maximum=1024,
    )
    ai_max_output_tokens = _get_bounded_int_env(
        ENV_AI_MAX_OUTPUT_TOKENS,
        DEFAULT_AI_MAX_OUTPUT_TOKENS,
        minimum=256,
        maximum=65_536,
    )
    ai_thinking_budget_jd_analysis = int(
        os.getenv(
            ENV_AI_THINKING_BUDGET_JD_ANALYSIS,
            DEFAULT_AI_THINKING_BUDGET_JD_ANALYSIS,
        )
    )
    ai_thinking_budget_polish = int(
        os.getenv(
            ENV_AI_THINKING_BUDGET_POLISH,
            DEFAULT_AI_THINKING_BUDGET_POLISH,
        )
    )
    ai_thinking_budget_boss_greeting = int(
        os.getenv(
            ENV_AI_THINKING_BUDGET_BOSS_GREETING,
            DEFAULT_AI_THINKING_BUDGET_BOSS_GREETING,
        )
    )
    enable_dev_auth_bypass = _get_bool_env(ENV_ENABLE_DEV_AUTH_BYPASS, False)
    if deployment_mode == "production" and enable_dev_auth_bypass:
        raise RuntimeError(
            f"Invalid {ENV_ENABLE_DEV_AUTH_BYPASS}: must be disabled in production"
        )
    enable_resume_optimization = _get_bool_env(
        ENV_ENABLE_RESUME_OPTIMIZATION,
        DEFAULT_ENABLE_RESUME_OPTIMIZATION,
    )
    resume_optimization_max_questions = _get_bounded_int_env(
        ENV_RESUME_OPTIMIZATION_MAX_QUESTIONS,
        DEFAULT_RESUME_OPTIMIZATION_MAX_QUESTIONS,
        minimum=0,
        maximum=5,
    )
    resume_optimization_max_bank_suggestions = _get_bounded_int_env(
        ENV_RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS,
        DEFAULT_RESUME_OPTIMIZATION_MAX_BANK_SUGGESTIONS,
        minimum=0,
        maximum=3,
    )
    dev_user_id = os.getenv(ENV_DEV_USER_ID, DEFAULT_DEV_USER_ID)
    cors_allow_origins = _parse_csv_env(
        ENV_CORS_ALLOW_ORIGINS,
        DEFAULT_CORS_ALLOW_ORIGINS,
    )
    feishu_webhook_url = os.getenv(ENV_FEISHU_WEBHOOK_URL)
    feishu_app_id = os.getenv(ENV_FEISHU_APP_ID)
    feishu_app_secret = os.getenv(ENV_FEISHU_APP_SECRET)
    if deployment_mode == "production":
        _require_env(ENV_FRONTEND_ORIGIN)
        _require_env(ENV_CORS_ALLOW_ORIGINS)
    frontend_origin = _resolve_frontend_origin(cors_allow_origins)
    validate_frontend_auth_config(
        logto_issuer=logto_issuer,
        logto_app_id=logto_app_id,
        frontend_origin=frontend_origin,
        cors_allow_origins=cors_allow_origins,
        frontend_logto_endpoint=os.getenv(ENV_FRONTEND_LOGTO_ENDPOINT),
        frontend_logto_app_id=os.getenv(ENV_FRONTEND_LOGTO_APP_ID),
        frontend_logto_redirect_uri=os.getenv(ENV_FRONTEND_LOGTO_REDIRECT_URI),
        require_explicit=deployment_mode == "production",
    )
    public_api_origin = _normalize_public_api_origin(
        os.getenv(ENV_PUBLIC_API_ORIGIN, DEFAULT_PUBLIC_API_ORIGIN)
    )
    export_snapshot_ttl_seconds = _get_bounded_int_env(
        ENV_EXPORT_SNAPSHOT_TTL_SECONDS,
        DEFAULT_EXPORT_SNAPSHOT_TTL_SECONDS,
        minimum=MIN_EXPORT_SNAPSHOT_TTL_SECONDS,
        maximum=MAX_EXPORT_SNAPSHOT_TTL_SECONDS,
    )
    export_token_secret = _resolve_export_token_secret(
        database_url,
        logto_issuer,
        logto_app_id,
    )
    export_render_timeout_seconds = _get_bounded_int_env(
        ENV_EXPORT_RENDER_TIMEOUT_SECONDS,
        DEFAULT_EXPORT_RENDER_TIMEOUT_SECONDS,
        minimum=MIN_EXPORT_RENDER_TIMEOUT_SECONDS,
        maximum=MAX_EXPORT_RENDER_TIMEOUT_SECONDS,
    )
    redemption_code_encryption_key = os.getenv(ENV_REDEMPTION_CODE_ENCRYPTION_KEY)
    yifut_enabled = _get_bool_env(ENV_YIFUT_ENABLED, False)
    yifut_test_user_ids = _parse_csv_env(ENV_YIFUT_TEST_USER_IDS, [])
    raw_yifut_merchant_id = os.getenv(ENV_YIFUT_MERCHANT_ID)
    yifut_merchant_id = raw_yifut_merchant_id.strip() if raw_yifut_merchant_id else None
    yifut_merchant_private_key = os.getenv(ENV_YIFUT_MERCHANT_PRIVATE_KEY)
    yifut_platform_public_key = os.getenv(ENV_YIFUT_PLATFORM_PUBLIC_KEY)
    yifut_base_url = _resolve_yifut_base_url(
        os.getenv(ENV_YIFUT_BASE_URL, DEFAULT_YIFUT_BASE_URL),
        enabled=yifut_enabled,
    )

    _settings = Settings(
        database_url=database_url,
        logto_issuer=logto_issuer,
        logto_app_id=logto_app_id,
        jwks_url=jwks_url,
        jwks_ttl_seconds=jwks_ttl_seconds,
        ai_api_key=ai_api_key,
        ai_base_url=ai_base_url,
        ai_responses_base_url=ai_responses_base_url,
        ai_model=ai_model,
        ai_route_profile=ai_route_profile,
        ai_fast_api_key=ai_fast_api_key,
        ai_fast_base_url=ai_fast_base_url,
        ai_fast_model=ai_fast_model,
        ai_dedupe_enabled=ai_dedupe_enabled,
        ai_dedupe_model=ai_dedupe_model,
        ai_dedupe_max_candidates=ai_dedupe_max_candidates,
        ai_timeout_seconds=ai_timeout_seconds,
        ai_max_request_body_bytes=ai_max_request_body_bytes,
        ai_max_text_field_chars=ai_max_text_field_chars,
        ai_stream_max_event_bytes=ai_stream_max_event_bytes,
        ai_stream_max_total_bytes=ai_stream_max_total_bytes,
        ai_stream_max_events=ai_stream_max_events,
        ai_assistant_buffer_max_chars=ai_assistant_buffer_max_chars,
        ai_stream_total_timeout_seconds=ai_stream_total_timeout_seconds,
        ai_stream_queue_max_events=ai_stream_queue_max_events,
        ai_max_output_tokens=ai_max_output_tokens,
        gemini_api_key=gemini_api_key,
        gemini_base_url=gemini_base_url,
        gemini_model=gemini_model,
        ai_thinking_budget_jd_analysis=ai_thinking_budget_jd_analysis,
        ai_thinking_budget_polish=ai_thinking_budget_polish,
        ai_thinking_budget_boss_greeting=ai_thinking_budget_boss_greeting,
        enable_dev_auth_bypass=enable_dev_auth_bypass,
        enable_resume_optimization=enable_resume_optimization,
        resume_optimization_max_questions=resume_optimization_max_questions,
        resume_optimization_max_bank_suggestions=resume_optimization_max_bank_suggestions,
        dev_user_id=dev_user_id,
        cors_allow_origins=cors_allow_origins,
        feishu_webhook_url=feishu_webhook_url,
        feishu_app_id=feishu_app_id,
        feishu_app_secret=feishu_app_secret,
        frontend_origin=frontend_origin,
        public_api_origin=public_api_origin,
        export_snapshot_ttl_seconds=export_snapshot_ttl_seconds,
        export_token_secret=export_token_secret,
        export_render_timeout_seconds=export_render_timeout_seconds,
        redemption_code_encryption_key=redemption_code_encryption_key,
        yifut_enabled=yifut_enabled,
        yifut_test_user_ids=yifut_test_user_ids,
        yifut_merchant_id=yifut_merchant_id,
        yifut_merchant_private_key=yifut_merchant_private_key,
        yifut_platform_public_key=yifut_platform_public_key,
        yifut_base_url=yifut_base_url,
    )
    return _settings

