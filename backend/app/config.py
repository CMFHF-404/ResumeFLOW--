from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
from typing import List, Optional

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
ENV_AI_FAST_MODEL = "AI_FAST_MODEL"
ENV_AI_DEDUPE_ENABLED = "AI_DEDUPE_ENABLED"
ENV_AI_DEDUPE_MODEL = "AI_DEDUPE_MODEL"
ENV_AI_DEDUPE_MAX_CANDIDATES = "AI_DEDUPE_MAX_CANDIDATES"
ENV_AI_TIMEOUT_SECONDS = "AI_TIMEOUT_SECONDS"
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
ENV_EXPORT_SNAPSHOT_TTL_SECONDS = "EXPORT_SNAPSHOT_TTL_SECONDS"
ENV_EXPORT_TOKEN_SECRET = "EXPORT_TOKEN_SECRET"
ENV_EXPORT_RENDER_TIMEOUT_SECONDS = "EXPORT_RENDER_TIMEOUT_SECONDS"
DEFAULT_JWKS_TTL_SECONDS = 3600
DEFAULT_AI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_AI_MODEL = "qwen3.7-plus"
DEFAULT_AI_TIMEOUT_SECONDS = 300
DEFAULT_AI_DEDUPE_MAX_CANDIDATES = 24
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_AI_THINKING_BUDGET_JD_ANALYSIS = 4096
DEFAULT_AI_THINKING_BUDGET_POLISH = 1024
DEFAULT_AI_THINKING_BUDGET_BOSS_GREETING = 0
DEFAULT_DEV_USER_ID = "dev-user-test-123"
DEFAULT_CORS_ALLOW_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]
DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"
DEFAULT_EXPORT_SNAPSHOT_TTL_SECONDS = 300
DEFAULT_EXPORT_RENDER_TIMEOUT_SECONDS = 45
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


def _resolve_ai_responses_base_url(ai_base_url: str) -> str:
    configured = os.getenv(ENV_AI_RESPONSES_BASE_URL)
    if configured:
        return configured.rstrip("/")

    normalized = ai_base_url.rstrip("/")
    responses_suffix = "/api/v2/apps/protocols/compatible-mode/v1"
    if normalized.endswith(responses_suffix):
        return normalized

    chat_suffix = "/compatible-mode/v1"
    if normalized.endswith(chat_suffix):
        return f"{normalized[: -len(chat_suffix)]}{responses_suffix}"

    return normalized


def _normalize_issuer(issuer: str) -> str:
    return issuer.rstrip("/")

def _get_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

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
    return value.rstrip("/")


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
    ai_fast_model: str
    ai_dedupe_enabled: bool
    ai_dedupe_model: str
    ai_dedupe_max_candidates: int
    ai_timeout_seconds: int
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
    export_snapshot_ttl_seconds: int
    export_token_secret: str
    export_render_timeout_seconds: int


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
    ai_fast_model = os.getenv(ENV_AI_FAST_MODEL) or ai_model
    ai_dedupe_enabled = _get_bool_env(ENV_AI_DEDUPE_ENABLED, True)
    ai_dedupe_model = os.getenv(ENV_AI_DEDUPE_MODEL) or ai_fast_model or ai_model
    ai_dedupe_max_candidates = int(
        os.getenv(ENV_AI_DEDUPE_MAX_CANDIDATES, DEFAULT_AI_DEDUPE_MAX_CANDIDATES)
    )
    ai_timeout_seconds = int(os.getenv(ENV_AI_TIMEOUT_SECONDS, DEFAULT_AI_TIMEOUT_SECONDS))
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
    export_snapshot_ttl_seconds = int(
        os.getenv(ENV_EXPORT_SNAPSHOT_TTL_SECONDS, DEFAULT_EXPORT_SNAPSHOT_TTL_SECONDS)
    )
    export_token_secret = _resolve_export_token_secret(
        database_url,
        logto_issuer,
        logto_app_id,
    )
    export_render_timeout_seconds = int(
        os.getenv(ENV_EXPORT_RENDER_TIMEOUT_SECONDS, DEFAULT_EXPORT_RENDER_TIMEOUT_SECONDS)
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
        ai_fast_model=ai_fast_model,
        ai_dedupe_enabled=ai_dedupe_enabled,
        ai_dedupe_model=ai_dedupe_model,
        ai_dedupe_max_candidates=ai_dedupe_max_candidates,
        ai_timeout_seconds=ai_timeout_seconds,
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
        export_snapshot_ttl_seconds=export_snapshot_ttl_seconds,
        export_token_secret=export_token_secret,
        export_render_timeout_seconds=export_render_timeout_seconds,
    )
    return _settings

