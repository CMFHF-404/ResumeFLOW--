from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

from ...models import ExperienceCategory
from ..export.schemas import (
    CertificationViewSnapshot,
    EducationViewSnapshot,
    ResumeExperienceViewSnapshot,
    SkillGroupViewSnapshot,
    SkillItemViewSnapshot,
    StarFields,
)
from ..resume.resume_schema import ResumeExperienceItem
from .agent_common_helpers import _date_to_str


def _version_payload(version: Any) -> Dict[str, Any]:
    return {
        "id": str(getattr(version, "id", "")),
        "title": getattr(version, "title", "") or "",
        "org": getattr(version, "org", "") or "",
        "start_date": _date_to_str(getattr(version, "start_date", None)),
        "end_date": _date_to_str(getattr(version, "end_date", None)),
        "is_current": bool(getattr(version, "is_current", False)),
        "summary": getattr(version, "summary", "") or "",
        "star": getattr(version, "star", {}) or {},
        "tags": getattr(version, "tags", []) or [],
    }


def _build_experiences_payload(
    rows: List[Tuple[Any, Any]],
    category: ExperienceCategory,
    *,
    version_payload: Callable[[Any], Dict[str, Any]] = _version_payload,
) -> List[Dict[str, Any]]:
    payload = []
    for master, version in rows:
        if getattr(master, "category", None) != category or version is None:
            continue
        item = version_payload(version)
        item["id"] = str(getattr(master, "id", getattr(version, "id", "")))
        payload.append(item)
    return payload


def _experiences_payload(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[Dict[str, Any]]:
    return _build_experiences_payload(rows, category)


def _star_fields(star: Dict[str, Any]) -> StarFields:
    return StarFields(
        s=str(star.get("s") or ""),
        t=str(star.get("t") or ""),
        a=str(star.get("a") or ""),
        r=str(star.get("r") or ""),
    )


def _build_experience_snapshots(
    rows: List[Tuple[Any, Any]],
    category: ExperienceCategory,
    *,
    star_fields: Callable[[Dict[str, Any]], StarFields] = _star_fields,
) -> List[ResumeExperienceViewSnapshot]:
    items = []
    for master, version in rows:
        if getattr(master, "category", None) != category or version is None:
            continue
        start = _date_to_str(getattr(version, "start_date", None))
        end = "至今" if getattr(version, "is_current", False) else _date_to_str(getattr(version, "end_date", None))
        items.append(
            ResumeExperienceViewSnapshot(
                id=str(getattr(master, "id", getattr(version, "id", ""))),
                title=getattr(version, "title", "") or "",
                company=getattr(version, "org", "") or "",
                date=" - ".join(part for part in [start, end] if part),
                startDate=start or None,
                endDate=end or None,
                isCurrent=bool(getattr(version, "is_current", False)),
                star=star_fields(getattr(version, "star", {}) or {}),
                category=category.value,
            )
        )
    return items


def _experience_snapshots(rows: List[Tuple[Any, Any]], category: ExperienceCategory) -> List[ResumeExperienceViewSnapshot]:
    return _build_experience_snapshots(rows, category)


def _education_major(title: Any, star: Dict[str, Any], summary: Any) -> str:
    title_text = str(title or "")
    degree_text = str(star.get("degree") or "")
    if title_text and title_text != degree_text:
        return title_text
    return str(star.get("major") or summary or "")


def _build_education_snapshots(
    rows: List[Tuple[Any, Any]],
    *,
    education_major: Callable[[Any, Dict[str, Any], Any], str] = _education_major,
) -> List[EducationViewSnapshot]:
    items = []
    for master, version in rows:
        if getattr(master, "category", None) != ExperienceCategory.EDUCATION or version is None:
            continue
        star = getattr(version, "star", {}) or {}
        items.append(
            EducationViewSnapshot(
                id=str(getattr(master, "id", getattr(version, "id", ""))),
                school=getattr(version, "org", "") or getattr(version, "title", "") or "",
                major=education_major(getattr(version, "title", ""), star, getattr(version, "summary", "")),
                degree=str(star.get("degree") or ""),
                startDate=_date_to_str(getattr(version, "start_date", None)),
                endDate=_date_to_str(getattr(version, "end_date", None)),
                isCurrent=bool(getattr(version, "is_current", False)),
                gpa=str(star.get("gpa") or "") or None,
                courses=str(star.get("courses") or "") or None,
            )
        )
    return items


def _education_snapshots(rows: List[Tuple[Any, Any]]) -> List[EducationViewSnapshot]:
    return _build_education_snapshots(rows)


def _build_resume_item_experience_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
    category: ExperienceCategory,
    *,
    star_fields: Callable[[Dict[str, Any]], StarFields] = _star_fields,
) -> List[ResumeExperienceViewSnapshot]:
    items: List[ResumeExperienceViewSnapshot] = []
    for item in rows:
        experience = item.experience
        master_id = str(getattr(experience, "master_experience_id", ""))
        if category_by_master_id.get(master_id) != category:
            continue
        start = _date_to_str(getattr(experience, "start_date", None))
        end = "至今" if getattr(experience, "is_current", False) else _date_to_str(getattr(experience, "end_date", None))
        items.append(
            ResumeExperienceViewSnapshot(
                id=master_id,
                title=getattr(experience, "title", "") or "",
                company=getattr(experience, "org", "") or "",
                date=" - ".join(part for part in [start, end] if part),
                startDate=start or None,
                endDate=end or None,
                isCurrent=bool(getattr(experience, "is_current", False)),
                star=star_fields(getattr(experience, "star", {}) or {}),
                category=category.value,
            )
        )
    return items


def _resume_item_experience_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
    category: ExperienceCategory,
) -> List[ResumeExperienceViewSnapshot]:
    return _build_resume_item_experience_snapshots(rows, category_by_master_id, category)


def _build_resume_item_education_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
    *,
    education_major: Callable[[Any, Dict[str, Any], Any], str] = _education_major,
) -> List[EducationViewSnapshot]:
    items: List[EducationViewSnapshot] = []
    for item in rows:
        experience = item.experience
        master_id = str(getattr(experience, "master_experience_id", ""))
        if category_by_master_id.get(master_id) != ExperienceCategory.EDUCATION:
            continue
        star = getattr(experience, "star", {}) or {}
        items.append(
            EducationViewSnapshot(
                id=master_id,
                school=getattr(experience, "org", "") or getattr(experience, "title", "") or "",
                major=education_major(getattr(experience, "title", ""), star, getattr(experience, "summary", "")),
                degree=str(star.get("degree") or ""),
                startDate=_date_to_str(getattr(experience, "start_date", None)),
                endDate=_date_to_str(getattr(experience, "end_date", None)),
                isCurrent=bool(getattr(experience, "is_current", False)),
                gpa=str(star.get("gpa") or "") or None,
                courses=str(star.get("courses") or "") or None,
            )
        )
    return items


def _resume_item_education_snapshots(
    rows: List[ResumeExperienceItem],
    category_by_master_id: Dict[str, ExperienceCategory],
) -> List[EducationViewSnapshot]:
    return _build_resume_item_education_snapshots(rows, category_by_master_id)


def _certifications_payload(certs: List[Any]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(getattr(cert, "id", "")),
            "name": getattr(cert, "name", "") or "",
            "issuer": getattr(cert, "issuer", "") or "",
            "issue_date": _date_to_str(getattr(cert, "issue_date", None)),
            "description": getattr(cert, "description", "") or "",
        }
        for cert in certs
    ]


def _certification_snapshots(certs: List[Any]) -> List[CertificationViewSnapshot]:
    return [
        CertificationViewSnapshot(
            id=str(getattr(cert, "id", "")),
            name=getattr(cert, "name", "") or "",
            issuer=getattr(cert, "issuer", None),
            date=_date_to_str(getattr(cert, "issue_date", None)),
        )
        for cert in certs
    ]


def _skills_payload(rows: List[Tuple[Any, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(getattr(user_skill, "id", "")),
            "name": getattr(skill, "name", "") or "",
            "category": getattr(skill, "category", "") or "",
            "proficiency": getattr(user_skill, "proficiency", None),
        }
        for user_skill, skill in rows
    ]


def _skill_group_snapshots(rows: List[Tuple[Any, Any]]) -> List[SkillGroupViewSnapshot]:
    grouped: Dict[str, List[SkillItemViewSnapshot]] = {}
    for user_skill, skill in rows:
        category = getattr(skill, "category", None) or "技能"
        grouped.setdefault(category, []).append(
            SkillItemViewSnapshot(
                id=str(getattr(user_skill, "id", "")),
                name=getattr(skill, "name", "") or "",
            )
        )
    return [SkillGroupViewSnapshot(name=name, skills=items) for name, items in grouped.items()]
