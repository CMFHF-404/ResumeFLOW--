from dataclasses import dataclass
import hashlib
import ipaddress
import os
from pathlib import Path
import re
from typing import List, Optional
from urllib.parse import unquote, urlsplit

from dotenv import load_dotenv

DEFAULT_JWKS_PATH = "/jwks"
ENV_DATABASE_URL = "DATABASE_URL"
ENV_LOGTO_ISSUER = "LOGTO_ISSUER"
ENV_LOGTO_APP_ID = "LOGTO_APP_ID"
ENV_LOGTO_JWKS_TTL = "LOGTO_JWKS_TTL_SECONDS"
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
DEFAULT_AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_AI_MODEL = "qwen3.7-plus"
DEFAULT_AI_ROUTE_PROFILE = "hybrid_gemini_aifast"
VALID_AI_ROUTE_PROFILES = {"hybrid_gemini_aifast", "gemini_primary", "qwen_primary"}
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
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_AI_THINKING_BUDGET_JD_ANALYSIS = 1024
DEFAULT_AI_THINKING_BUDGET_POLISH = 1024
DEFAULT_AI_THINKING_BUDGET_BOSS_GREETING = 0
DEFAULT_DEV_USER_ID = "dev-user-test-123"
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


def _normalize_issuer(issuer: str) -> str:
    return issuer.rstrip("/")

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
    database_url = _normalize_database_url(_require_env(ENV_DATABASE_URL))
    logto_issuer = _normalize_issuer(_require_env(ENV_LOGTO_ISSUER))
    logto_app_id = _require_env(ENV_LOGTO_APP_ID)
    jwks_url = f"{logto_issuer}{DEFAULT_JWKS_PATH}"
    jwks_ttl_seconds = int(os.getenv(ENV_LOGTO_JWKS_TTL, DEFAULT_JWKS_TTL_SECONDS))
    ai_api_key = os.getenv(ENV_AI_API_KEY)
    ai_base_url = os.getenv(ENV_AI_BASE_URL, DEFAULT_AI_BASE_URL)
    ai_responses_base_url = _resolve_ai_responses_base_url(ai_base_url)
    ai_model = os.getenv(ENV_AI_MODEL, DEFAULT_AI_MODEL)
    ai_route_profile = _resolve_ai_route_profile(os.getenv(ENV_AI_ROUTE_PROFILE))
    ai_fast_api_key = os.getenv(ENV_AI_FAST_API_KEY) or ai_api_key
    ai_fast_base_url = os.getenv(ENV_AI_FAST_BASE_URL) or ai_base_url
    ai_fast_model = os.getenv(ENV_AI_FAST_MODEL) or ai_model
    ai_dedupe_enabled = _get_bool_env(ENV_AI_DEDUPE_ENABLED, True)
    ai_dedupe_model = os.getenv(ENV_AI_DEDUPE_MODEL) or ai_fast_model or ai_model
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
    gemini_api_key = os.getenv(ENV_GEMINI_API_KEY)
    gemini_base_url = os.getenv(ENV_GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL)
    gemini_model = os.getenv(ENV_GEMINI_MODEL, DEFAULT_GEMINI_MODEL)
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
    dev_user_id = os.getenv(ENV_DEV_USER_ID, DEFAULT_DEV_USER_ID)
    cors_allow_origins = _parse_csv_env(
        ENV_CORS_ALLOW_ORIGINS,
        DEFAULT_CORS_ALLOW_ORIGINS,
    )
    feishu_webhook_url = os.getenv(ENV_FEISHU_WEBHOOK_URL)
    feishu_app_id = os.getenv(ENV_FEISHU_APP_ID)
    feishu_app_secret = os.getenv(ENV_FEISHU_APP_SECRET)
    frontend_origin = _resolve_frontend_origin(cors_allow_origins)
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

