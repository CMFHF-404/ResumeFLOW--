from dataclasses import dataclass
import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

DEFAULT_JWKS_PATH = "/jwks"
ENV_DATABASE_URL = "DATABASE_URL"
ENV_LOGTO_ISSUER = "LOGTO_ISSUER"
ENV_LOGTO_AUDIENCE = "LOGTO_AUDIENCE"
ENV_LOGTO_JWKS_TTL = "LOGTO_JWKS_TTL_SECONDS"
ENV_AI_API_KEY = "AI_API_KEY"
ENV_AI_BASE_URL = "AI_BASE_URL"
ENV_AI_MODEL = "AI_MODEL"
ENV_AI_TIMEOUT_SECONDS = "AI_TIMEOUT_SECONDS"
ENV_GEMINI_API_KEY = "GEMINI_API_KEY"
ENV_GEMINI_BASE_URL = "GEMINI_BASE_URL"
ENV_GEMINI_MODEL = "GEMINI_MODEL"
ENV_ENABLE_DEV_AUTH_BYPASS = "ENABLE_DEV_AUTH_BYPASS"
ENV_DEV_USER_ID = "DEV_USER_ID"
ENV_CORS_ALLOW_ORIGINS = "CORS_ALLOW_ORIGINS"
ENV_FEISHU_WEBHOOK_URL = "FEISHU_WEBHOOK_URL"
DEFAULT_JWKS_TTL_SECONDS = 3600
DEFAULT_AI_BASE_URL = "https://api.packyapi.com/v1"
DEFAULT_AI_MODEL = "gemini-3-flash"
DEFAULT_AI_TIMEOUT_SECONDS = 300
DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_DEV_USER_ID = "dev-user-test-123"
DEFAULT_CORS_ALLOW_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]
ENV_FILE_NAME = ".env"


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


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


@dataclass(frozen=True)
class Settings:
    database_url: str
    logto_issuer: str
    logto_audience: str
    jwks_url: str
    jwks_ttl_seconds: int
    ai_api_key: Optional[str]
    ai_base_url: str
    ai_model: str
    ai_timeout_seconds: int
    gemini_api_key: Optional[str]
    gemini_base_url: str
    gemini_model: str
    enable_dev_auth_bypass: bool
    dev_user_id: str
    cors_allow_origins: List[str]
    feishu_webhook_url: Optional[str]


_settings: Optional[Settings] = None


def load_settings() -> Settings:
    global _settings
    if _settings is not None:
        return _settings

    _load_env()
    database_url = _require_env(ENV_DATABASE_URL)
    logto_issuer = _normalize_issuer(_require_env(ENV_LOGTO_ISSUER))
    logto_audience = _require_env(ENV_LOGTO_AUDIENCE)
    jwks_url = f"{logto_issuer}{DEFAULT_JWKS_PATH}"
    jwks_ttl_seconds = int(os.getenv(ENV_LOGTO_JWKS_TTL, DEFAULT_JWKS_TTL_SECONDS))
    ai_api_key = os.getenv(ENV_AI_API_KEY)
    ai_base_url = os.getenv(ENV_AI_BASE_URL, DEFAULT_AI_BASE_URL)
    ai_model = os.getenv(ENV_AI_MODEL, DEFAULT_AI_MODEL)
    ai_timeout_seconds = int(os.getenv(ENV_AI_TIMEOUT_SECONDS, DEFAULT_AI_TIMEOUT_SECONDS))
    gemini_api_key = os.getenv(ENV_GEMINI_API_KEY)
    gemini_base_url = os.getenv(ENV_GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL)
    gemini_model = os.getenv(ENV_GEMINI_MODEL, DEFAULT_GEMINI_MODEL)
    enable_dev_auth_bypass = _get_bool_env(ENV_ENABLE_DEV_AUTH_BYPASS, False)
    dev_user_id = os.getenv(ENV_DEV_USER_ID, DEFAULT_DEV_USER_ID)
    cors_allow_origins = _parse_csv_env(
        ENV_CORS_ALLOW_ORIGINS,
        DEFAULT_CORS_ALLOW_ORIGINS,
    )
    feishu_webhook_url = os.getenv(ENV_FEISHU_WEBHOOK_URL)

    _settings = Settings(
        database_url=database_url,
        logto_issuer=logto_issuer,
        logto_audience=logto_audience,
        jwks_url=jwks_url,
        jwks_ttl_seconds=jwks_ttl_seconds,
        ai_api_key=ai_api_key,
        ai_base_url=ai_base_url,
        ai_model=ai_model,
        ai_timeout_seconds=ai_timeout_seconds,
        gemini_api_key=gemini_api_key,
        gemini_base_url=gemini_base_url,
        gemini_model=gemini_model,
        enable_dev_auth_bypass=enable_dev_auth_bypass,
        dev_user_id=dev_user_id,
        cors_allow_origins=cors_allow_origins,
        feishu_webhook_url=feishu_webhook_url,
    )
    return _settings

