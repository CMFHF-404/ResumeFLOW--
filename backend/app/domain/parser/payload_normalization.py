from __future__ import annotations

import re
import uuid
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ...models import ExperienceCategory
from ...utils.date_utils import normalize_month_date_string
from .chunking import _normalize_text
from .schemas import ParsedExperienceItem, ParsedExperienceVersion

DEFAULT_WORK_TITLE = "未命名经历"
DEFAULT_WORK_ORG = "未知机构"
DEFAULT_EDU_TITLE = "未命名专业"
DEFAULT_EDU_ORG = "未命名学校"
DEFAULT_SKILL_CATEGORY = "未分类"
PRESENT_MARKERS = {"present", "current", "now", "至今", "目前"}
COURSE_SPLIT_PATTERN = re.compile(r"[,，;；/\n]")
SKILL_TAG_SPLIT_PATTERN = re.compile(r"[,，;；/\n、|]+")
CJK_CHAR_PATTERN = r"\u4e00-\u9fff\u3400-\u4dbf"
CJK_PUNCT_PATTERN = r"\u3000-\u303f\uff00-\uffef·•"
CJK_INLINE_PATTERN = f"{CJK_CHAR_PATTERN}{CJK_PUNCT_PATTERN}"
CJK_PUNCT_ADJACENT_PATTERN = r"\(\)\[\]（）【】《》<>·•"
WHITESPACE_PATTERN = re.compile(r"\s+")
LINK_SPLIT_PATTERN = re.compile(r"[\s,;，；]+")
PERSONAL_INFO_FIELDS = ("full_name", "email", "phone", "location")
PROJECT_KEYWORDS = {
    "project",
    "projects",
    "side project",
    "personal project",
    "open source",
    "opensource",
    "github",
    "开源",
    "项目",
    "课程设计",
    "课程项目",
    "毕业设计",
    "竞赛",
    "比赛",
    "作品",
}
WORK_KEYWORDS = {
    "intern",
    "internship",
    "full-time",
    "part-time",
    "employment",
    "company",
    "client",
    "客户",
    "公司",
    "集团",
    "部门",
    "岗位",
    "实习",
    "任职",
}
WORK_ORG_HINTS = {
    "有限公司",
    "股份有限公司",
    "有限责任公司",
    "公司",
    "集团",
    "inc",
    "ltd",
    "llc",
    "corp",
}
PROJECT_TITLE_HINTS = {"项目", "project"}
PROJECT_NAME_HINTS = {
    "system",
    "platform",
    "project",
    "app",
    "website",
    "web",
    "service",
    "tool",
    "dashboard",
    "系统",
    "平台",
    "项目",
    "应用",
    "网站",
    "小程序",
    "服务",
    "工具",
    "后台",
    "管理后台",
    "商城",
    "门户",
    "客户端",
    "gis",
    "webgis",
}
PROJECT_ROLE_HINTS = {
    "owner",
    "lead",
    "leader",
    "pm",
    "project manager",
    "tech lead",
    "engineer",
    "developer",
    "maintainer",
    "contributor",
    "负责人",
    "项目经理",
    "组长",
    "组员",
    "成员",
    "主导",
    "牵头",
    "独立开发",
    "核心开发",
    "开发",
}
PROJECT_MIN_SCORE = 1


def _is_present_marker(value: Any) -> bool:
    if not value:
        return False
    marker = str(value).strip().lower()
    return marker in PRESENT_MARKERS


def _normalize_date(value: Any) -> Optional[str]:
    if _is_present_marker(value):
        return None
    return normalize_month_date_string(value)


def _ensure_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    return []


def _ensure_str(value: Any) -> str:
    if value is None:
        return ""
    return _clean_inline_text(str(value))


def _clean_inline_text(value: str) -> str:
    compact = WHITESPACE_PATTERN.sub(" ", value).strip()
    compact = re.sub(
        rf"(?<=[{CJK_INLINE_PATTERN}])\s+(?=[{CJK_INLINE_PATTERN}])",
        "",
        compact,
    )
    compact = re.sub(
        rf"(?<=[{CJK_CHAR_PATTERN}])\s+(?=[{CJK_PUNCT_ADJACENT_PATTERN}])",
        "",
        compact,
    )
    compact = re.sub(
        rf"(?<=[{CJK_PUNCT_ADJACENT_PATTERN}])\s+(?=[{CJK_CHAR_PATTERN}])",
        "",
        compact,
    )
    return compact


def _clean_multiline_text(value: str) -> str:
    lines = [line for line in value.splitlines()]
    cleaned = [_clean_inline_text(line) for line in lines]
    return "\n".join([line for line in cleaned if line])


def _clean_resume_text(text: str) -> str:
    if not text:
        return text
    lines = text.splitlines()
    cleaned_lines = [
        _clean_inline_text(line) if line.strip() else ""
        for line in lines
    ]
    return "\n".join(cleaned_lines)


def _ensure_optional_str(value: Any) -> Optional[str]:
    text = _ensure_str(value)
    return text or None


def _normalize_text_list(value: Any) -> List[str]:
    return [
        _clean_inline_text(item)
        for item in _ensure_list(value)
        if isinstance(item, str) and item.strip()
    ]


def _normalize_skill_tags(value: Any) -> List[str]:
    if isinstance(value, list):
        return _normalize_text_list(value)
    if isinstance(value, str):
        items = [
            item.strip()
            for item in SKILL_TAG_SPLIT_PATTERN.split(value)
            if item.strip()
        ]
        return items
    return []


def _join_text_parts(parts: Iterable[str]) -> str:
    return " ".join([part for part in parts if part]).strip()


def _contains_any(text: str, keywords: Iterable[str]) -> bool:
    if not text:
        return False
    return any(keyword in text for keyword in keywords)


def _count_keyword_hits(text: str, keywords: Iterable[str]) -> int:
    if not text:
        return 0
    return sum(1 for keyword in keywords if keyword in text)


def _collect_entry_text(entry: Dict[str, Any]) -> str:
    star_source = entry.get("star") if isinstance(entry.get("star"), dict) else {}
    parts = [
        _ensure_str(entry.get("title")),
        _ensure_str(entry.get("org")),
        _ensure_str(entry.get("summary")),
        " ".join(_normalize_text_list(entry.get("highlights"))),
        _ensure_str(star_source.get("s")),
        _ensure_str(star_source.get("t")),
        _ensure_str(star_source.get("a")),
        _ensure_str(star_source.get("r")),
    ]
    return _join_text_parts(parts)


def _normalize_courses(value: Any) -> Any:
    if isinstance(value, list):
        return _normalize_text_list(value)
    if isinstance(value, str):
        items = [
            _clean_inline_text(item)
            for item in COURSE_SPLIT_PATTERN.split(value)
            if item.strip()
        ]
        return items if items else _clean_inline_text(value)
    return ""


def _normalize_star_field(value: Any) -> str:
    if isinstance(value, list):
        items = [
            _clean_inline_text(item)
            for item in value
            if isinstance(item, str) and item.strip()
        ]
        return "\n".join(items)
    if value is None:
        return ""
    return _clean_multiline_text(str(value))


def _resolve_action_text(current: str, highlights: Any) -> str:
    highlight_items = _normalize_text_list(highlights)
    if not highlight_items:
        return current
    highlight_text = "\n".join(highlight_items)
    if not current or len(highlight_text) > len(current):
        return highlight_text
    return current


def _build_star_payload(entry: Dict[str, Any]) -> Dict[str, str]:
    star_source = entry.get("star") if isinstance(entry.get("star"), dict) else {}
    s_value = _normalize_star_field(star_source.get("s") or entry.get("s"))
    t_value = _normalize_star_field(star_source.get("t") or entry.get("t"))
    a_value = _normalize_star_field(star_source.get("a") or entry.get("a"))
    r_value = _normalize_star_field(star_source.get("r") or entry.get("r"))
    a_value = _resolve_action_text(a_value, entry.get("highlights"))
    return {"s": s_value, "t": t_value, "a": a_value, "r": r_value}


def _build_work_version(entry: Dict[str, Any]) -> ParsedExperienceVersion:
    title = _ensure_str(entry.get("title")) or DEFAULT_WORK_TITLE
    org = _ensure_str(entry.get("org")) or DEFAULT_WORK_ORG
    end_raw = entry.get("end_date")
    is_current = bool(entry.get("is_current")) or _is_present_marker(end_raw)
    return ParsedExperienceVersion(
        title=title,
        org=org,
        location=_ensure_str(entry.get("location")) or None,
        start_date=_normalize_date(entry.get("start_date")),
        end_date=_normalize_date(end_raw),
        is_current=is_current,
        summary=_ensure_str(entry.get("summary")) or None,
        highlights=_normalize_text_list(entry.get("highlights")),
        tags=_normalize_text_list(entry.get("tags")),
        star=_build_star_payload(entry),
    )


def _should_swap_project_fields(title: str, org: str) -> bool:
    title_text = _normalize_text(title)
    org_text = _normalize_text(org)
    if not title_text or not org_text:
        return False
    title_project = _count_keyword_hits(title_text, PROJECT_NAME_HINTS)
    org_project = _count_keyword_hits(org_text, PROJECT_NAME_HINTS)
    title_role = _count_keyword_hits(title_text, PROJECT_ROLE_HINTS)
    org_role = _count_keyword_hits(org_text, PROJECT_ROLE_HINTS)
    swap_score = title_project + org_role
    keep_score = org_project + title_role
    return swap_score > keep_score and swap_score >= PROJECT_MIN_SCORE


def _normalize_project_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    title = _ensure_str(entry.get("title"))
    org = _ensure_str(entry.get("org"))
    if _should_swap_project_fields(title, org):
        return {**entry, "title": org, "org": title}
    return entry


def _build_project_version(entry: Dict[str, Any]) -> ParsedExperienceVersion:
    normalized = _normalize_project_entry(entry)
    return _build_work_version(normalized)


def _build_education_version(entry: Dict[str, Any]) -> ParsedExperienceVersion:
    school = _ensure_str(entry.get("school"))
    major = _ensure_str(entry.get("major"))
    degree = _ensure_str(entry.get("degree"))
    title = major or degree or DEFAULT_EDU_TITLE
    org = school or DEFAULT_EDU_ORG
    star: Dict[str, Any] = {}
    if degree:
        star["degree"] = degree
    gpa = _ensure_str(entry.get("gpa"))
    if gpa:
        star["gpa"] = gpa
    courses = _normalize_courses(entry.get("courses"))
    if courses:
        star["courses"] = courses
    is_current = bool(entry.get("is_current")) or _is_present_marker(entry.get("end_date"))
    return ParsedExperienceVersion(
        title=title,
        org=org,
        start_date=_normalize_date(entry.get("start_date")),
        end_date=_normalize_date(entry.get("end_date")),
        is_current=is_current,
        star=star,
    )


def _build_item(category: ExperienceCategory, version: ParsedExperienceVersion) -> ParsedExperienceItem:
    return ParsedExperienceItem(
        id=str(uuid.uuid4()),
        category=category,
        version=version,
    )


def _infer_experience_category(entry: Dict[str, Any]) -> ExperienceCategory:
    text = _normalize_text(_collect_entry_text(entry))
    title = _normalize_text(_ensure_str(entry.get("title")))
    org = _normalize_text(_ensure_str(entry.get("org")))
    project_score = _count_keyword_hits(text, PROJECT_KEYWORDS)
    work_score = _count_keyword_hits(text, WORK_KEYWORDS)

    if _contains_any(org, WORK_ORG_HINTS):
        work_score += 1
    if _contains_any(title, PROJECT_TITLE_HINTS):
        project_score += 1

    if project_score >= PROJECT_MIN_SCORE and project_score > work_score:
        return ExperienceCategory.PROJECT
    return ExperienceCategory.WORK


def _split_work_and_project_entries(
    entries: Iterable[Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    work_entries: List[Dict[str, Any]] = []
    project_entries: List[Dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        category = _infer_experience_category(entry)
        if category == ExperienceCategory.PROJECT:
            project_entries.append(entry)
        else:
            work_entries.append(entry)
    return work_entries, project_entries


def build_resume_items(payload: Dict[str, Any]) -> List[ParsedExperienceItem]:
    items: List[ParsedExperienceItem] = []
    raw_work_entries = _ensure_list(payload.get("work_experiences"))
    project_payload = (
        payload.get("project_experiences")
        if "project_experiences" in payload
        else None
    )
    raw_project_entries = _ensure_list(project_payload)
    if "project_experiences" in payload:
        work_entries = [entry for entry in raw_work_entries if isinstance(entry, dict)]
        project_entries = [entry for entry in raw_project_entries if isinstance(entry, dict)]
    else:
        work_entries, project_entries = _split_work_and_project_entries(raw_work_entries)

    for entry in work_entries:
        items.append(_build_item(ExperienceCategory.WORK, _build_work_version(entry)))
    for entry in project_entries:
        items.append(_build_item(ExperienceCategory.PROJECT, _build_project_version(entry)))
    for entry in _ensure_list(payload.get("education")):
        if isinstance(entry, dict):
            items.append(
                _build_item(ExperienceCategory.EDUCATION, _build_education_version(entry))
            )
    return items


def _extract_dict_entries(value: Any) -> List[Dict[str, Any]]:
    return [item for item in _ensure_list(value) if isinstance(item, dict)]


def _normalize_personal_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _clean_inline_text(value)
    return _clean_inline_text(str(value))


def _normalize_personal_links(value: Any) -> List[str]:
    if not value:
        return []
    items: List[str] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                items.extend(LINK_SPLIT_PATTERN.split(item))
    elif isinstance(value, str):
        items.extend(LINK_SPLIT_PATTERN.split(value))
    else:
        return []
    return [item.strip() for item in items if isinstance(item, str) and item.strip()]


def normalize_personal_info(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    personal_info = payload.get("personal_info")
    if not isinstance(personal_info, dict):
        return None
    normalized: Dict[str, Any] = {}
    for field in PERSONAL_INFO_FIELDS:
        value = _normalize_personal_value(personal_info.get(field))
        if value:
            normalized[field] = value
    links = _normalize_personal_links(personal_info.get("links"))
    if links:
        normalized["links"] = links
    return normalized or None


def _normalize_certification_entry(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = _ensure_str(entry.get("name"))
    if not name:
        return None
    return {
        "name": name,
        "issuer": _ensure_optional_str(entry.get("issuer")),
        "issue_date": _ensure_optional_str(entry.get("issue_date")),
        "expiry_date": _ensure_optional_str(entry.get("expiry_date")),
        "credential_id": _ensure_optional_str(entry.get("credential_id")),
        "credential_url": _ensure_optional_str(entry.get("credential_url")),
        "description": _ensure_optional_str(entry.get("description")),
    }


def normalize_certifications(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw_items = _extract_dict_entries(payload.get("certifications"))
    normalized: List[Dict[str, Any]] = []
    for entry in raw_items:
        item = _normalize_certification_entry(entry)
        if item:
            normalized.append(item)
    if not normalized:
        return []
    return _dedupe_entries(normalized, ("name", "issuer", "issue_date"))


def _normalize_skill_category(value: Any) -> str:
    return _ensure_str(value) or DEFAULT_SKILL_CATEGORY


def normalize_skill_groups(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw_groups = _extract_dict_entries(payload.get("skills"))
    if not raw_groups:
        return []
    grouped: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for entry in raw_groups:
        category = _normalize_skill_category(entry.get("category"))
        category_key = _normalize_text(category)
        tags = _normalize_skill_tags(entry.get("tags"))
        if not tags:
            continue
        if category_key not in grouped:
            grouped[category_key] = {"category": category, "tags": []}
            order.append(category_key)
        existing_tags = grouped[category_key]["tags"]
        seen = {_normalize_text(tag) for tag in existing_tags}
        for tag in tags:
            tag_key = _normalize_text(tag)
            if not tag_key or tag_key in seen:
                continue
            existing_tags.append(tag)
            seen.add(tag_key)
    return [grouped[key] for key in order if grouped.get(key)]


def _merge_personal_info(results: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    merged: Dict[str, Any] = {}
    for field in PERSONAL_INFO_FIELDS:
        for result in results:
            personal_info = result.get("personal_info")
            if not isinstance(personal_info, dict):
                continue
            value = _normalize_personal_value(personal_info.get(field))
            if value:
                merged[field] = value
                break
    links: List[str] = []
    seen = set()
    for result in results:
        personal_info = result.get("personal_info")
        if not isinstance(personal_info, dict):
            continue
        for link in _normalize_personal_links(personal_info.get("links")):
            if link not in seen:
                seen.add(link)
                links.append(link)
    if links:
        merged["links"] = links
    return merged or None


def _entry_signature(entry: Dict[str, Any], fields: Tuple[str, ...]) -> str:
    parts = [
        _normalize_text(_ensure_str(entry.get(field)))
        for field in fields
    ]
    if not any(parts):
        return ""
    return "::".join(parts)


def _entry_score(entry: Dict[str, Any]) -> int:
    score = 0
    for value in entry.values():
        if isinstance(value, str):
            score += len(value.strip())
        elif isinstance(value, list):
            score += sum(len(item.strip()) for item in value if isinstance(item, str))
        elif isinstance(value, dict):
            score += sum(
                len(str(item).strip())
                for item in value.values()
                if isinstance(item, str)
            )
    return score


def _dedupe_entries(
    entries: List[Dict[str, Any]], fields: Tuple[str, ...]
) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    index: Dict[str, int] = {}
    for entry in entries:
        signature = _entry_signature(entry, fields)
        if not signature:
            output.append(entry)
            continue
        existing_index = index.get(signature)
        if existing_index is None:
            index[signature] = len(output)
            output.append(entry)
            continue
        if _entry_score(entry) > _entry_score(output[existing_index]):
            output[existing_index] = entry
    return output
