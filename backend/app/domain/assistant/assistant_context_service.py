from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict

from sqlmodel.ext.asyncio.session import AsyncSession

from ..certifications.certification_service import list_certifications
from ..experience.experience_service import list_experiences
from ..profile.profile_service import get_profile_if_exists
from ..skills.skill_service import list_user_skills


MAX_BANK_PROFILE_SUMMARY_CHARS = 300
MAX_BANK_EXPERIENCE_SUMMARY_CHARS = 300
MAX_BANK_CERT_DESCRIPTION_CHARS = 300
MAX_BANK_STAR_FIELD_CHARS = 500
MAX_BANK_TEXT_LENGTH = 300
BANK_CONTEXT_FETCH_BATCH_SIZE = 500
MAX_BANK_EXPERIENCE_ITEMS = 64
MAX_BANK_CERTIFICATION_ITEMS = 64
MAX_BANK_SKILL_ITEMS = 128
MAX_BANK_CONTEXT_BYTES = 768 * 1024


@dataclass(frozen=True)
class BankContextSources:
    get_profile_if_exists: Callable[..., Awaitable[Any]]
    list_experiences: Callable[..., Awaitable[list[Any]]]
    list_certifications: Callable[..., Awaitable[list[Any]]]
    list_user_skills: Callable[..., Awaitable[list[Any]]]


DEFAULT_BANK_CONTEXT_SOURCES = BankContextSources(
    get_profile_if_exists=get_profile_if_exists,
    list_experiences=list_experiences,
    list_certifications=list_certifications,
    list_user_skills=list_user_skills,
)


def _normalize_bank_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    normalized = re.sub(r"(?i)<br\s*/?>", "\n", normalized)
    normalized = re.sub(r"(?i)</p\s*>", "\n", normalized)
    normalized = re.sub(r"<[^>]+>", " ", normalized)
    normalized = html.unescape(normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return None
    if len(normalized) > limit:
        normalized = normalized[:limit].rstrip() + "..."
    return normalized


def _serialize_optional_date(value: Any) -> str | None:
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _build_star_snapshot(raw_star: Any) -> Dict[str, str]:
    if not isinstance(raw_star, dict):
        return {}
    snapshot: Dict[str, str] = {}
    for key in ("s", "t", "a", "r"):
        normalized = _normalize_bank_text(raw_star.get(key), MAX_BANK_STAR_FIELD_CHARS)
        if normalized:
            snapshot[key] = normalized
    return snapshot


def _project_profile(profile: Any | None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {}
    if profile is None:
        return payload

    for source_key, target_key in (
        ("full_name", "full_name"),
        ("title", "title"),
        ("location", "location"),
        ("email", "email"),
        ("phone", "phone"),
    ):
        normalized = _normalize_bank_text(getattr(profile, source_key, None), MAX_BANK_TEXT_LENGTH)
        if normalized:
            payload[target_key] = normalized
    profile_summary = _normalize_bank_text(profile.summary, MAX_BANK_PROFILE_SUMMARY_CHARS)
    if profile_summary:
        payload["summary"] = profile_summary
    return payload


def _project_experiences(experience_rows: list[tuple[Any, Any]]) -> Dict[str, list[Dict[str, Any]]]:
    grouped: Dict[str, list[Dict[str, Any]]] = {
        "work": [],
        "project": [],
        "education": [],
    }
    projected_count = 0
    for master, latest_version in experience_rows:
        if master.is_archived or latest_version is None:
            continue
        if projected_count >= MAX_BANK_EXPERIENCE_ITEMS:
            break
        payload: Dict[str, Any] = {
            "masterId": str(master.id),
            "isCurrent": bool(latest_version.is_current),
        }
        for source_key, target_key, limit in (
            ("title", "title", MAX_BANK_TEXT_LENGTH),
            ("org", "org", MAX_BANK_TEXT_LENGTH),
            ("summary", "summary", MAX_BANK_EXPERIENCE_SUMMARY_CHARS),
        ):
            normalized = _normalize_bank_text(getattr(latest_version, source_key, None), limit)
            if normalized:
                payload[target_key] = normalized
        start_date = _serialize_optional_date(latest_version.start_date)
        end_date = _serialize_optional_date(latest_version.end_date)
        if start_date:
            payload["startDate"] = start_date
        if end_date:
            payload["endDate"] = end_date
        star_snapshot = _build_star_snapshot(latest_version.star)
        if star_snapshot:
            payload["star"] = star_snapshot
        grouped[master.category.value].append(payload)
        projected_count += 1
    return grouped


def _project_certifications(certifications: list[Any]) -> list[Dict[str, Any]]:
    payloads: list[Dict[str, Any]] = []
    for cert in certifications[:MAX_BANK_CERTIFICATION_ITEMS]:
        item: Dict[str, Any] = {"id": str(cert.id)}
        for source_key, target_key in (
            ("name", "name"),
            ("issuer", "issuer"),
        ):
            normalized = _normalize_bank_text(getattr(cert, source_key, None), MAX_BANK_TEXT_LENGTH)
            if normalized:
                item[target_key] = normalized
        for source_key, target_key in (
            ("issue_date", "issueDate"),
            ("expiry_date", "expiryDate"),
        ):
            serialized = _serialize_optional_date(getattr(cert, source_key, None))
            if serialized:
                item[target_key] = serialized
        description = _normalize_bank_text(cert.description, MAX_BANK_CERT_DESCRIPTION_CHARS)
        if description:
            item["description"] = description
        payloads.append(item)
    return payloads


def _project_skills(skills: list[tuple[Any, Any]]) -> list[Dict[str, Any]]:
    payloads: list[Dict[str, Any]] = []
    for user_skill, skill in skills[:MAX_BANK_SKILL_ITEMS]:
        normalized_name = _normalize_bank_text(skill.name, MAX_BANK_TEXT_LENGTH)
        if not normalized_name:
            continue
        item: Dict[str, Any] = {
            "id": str(user_skill.id),
            "name": normalized_name,
        }
        category = _normalize_bank_text(skill.category, MAX_BANK_TEXT_LENGTH)
        if category:
            item["category"] = category
        if user_skill.proficiency is not None:
            item["proficiency"] = user_skill.proficiency
        payloads.append(item)
    return payloads


def _compact_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _refresh_bank_context_metadata(context: Dict[str, Any]) -> None:
    metadata = context["_meta"]
    for category, items in context["experiences"].items():
        category_metadata = metadata["experiences"][category]
        category_metadata["returnedCount"] = len(items)
        category_metadata["truncated"] = (
            category_metadata["loadedCount"] > len(items)
        )
    for key in ("certifications", "skills"):
        item_metadata = metadata[key]
        item_metadata["returnedCount"] = len(context[key])
        item_metadata["truncated"] = item_metadata["loadedCount"] > len(context[key])


def _truncate_bank_context_to_byte_limit(
    context: Dict[str, Any],
    *,
    max_bytes: int = MAX_BANK_CONTEXT_BYTES,
) -> Dict[str, Any]:
    current_bytes = len(_compact_json_bytes(context))
    if current_bytes <= max_bytes:
        return context

    experiences = context["experiences"]
    trim_lists = (
        context["skills"],
        context["certifications"],
        experiences["education"],
        experiences["project"],
        experiences["work"],
    )
    while current_bytes > max_bytes:
        removed_any = False
        for items in trim_lists:
            if current_bytes <= max_bytes:
                break
            if not items:
                continue
            removed = items.pop()
            current_bytes -= len(_compact_json_bytes(removed))
            if items:
                current_bytes -= 1
            removed_any = True
        if not removed_any:
            break

    if current_bytes > max_bytes:
        context["profile"] = {}
    _refresh_bank_context_metadata(context)
    return context


def project_bank_context(
    *,
    profile: Any | None,
    experience_rows: list[tuple[Any, Any]],
    certifications: list[Any],
    skills: list[tuple[Any, Any]],
) -> Dict[str, Any]:
    loaded_experience_counts = {
        "work": 0,
        "project": 0,
        "education": 0,
    }
    for master, latest_version in experience_rows:
        if getattr(master, "is_archived", False) or latest_version is None:
            continue
        category = getattr(getattr(master, "category", None), "value", None)
        if category in loaded_experience_counts:
            loaded_experience_counts[category] += 1
    context = {
        "profile": _project_profile(profile),
        "experiences": _project_experiences(experience_rows),
        "certifications": _project_certifications(certifications),
        "skills": _project_skills(skills),
        "_meta": {
            "boundedSnapshot": True,
            "experiences": {
                category: {
                    "loadedCount": loaded_count,
                    "returnedCount": 0,
                    "truncated": False,
                }
                for category, loaded_count in loaded_experience_counts.items()
            },
            "certifications": {
                "loadedCount": len(certifications),
                "returnedCount": 0,
                "truncated": False,
            },
            "skills": {
                "loadedCount": len(skills),
                "returnedCount": 0,
                "truncated": False,
            },
        },
    }
    _refresh_bank_context_metadata(context)
    return _truncate_bank_context_to_byte_limit(context)


async def build_bank_context(
    session: AsyncSession,
    *,
    user_id: str,
    sources: BankContextSources = DEFAULT_BANK_CONTEXT_SOURCES,
    fetch_batch_size: int = BANK_CONTEXT_FETCH_BATCH_SIZE,
) -> Dict[str, Any]:
    profile = await sources.get_profile_if_exists(session, user_id)
    experience_rows: list[tuple[Any, Any]] = []
    offset = 0
    page_size = max(int(fetch_batch_size), 1)
    experience_probe_limit = MAX_BANK_EXPERIENCE_ITEMS + 1
    while len(experience_rows) < experience_probe_limit:
        remaining = experience_probe_limit - len(experience_rows)
        request_limit = min(page_size, remaining)
        batch = await sources.list_experiences(
            session,
            user_id,
            None,
            None,
            request_limit,
            offset,
            include_archived=False,
        )
        if not batch:
            break
        experience_rows.extend(batch)
        if len(batch) < request_limit:
            break
        offset += request_limit
    certifications = await sources.list_certifications(
        session,
        user_id,
        limit=MAX_BANK_CERTIFICATION_ITEMS + 1,
    )
    skills = await sources.list_user_skills(
        session,
        user_id,
        limit=MAX_BANK_SKILL_ITEMS + 1,
    )

    return project_bank_context(
        profile=profile,
        experience_rows=experience_rows,
        certifications=certifications,
        skills=skills,
    )
