from __future__ import annotations

from typing import Any

from .agent_option_helpers import _clamp_score


def _score_entry_id(entry: Any) -> str:
    if not isinstance(entry, dict):
        return ""
    return str(entry.get("id") or "").strip()


def _score_entry_score(entry: Any) -> int:
    if not isinstance(entry, dict):
        return 0
    return _clamp_score(entry.get("score"))
