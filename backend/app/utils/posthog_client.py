from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx

from ..config import load_settings

try:
    import posthog  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    posthog = None

DEFAULT_QUERY_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class PosthogClientConfig:
    api_key: str
    host: str
    project_id: Optional[str]


def _normalize_host(host: str) -> str:
    return host.rstrip("/")


def _load_config() -> Optional[PosthogClientConfig]:
    settings = load_settings()
    if not settings.posthog_enabled or not settings.posthog_api_key:
        return None
    return PosthogClientConfig(
        api_key=settings.posthog_api_key,
        host=_normalize_host(settings.posthog_host),
        project_id=settings.posthog_project_id,
    )


class PosthogClient:
    def __init__(self, config: PosthogClientConfig) -> None:
        self._config = config
        self._capture_ready = False

    def _ensure_capture_ready(self) -> bool:
        if posthog is None:
            return False
        if self._capture_ready:
            return True
        posthog.project_api_key = self._config.api_key
        if hasattr(posthog, "api_key"):
            posthog.api_key = self._config.api_key
        posthog.host = self._config.host
        self._capture_ready = True
        return True

    def capture_event(
        self,
        user_id: str,
        event: str,
        properties: Optional[Dict[str, Any]] = None,
    ) -> bool:
        if not self._ensure_capture_ready():
            return False
        try:
            posthog.capture(user_id, event, properties or {})
            return True
        except Exception as exc:  # pragma: no cover - network/runtime error
            print(f"[PostHog] capture failed: {exc}")
            return False

    def _build_query_url(self) -> Optional[str]:
        if not self._config.project_id:
            return None
        return f"{self._config.host}/api/projects/{self._config.project_id}/query/"

    def _build_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._config.api_key}",
            "Content-Type": "application/json",
        }

    async def query(self, payload: Dict[str, Any]) -> Optional[List[Any]]:
        url = self._build_query_url()
        if not url:
            return None
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_QUERY_TIMEOUT_SECONDS) as client:
                response = await client.post(url, json=payload, headers=self._build_headers())
                response.raise_for_status()
                data = response.json()
        except Exception as exc:  # pragma: no cover - network/runtime error
            print(f"[PostHog] query failed: {exc}")
            return None

        if isinstance(data, dict):
            if "results" in data and isinstance(data["results"], list):
                return data["results"]
            if "data" in data and isinstance(data["data"], list):
                return data["data"]
        return None


_posthog_client: Optional[PosthogClient] = None


def get_posthog_client() -> Optional[PosthogClient]:
    global _posthog_client
    if _posthog_client is not None:
        return _posthog_client
    config = _load_config()
    if not config:
        return None
    _posthog_client = PosthogClient(config)
    return _posthog_client
