from typing import Any, Dict, List, Optional

MAX_SELECTED_EXPERIENCE_TEXT_CHARS = 300
MAX_SELECTED_EXPERIENCE_SUMMARY_CHARS = 300
MAX_SELECTED_EXPERIENCE_STAR_CHARS = 500
MAX_SELECTED_EXPERIENCES = 20
VALID_SELECTED_EXPERIENCE_CATEGORIES = {"work", "project", "education"}
MAX_SELECTED_RESUME_ID_CHARS = 120
MAX_SELECTED_RESUME_NAME_CHARS = 160
MAX_SELECTED_RESUME_JD_CONTEXT_CHARS = 4000
MAX_SELECTED_RESUME_EXPERIENCES = 40
MAX_SELECTED_RESUME_EDUCATIONS = 20
MAX_SELECTED_RESUME_CERTIFICATIONS = 30
MAX_SELECTED_RESUME_SKILLS = 60
VALID_SELECTED_RESUME_SELECTION_MODES = {"all", "subset"}


def _clip_optional_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def _normalize_selected_experience_item(
    item: Any,
    *,
    include_full_text: bool = False,
    preserve_star_text: bool = False,
) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    master_id = _clip_optional_text(item.get("masterId"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    category = item.get("category")
    if not master_id or not isinstance(category, str) or category not in VALID_SELECTED_EXPERIENCE_CATEGORIES:
        return None

    normalized: Dict[str, Any] = {
        "masterId": master_id,
        "category": category,
        "isCurrent": bool(item.get("isCurrent")),
    }
    for source_key, limit in (
        ("org", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("title", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("startDate", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("endDate", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("summary", MAX_SELECTED_EXPERIENCE_SUMMARY_CHARS),
    ):
        clipped = _clip_optional_text(item.get(source_key), limit)
        if clipped:
            normalized[source_key] = clipped

    full_text: Dict[str, Any] = {}
    raw_star = item.get("star")
    if isinstance(raw_star, dict):
        normalized_star: Dict[str, str] = {}
        full_star: Dict[str, str] = {}
        for key in ("s", "t", "a", "r"):
            raw_value = raw_star.get(key)
            raw_text = raw_value.strip() if isinstance(raw_value, str) else None
            if preserve_star_text:
                if raw_text:
                    normalized_star[key] = raw_text
            else:
                clipped = _clip_optional_text(raw_value, MAX_SELECTED_EXPERIENCE_STAR_CHARS)
                if clipped:
                    normalized_star[key] = clipped
            if include_full_text and raw_text:
                full_star[key] = raw_text
        if normalized_star:
            normalized["star"] = normalized_star
        if full_star:
            full_text["star"] = full_star
    if include_full_text and full_text:
        normalized["full_text"] = full_text
    return normalized


def _normalize_selected_experiences(
    items: Any,
    *,
    include_full_text: bool = False,
    preserve_star_text: bool = False,
) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    normalized_items: List[Dict[str, Any]] = []
    for item in items:
        normalized = _normalize_selected_experience_item(
            item,
            include_full_text=include_full_text,
            preserve_star_text=preserve_star_text,
        )
        if normalized:
            normalized_items.append(normalized)
        if len(normalized_items) >= MAX_SELECTED_EXPERIENCES:
            break
    return normalized_items


def _normalize_selected_resume_experience_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None

    normalized: Dict[str, Any] = {
        "id": item_id,
        "title": _clip_optional_text(item.get("title"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "org": _clip_optional_text(item.get("org"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "star": {},
    }
    start_date = _clip_optional_text(item.get("start_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if start_date:
        normalized["start_date"] = start_date
    end_date = _clip_optional_text(item.get("end_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if end_date:
        normalized["end_date"] = end_date

    raw_star = item.get("star")
    if isinstance(raw_star, dict):
        normalized_star: Dict[str, str] = {}
        for key in ("s", "t", "a", "r"):
            clipped = _clip_optional_text(raw_star.get(key), MAX_SELECTED_EXPERIENCE_STAR_CHARS)
            if clipped:
                normalized_star[key] = clipped
        normalized["star"] = normalized_star
    return normalized


def _normalize_selected_resume_certification_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    normalized: Dict[str, Any] = {
        "id": item_id,
        "name": _clip_optional_text(item.get("name"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "issue_date": _clip_optional_text(item.get("issue_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }
    issuer = _clip_optional_text(item.get("issuer"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if issuer:
        normalized["issuer"] = issuer
    return normalized


def _normalize_selected_resume_education_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    normalized: Dict[str, Any] = {
        "id": item_id,
        "school": _clip_optional_text(item.get("school"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "major": _clip_optional_text(item.get("major"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "degree": _clip_optional_text(item.get("degree"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }
    start_date = _clip_optional_text(item.get("start_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if start_date:
        normalized["start_date"] = start_date
    end_date = _clip_optional_text(item.get("end_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if end_date:
        normalized["end_date"] = end_date
    gpa = _clip_optional_text(item.get("gpa"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if gpa:
        normalized["gpa"] = gpa
    courses = _clip_optional_text(item.get("courses"), MAX_SELECTED_EXPERIENCE_STAR_CHARS)
    if courses:
        normalized["courses"] = courses
    return normalized


def _normalize_selected_resume_skill_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    return {
        "id": item_id,
        "name": _clip_optional_text(item.get("name"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "category": _clip_optional_text(item.get("category"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }


def _normalize_selected_resume_snapshot(snapshot: Any) -> Dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {
            "experiences": [],
            "educations": [],
            "certifications": [],
            "skills": [],
        }

    normalized_experiences: List[Dict[str, Any]] = []
    for item in snapshot.get("experiences", []):
        normalized = _normalize_selected_resume_experience_item(item)
        if normalized:
            normalized_experiences.append(normalized)
        if len(normalized_experiences) >= MAX_SELECTED_RESUME_EXPERIENCES:
            break

    normalized_certifications: List[Dict[str, Any]] = []
    normalized_educations: List[Dict[str, Any]] = []
    for item in snapshot.get("educations", []):
        normalized = _normalize_selected_resume_education_item(item)
        if normalized:
            normalized_educations.append(normalized)
        if len(normalized_educations) >= MAX_SELECTED_RESUME_EDUCATIONS:
            break

    for item in snapshot.get("certifications", []):
        normalized = _normalize_selected_resume_certification_item(item)
        if normalized:
            normalized_certifications.append(normalized)
        if len(normalized_certifications) >= MAX_SELECTED_RESUME_CERTIFICATIONS:
            break

    normalized_skills: List[Dict[str, Any]] = []
    for item in snapshot.get("skills", []):
        normalized = _normalize_selected_resume_skill_item(item)
        if normalized:
            normalized_skills.append(normalized)
        if len(normalized_skills) >= MAX_SELECTED_RESUME_SKILLS:
            break

    return {
        "experiences": normalized_experiences,
        "educations": normalized_educations,
        "certifications": normalized_certifications,
        "skills": normalized_skills,
    }


def _normalize_selected_resume_selection(selection: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(selection, dict):
        return None
    mode = selection.get("mode")
    if not isinstance(mode, str) or mode not in VALID_SELECTED_RESUME_SELECTION_MODES:
        return None
    raw_experience_ids = selection.get("experienceIds")
    if raw_experience_ids is None:
        raw_experience_ids = selection.get("experience_ids")
    if not isinstance(raw_experience_ids, list):
        return None

    experience_ids: List[str] = []
    seen_ids = set()
    for raw_id in raw_experience_ids:
        experience_id = _clip_optional_text(raw_id, MAX_SELECTED_RESUME_ID_CHARS)
        if experience_id and experience_id not in seen_ids:
            seen_ids.add(experience_id)
            experience_ids.append(experience_id)
        if len(experience_ids) >= MAX_SELECTED_RESUME_EXPERIENCES:
            break

    if not experience_ids and mode != "all":
        return None
    return {
        "mode": mode,
        "experienceIds": experience_ids,
    }


def _normalize_selected_resume(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    resume_id = _clip_optional_text(
        item.get("resume_id") or item.get("resumeId"),
        MAX_SELECTED_RESUME_ID_CHARS,
    )
    resume_name = _clip_optional_text(
        item.get("resume_name") or item.get("resumeName"),
        MAX_SELECTED_RESUME_NAME_CHARS,
    )
    if not resume_id or not resume_name:
        return None

    normalized: Dict[str, Any] = {
        "resume_id": resume_id,
        "resume_name": resume_name,
        "snapshot": _normalize_selected_resume_snapshot(item.get("snapshot")),
    }
    master_id = _clip_optional_text(
        item.get("master_id") or item.get("masterId"),
        MAX_SELECTED_RESUME_ID_CHARS,
    )
    if master_id:
        normalized["master_id"] = master_id
    jd_context = _clip_optional_text(
        item.get("jd_context") or item.get("jdContext"),
        MAX_SELECTED_RESUME_JD_CONTEXT_CHARS,
    )
    if jd_context:
        normalized["jd_context"] = jd_context
    selection = _normalize_selected_resume_selection(item.get("selection"))
    if selection:
        normalized["selection"] = selection
    return normalized
