from __future__ import annotations

import html
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
    for master, latest_version in experience_rows:
        if master.is_archived or latest_version is None:
            continue
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
    return grouped


def _project_certifications(certifications: list[Any]) -> list[Dict[str, Any]]:
    payloads: list[Dict[str, Any]] = []
    for cert in certifications:
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
    for user_skill, skill in skills:
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


def project_bank_context(
    *,
    profile: Any | None,
    experience_rows: list[tuple[Any, Any]],
    certifications: list[Any],
    skills: list[tuple[Any, Any]],
) -> Dict[str, Any]:
    return {
        "profile": _project_profile(profile),
        "experiences": _project_experiences(experience_rows),
        "certifications": _project_certifications(certifications),
        "skills": _project_skills(skills),
    }


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
    while True:
        batch = await sources.list_experiences(
            session,
            user_id,
            None,
            None,
            fetch_batch_size,
            offset,
            include_archived=False,
        )
        if not batch:
            break
        experience_rows.extend(batch)
        if len(batch) < fetch_batch_size:
            break
        offset += fetch_batch_size
    certifications = await sources.list_certifications(session, user_id)
    skills = await sources.list_user_skills(session, user_id)

    return project_bank_context(
        profile=profile,
        experience_rows=experience_rows,
        certifications=certifications,
        skills=skills,
    )
