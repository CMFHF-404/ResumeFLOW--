from __future__ import annotations

from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ...models import ExperienceCategory
from .chunking import _normalize_text
from .schemas import DuplicateMatch, ParsedExperienceItem

DUPLICATE_SIMILARITY_THRESHOLD = 0.86


def _build_signature(title: Optional[str], org: Optional[str]) -> str:
    title_part = _normalize_text(title)
    org_part = _normalize_text(org)
    if not title_part and not org_part:
        return ""
    return f"{org_part}::{title_part}"


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _build_duplicate_index(
    entries: Iterable[Any],
) -> Dict[ExperienceCategory, Tuple[List[str], set]]:
    index: Dict[ExperienceCategory, Tuple[List[str], set]] = {}
    for entry in entries:
        signature = _build_signature(entry.title, entry.org)
        if not signature:
            continue
        bucket = index.get(entry.category)
        if not bucket:
            bucket = ([], set())
            index[entry.category] = bucket
        bucket[0].append(signature)
        bucket[1].add(signature)
    return index


def _find_duplicate(
    signature: str, bucket: Optional[Tuple[List[str], set]]
) -> DuplicateMatch:
    if not signature or not bucket:
        return DuplicateMatch(is_duplicate=False)
    signatures, signature_set = bucket
    if signature in signature_set:
        return DuplicateMatch(is_duplicate=True, match_type="exact", match_score=1.0)
    best_score = 0.0
    for existing in signatures:
        score = _similarity(signature, existing)
        if score > best_score:
            best_score = score
    if best_score >= DUPLICATE_SIMILARITY_THRESHOLD:
        return DuplicateMatch(
            is_duplicate=True,
            match_type="similar",
            match_score=round(best_score, 2),
        )
    return DuplicateMatch(is_duplicate=False)


def apply_duplicate_flags(
    items: List[ParsedExperienceItem],
    existing_entries: Iterable[Any],
) -> List[ParsedExperienceItem]:
    # Duplicates are detected per category by normalized (org + title) signature,
    # falling back to similarity when exact matches are not found.
    index = _build_duplicate_index(existing_entries)
    for item in items:
        signature = _build_signature(item.version.title, item.version.org)
        item.duplicate = _find_duplicate(signature, index.get(item.category))
    return items
