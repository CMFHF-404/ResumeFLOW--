from __future__ import annotations

from collections import OrderedDict
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ...models import ExperienceCategory
from .chunking import _normalize_text
from .schemas import DuplicateMatch, ParsedExperienceItem

DUPLICATE_SIMILARITY_THRESHOLD = 0.86
ALL_CATEGORY_KEY = "__all__"
PROJECT_ROLE_HINTS = {
    "owner",
    "lead",
    "leader",
    "pm",
    "project manager",
    "负责人",
    "发起人",
    "牵头人",
    "主导者",
    "项目经理",
    "组长",
    "成员",
    "组员",
}


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


def _dedupe_preserve_order(values: Iterable[str]) -> List[str]:
    return [value for value in OrderedDict.fromkeys(values) if value]


def _is_project_role(value: Optional[str]) -> bool:
    text = _normalize_text(value)
    if not text:
        return False
    return any(hint in text for hint in PROJECT_ROLE_HINTS)


def _build_match_signatures(
    category: ExperienceCategory,
    title: Optional[str],
    org: Optional[str],
) -> List[str]:
    signatures = [_build_signature(title, org)]
    title_text = _normalize_text(title)
    org_text = _normalize_text(org)
    if title_text and org_text:
        signatures.append(_build_signature(org, title))
        signatures.append(_build_signature(f"{org_text} {title_text}", ""))
    if category == ExperienceCategory.PROJECT and org_text and _is_project_role(title):
        signatures.append(f"{org_text}::")
    return _dedupe_preserve_order(signatures)


def _build_duplicate_index(
    entries: Iterable[Any],
) -> Dict[ExperienceCategory | str, Tuple[List[str], set]]:
    index: Dict[ExperienceCategory | str, Tuple[List[str], set]] = {}
    for entry in entries:
        signatures = _build_match_signatures(entry.category, entry.title, entry.org)
        for key in (entry.category, ALL_CATEGORY_KEY):
            bucket = index.get(key)
            if not bucket:
                bucket = ([], set())
                index[key] = bucket
            for signature in signatures:
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


def _find_duplicate_for_signatures(
    signatures: List[str],
    bucket: Optional[Tuple[List[str], set]],
) -> DuplicateMatch:
    best = DuplicateMatch(is_duplicate=False)
    for signature in signatures:
        match = _find_duplicate(signature, bucket)
        if match.is_duplicate and match.match_type == "exact":
            return match
        if (
            match.is_duplicate
            and (best.match_score or 0.0) < (match.match_score or 0.0)
        ):
            best = match
    return best


def apply_duplicate_flags(
    items: List[ParsedExperienceItem],
    existing_entries: Iterable[Any],
) -> List[ParsedExperienceItem]:
    # Prefer same-category matches, then fall back to all categories because
    # faster parsers can mis-bucket projects as work while preserving content.
    index = _build_duplicate_index(existing_entries)
    for item in items:
        signatures = _build_match_signatures(
            item.category,
            item.version.title,
            item.version.org,
        )
        match = _find_duplicate_for_signatures(signatures, index.get(item.category))
        if not match.is_duplicate:
            match = _find_duplicate_for_signatures(signatures, index.get(ALL_CATEGORY_KEY))
        item.duplicate = match
    return items
