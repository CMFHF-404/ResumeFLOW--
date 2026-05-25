from __future__ import annotations

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
