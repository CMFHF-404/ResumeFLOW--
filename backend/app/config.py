from dataclasses import dataclass
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

DEFAULT_JWKS_PATH = "/oidc/jwks"
ENV_DATABASE_URL = "DATABASE_URL"
ENV_LOGTO_ISSUER = "LOGTO_ISSUER"
ENV_LOGTO_AUDIENCE = "LOGTO_AUDIENCE"
ENV_LOGTO_JWKS_TTL = "LOGTO_JWKS_TTL_SECONDS"
DEFAULT_JWKS_TTL_SECONDS = 3600
ENV_FILE_NAME = ".env"


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _normalize_issuer(issuer: str) -> str:
    return issuer.rstrip("/")


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

    _settings = Settings(
        database_url=database_url,
        logto_issuer=logto_issuer,
        logto_audience=logto_audience,
        jwks_url=jwks_url,
        jwks_ttl_seconds=jwks_ttl_seconds,
    )
    return _settings
