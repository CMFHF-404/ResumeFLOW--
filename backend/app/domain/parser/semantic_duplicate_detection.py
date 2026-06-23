from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ...config import load_settings
from ...models import ExperienceCategory
from ..ai.ai_service import call_llm_json
from .chunking import _normalize_text
from .duplicate_detection import _build_match_signatures, _similarity
from .schemas import DuplicateMatch, ParsedExperienceItem

settings = load_settings()
logger = logging.getLogger(__name__)

SEMANTIC_DEDUPE_CONFIDENCE_THRESHOLD = 0.75
SEMANTIC_CANDIDATE_MIN_SCORE = 0.45
SEMANTIC_DEDUPE_PROMPT = (
    "You are a resume experience duplicate checker. Return JSON only. "
    "Decide whether parsed resume items duplicate existing experience-bank entries. "
    "Treat category, title, org, and role wording as noisy model outputs. "
    "Do not mark same-company but different role/responsibility records as duplicates. "
    "Return {\"matches\":[{\"item_id\":\"\",\"existing_id\":\"\","
    "\"is_duplicate\":false,\"confidence\":0.0,\"reason\":\"\"}]}. "
    "Only use ids provided in the input."
)


def _resolve_entry_id(entry: Any) -> str:
    return str(getattr(entry, "id", "") or "")


def _category_value(value: Any) -> str:
    if isinstance(value, ExperienceCategory):
        return value.value
    return str(value or "")


def _compact_text(value: Optional[str], limit: int = 240) -> str:
    text = (value or "").strip()
    return text[:limit]


def _collect_item_text(item: ParsedExperienceItem) -> str:
    version = item.version
    parts = [
        item.category.value,
        version.title or "",
        version.org or "",
        version.summary or "",
        " ".join(version.highlights or []),
        str(version.star or ""),
    ]
    return _normalize_text(" ".join(parts))


def _collect_existing_text(entry: Any) -> str:
    parts = [
        _category_value(getattr(entry, "category", "")),
        getattr(entry, "title", "") or "",
        getattr(entry, "org", "") or "",
    ]
    return _normalize_text(" ".join(parts))


def _contains_meaningful_overlap(left: str, right: str) -> bool:
    if not left or not right:
        return False
    shorter = min(len(left), len(right))
    return shorter >= 4 and (left in right or right in left)


def _candidate_score(item: ParsedExperienceItem, entry: Any) -> float:
    item_signatures = _build_match_signatures(
        item.category,
        item.version.title,
        item.version.org,
    )
    entry_signatures = _build_match_signatures(
        getattr(entry, "category", item.category),
        getattr(entry, "title", ""),
        getattr(entry, "org", ""),
    )
    signature_score = max(
        (
            _similarity(item_signature, entry_signature)
            for item_signature in item_signatures
            for entry_signature in entry_signatures
        ),
        default=0.0,
    )
    item_org = _normalize_text(item.version.org)
    entry_org = _normalize_text(getattr(entry, "org", ""))
    item_title = _normalize_text(item.version.title)
    entry_title = _normalize_text(getattr(entry, "title", ""))
    org_score = _similarity(item_org, entry_org)
    title_score = _similarity(item_title, entry_title)
    text_score = _similarity(_collect_item_text(item), _collect_existing_text(entry))

    if _contains_meaningful_overlap(item_org, entry_org):
        signature_score = max(signature_score, 0.7)
    if _contains_meaningful_overlap(item_title, entry_title):
        signature_score = max(signature_score, 0.62)

    return max(signature_score, org_score * 0.7, title_score * 0.7, text_score)


def _build_semantic_candidates(
    items: List[ParsedExperienceItem],
    existing_entries: Iterable[Any],
    max_candidates: int,
) -> List[Tuple[ParsedExperienceItem, Any, float]]:
    candidates: List[Tuple[ParsedExperienceItem, Any, float]] = []
    existing = [entry for entry in existing_entries if _resolve_entry_id(entry)]
    for item in items:
        if item.duplicate and item.duplicate.is_duplicate:
            continue
        scored: List[Tuple[ParsedExperienceItem, Any, float]] = []
        for entry in existing:
            score = _candidate_score(item, entry)
            if score >= SEMANTIC_CANDIDATE_MIN_SCORE:
                scored.append((item, entry, score))
        candidates.extend(sorted(scored, key=lambda entry: entry[2], reverse=True)[:3])
    return sorted(candidates, key=lambda entry: entry[2], reverse=True)[:max_candidates]


def _build_llm_payload(
    candidates: List[Tuple[ParsedExperienceItem, Any, float]]
) -> Dict[str, Any]:
    item_map: Dict[str, Dict[str, Any]] = {}
    candidate_rows: List[Dict[str, Any]] = []
    for item, entry, score in candidates:
        if item.id not in item_map:
            item_map[item.id] = {
                "item_id": item.id,
                "category": item.category.value,
                "title": _compact_text(item.version.title),
                "org": _compact_text(item.version.org),
                "summary": _compact_text(item.version.summary),
                "highlights": [
                    _compact_text(text, 120)
                    for text in (item.version.highlights or [])[:3]
                ],
            }
        candidate_rows.append(
            {
                "item_id": item.id,
                "existing_id": _resolve_entry_id(entry),
                "candidate_score": round(score, 3),
                "category": _category_value(getattr(entry, "category", "")),
                "title": _compact_text(getattr(entry, "title", "")),
                "org": _compact_text(getattr(entry, "org", "")),
            }
        )
    return {"items": list(item_map.values()), "candidates": candidate_rows}


def _coerce_confidence(value: Any) -> Optional[float]:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if confidence < 0 or confidence > 1:
        return None
    return confidence


def _validated_semantic_matches(
    payload: Any,
    item_ids: set[str],
    existing_ids: set[str],
) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw_matches = payload.get("matches")
    if not isinstance(raw_matches, list):
        return []
    matches: List[Dict[str, Any]] = []
    for raw in raw_matches:
        if not isinstance(raw, dict) or raw.get("is_duplicate") is not True:
            continue
        item_id = str(raw.get("item_id") or "")
        existing_id = str(raw.get("existing_id") or "")
        if item_id not in item_ids or existing_id not in existing_ids:
            continue
        confidence = _coerce_confidence(raw.get("confidence"))
        if confidence is None or confidence < SEMANTIC_DEDUPE_CONFIDENCE_THRESHOLD:
            continue
        matches.append(
            {
                "item_id": item_id,
                "existing_id": existing_id,
                "confidence": round(confidence, 2),
                "reason": _compact_text(str(raw.get("reason") or ""), 160),
            }
        )
    return matches


async def apply_semantic_duplicate_flags(
    items: List[ParsedExperienceItem],
    existing_entries: Iterable[Any],
    request_id: Optional[str] = None,
) -> List[ParsedExperienceItem]:
    if not getattr(settings, "ai_dedupe_enabled", True):
        return items
    max_candidates = int(getattr(settings, "ai_dedupe_max_candidates", 24) or 24)
    existing = list(existing_entries)
    candidates = _build_semantic_candidates(items, existing, max_candidates)
    if not candidates:
        return items

    payload = _build_llm_payload(candidates)
    messages = [
        {"role": "system", "content": SEMANTIC_DEDUPE_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    model = str(
        getattr(settings, "ai_dedupe_model", "")
        or getattr(settings, "ai_fast_model", "")
        or getattr(settings, "ai_model", "")
    )
    try:
        result = await call_llm_json(messages, model=model)
    except Exception as exc:
        logger.warning(
            "[ResumeParse] semantic dedupe fallback request_id=%s error_type=%s error=%s",
            request_id,
            type(exc).__name__,
            str(exc),
        )
        return items

    item_by_id = {item.id: item for item in items}
    existing_ids = {_resolve_entry_id(entry) for entry in existing}
    matches = _validated_semantic_matches(result, set(item_by_id), existing_ids)
    for match in matches:
        item = item_by_id.get(match["item_id"])
        if not item or item.duplicate.is_duplicate:
            continue
        item.duplicate = DuplicateMatch(
            is_duplicate=True,
            match_type="semantic",
            match_score=match["confidence"],
            matched_existing_id=match["existing_id"],
            match_reason=match["reason"],
        )
    return items
