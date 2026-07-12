from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Optional

from ...models import ExperienceCategory


def _as_experience_category(value: Any) -> Optional[ExperienceCategory]:
    if isinstance(value, ExperienceCategory):
        return value
    try:
        return ExperienceCategory(value)
    except (TypeError, ValueError):
        return None


def _date_to_str(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m")
    return str(value)


def _hash_agent_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _now_aware() -> datetime:
    return datetime.now(timezone.utc)
