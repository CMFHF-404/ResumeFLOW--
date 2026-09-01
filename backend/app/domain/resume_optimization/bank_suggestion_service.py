"""Deterministic, read-only suggestions for unselected experience-bank items."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from .schemas import BankSuggestion


DEFAULT_BANK_SUGGESTION_LIMIT = 3
MAX_BANK_SUGGESTION_LIMIT = 3


def _value(mapping: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _non_empty_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _safe_limit(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return DEFAULT_BANK_SUGGESTION_LIMIT
    return min(MAX_BANK_SUGGESTION_LIMIT, max(0, value))


def _positive_score(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        numeric = float(value)
    except OverflowError:
        return None
    if not math.isfinite(numeric) or numeric <= 0:
        return None
    return numeric


def _display_score(raw_score: float) -> int:
    # BankSuggestion's public contract is a bounded integer score. Retain
    # eligibility for sub-integer positive scores instead of silently dropping
    # them during rounding.
    return min(100, max(1, int(round(raw_score))))


def _capability_label(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, Mapping):
        return ""
    return _non_empty_string(_value(value, "name", "label", "capability"))


def _diagnosis_capabilities(analysis_result: Mapping[str, Any]) -> dict[str, list[str]]:
    capability_analysis = _value(analysis_result, "capabilityAnalysis", "capability_analysis")
    if not isinstance(capability_analysis, Mapping):
        return {}
    diagnoses = _value(capability_analysis, "experienceDiagnoses", "experience_diagnoses")
    if not isinstance(diagnoses, list):
        return {}

    by_experience_id: dict[str, list[str]] = {}
    for diagnosis in diagnoses:
        if not isinstance(diagnosis, Mapping):
            continue
        experience_id = _non_empty_string(
            _value(diagnosis, "experienceId", "experience_id", "id")
        )
        if not experience_id or experience_id in by_experience_id:
            continue
        labels: list[str] = []
        seen: set[str] = set()
        for key in (
            "provenCapabilities",
            "proven_capabilities",
            "weakCapabilities",
            "weak_capabilities",
        ):
            raw_labels = diagnosis.get(key)
            if not isinstance(raw_labels, list):
                continue
            for raw_label in raw_labels:
                label = _capability_label(raw_label)
                if label and label not in seen:
                    labels.append(label)
                    seen.add(label)
        by_experience_id[experience_id] = labels
    return by_experience_id


def _complete_metadata(metadata: Any) -> tuple[str, str, str] | None:
    if not isinstance(metadata, Mapping):
        return None
    category = _non_empty_string(_value(metadata, "category"))
    title = _non_empty_string(_value(metadata, "title"))
    org = _non_empty_string(_value(metadata, "org", "organization"))
    if not category or not title or not org:
        return None
    return category, title, org


def build_bank_suggestions(
    *,
    analysis_result: dict[str, Any],
    selected_master_ids: set[str],
    bank_experience_metadata: dict[str, dict[str, Any]],
    limit: int = DEFAULT_BANK_SUGGESTION_LIMIT,
) -> list[BankSuggestion]:
    """Return up to three ranked, unselected experience-bank suggestions.

    This deliberately derives display-safe fields solely from frozen metadata
    and analysis output.  It does not alter selection state or expose source
    STAR/summary/tag content.
    """
    if not isinstance(analysis_result, Mapping) or not isinstance(bank_experience_metadata, Mapping):
        return []
    match_entries = _value(analysis_result, "experienceMatches", "experience_matches")
    if not isinstance(match_entries, list):
        return []

    selected = {
        normalized
        for value in selected_master_ids
        if (normalized := _non_empty_string(value))
    } if isinstance(selected_master_ids, (set, list, tuple, frozenset)) else set()
    capabilities_by_id = _diagnosis_capabilities(analysis_result)
    candidates: list[tuple[int, float, str, str, str, str, str]] = []
    seen_ids: set[str] = set()
    for index, match in enumerate(match_entries):
        if not isinstance(match, Mapping):
            continue
        master_id = _non_empty_string(_value(match, "id", "experienceId", "experience_id"))
        if not master_id or master_id in seen_ids:
            continue
        seen_ids.add(master_id)
        if master_id in selected:
            continue
        raw_score = _positive_score(
            _value(match, "score", "matchScore", "match_score")
        )
        if raw_score is None:
            continue
        resolved = _complete_metadata(bank_experience_metadata.get(master_id))
        if resolved is None:
            continue
        category, title, org = resolved
        reason = _non_empty_string(_value(match, "reason", "matchReason", "match_reason"))
        if not reason:
            continue
        candidates.append((index, raw_score, master_id, reason, category, title, org))

    candidates.sort(key=lambda item: (-item[1], item[0]))
    safe_limit = _safe_limit(limit)
    return [
        BankSuggestion(
            suggestion_id=f"BANK_{position:03d}",
            master_experience_id=master_id,
            category=category,
            title=title,
            org=org,
            match_score=_display_score(raw_score),
            reason=reason,
            capabilities=capabilities_by_id.get(master_id, []),
        )
        for position, (_index, raw_score, master_id, reason, category, title, org) in enumerate(
            candidates[:safe_limit],
            start=1,
        )
    ]
