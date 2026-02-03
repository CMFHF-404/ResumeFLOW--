from __future__ import annotations

import io
import logging
import re
import uuid
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from time import perf_counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

from docx import Document
from fastapi import UploadFile
from pypdf import PdfReader
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import MAX_LIMIT
from ...models import ExperienceCategory, ExperienceVersion, MasterExperience
from ..ai.ai_service import call_llm_json
from .prompts import RESUME_PARSING_PROMPT
from .schemas import DuplicateMatch, ParsedExperienceItem, ParsedExperienceVersion

logger = logging.getLogger(__name__)

SUPPORTED_PDF_TYPES = {"application/pdf"}
SUPPORTED_DOCX_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
SUPPORTED_EXTENSIONS = {".pdf", ".docx"}
MIN_TEXT_LENGTH = 30
MAX_RESUME_TEXT_CHARS = 12_000
DUPLICATE_SIMILARITY_THRESHOLD = 0.86
DEFAULT_WORK_TITLE = "未命名经历"
DEFAULT_WORK_ORG = "未知机构"
DEFAULT_EDU_TITLE = "未命名专业"
DEFAULT_EDU_ORG = "未命名学校"
PRESENT_MARKERS = {"present", "current", "now", "至今", "目前"}
COURSE_SPLIT_PATTERN = re.compile(r"[,，;；/\n]")
WHITESPACE_PATTERN = re.compile(r"\s+")
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
LOG_WARN_THRESHOLDS_MS = {
    "read_file": 3_000,
    "parse_pdf": 8_000,
    "parse_docx": 5_000,
    "extract_text_total": 12_000,
    "ai_call": 20_000,
    "parse_resume_total": 25_000,
}


@dataclass(frozen=True)
class ExistingExperience:
    category: ExperienceCategory
    title: str
    org: str


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    compact = WHITESPACE_PATTERN.sub(" ", value).strip().lower()
    return compact


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


def _is_present_marker(value: Any) -> bool:
    if not value:
        return False
    marker = str(value).strip().lower()
    return marker in PRESENT_MARKERS


def _normalize_date(value: Any) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    if not text or _is_present_marker(text):
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    if re.match(r"^\d{4}-\d{2}$", text):
        return f"{text}-01"
    if re.match(r"^\d{4}$", text):
        return f"{text}-01-01"
    return None


def _ensure_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    return []


def _ensure_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_text_list(value: Any) -> List[str]:
    return [
        item.strip()
        for item in _ensure_list(value)
        if isinstance(item, str) and item.strip()
    ]


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
        items = [item.strip() for item in COURSE_SPLIT_PATTERN.split(value) if item.strip()]
        return items if items else value.strip()
    return ""


def _normalize_star_field(value: Any) -> str:
    if isinstance(value, list):
        items = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return "\n".join(items)
    if value is None:
        return ""
    return str(value).strip()


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
    project_payload = payload.get("project_experiences") if "project_experiences" in payload else None
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


def _resolve_file_kind(file: UploadFile) -> str:
    filename = file.filename or ""
    extension = Path(filename).suffix.lower()
    content_type = (file.content_type or "").lower()
    if content_type in SUPPORTED_PDF_TYPES or extension == ".pdf":
        return "pdf"
    if content_type in SUPPORTED_DOCX_TYPES or extension == ".docx":
        return "docx"
    raise ValueError("不支持的文件类型，请上传 PDF 或 DOCX 文件。")


def _extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def _extract_docx_text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
    return "\n".join(paragraphs)


def _validate_text_content(text: str) -> str:
    cleaned = text.strip()
    if len(cleaned) < MIN_TEXT_LENGTH:
        raise ValueError("文件内容过短或无法解析，请确认简历内容完整。")
    return cleaned


def _log_timing(
    step: str,
    duration_ms: float,
    request_id: Optional[str],
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    payload = {"step": step, "duration_ms": round(duration_ms, 2)}
    if request_id:
        payload["request_id"] = request_id
    if extra:
        payload.update(extra)
    threshold = LOG_WARN_THRESHOLDS_MS.get(step)
    if threshold is not None and duration_ms >= threshold:
        logger.warning("[ResumeParse] %s", payload)
        return
    logger.info("[ResumeParse] %s", payload)


async def extract_text(file: UploadFile, request_id: Optional[str] = None) -> str:
    total_start = perf_counter()
    read_start = perf_counter()
    data = await file.read()
    read_ms = (perf_counter() - read_start) * 1000
    _log_timing(
        "read_file",
        read_ms,
        request_id,
        {
            "size": len(data),
            "filename": file.filename or "",
            "content_type": file.content_type or "",
        },
    )
    if not data:
        raise ValueError("文件为空，无法解析。")
    kind = _resolve_file_kind(file)
    parse_start = perf_counter()
    if kind == "pdf":
        text = _extract_pdf_text(data)
        parse_step = "parse_pdf"
    else:
        text = _extract_docx_text(data)
        parse_step = "parse_docx"
    parse_ms = (perf_counter() - parse_start) * 1000
    _log_timing(parse_step, parse_ms, request_id, {"text_length": len(text)})
    total_ms = (perf_counter() - total_start) * 1000
    _log_timing("extract_text_total", total_ms, request_id)
    return _validate_text_content(text)


async def parse_resume(text: str, request_id: Optional[str] = None) -> Dict[str, Any]:
    trimmed = text.strip()
    if not trimmed:
        raise ValueError("简历内容为空，无法解析。")
    if len(trimmed) > MAX_RESUME_TEXT_CHARS:
        trimmed = trimmed[:MAX_RESUME_TEXT_CHARS]
    messages = [
        {"role": "system", "content": RESUME_PARSING_PROMPT},
        {"role": "user", "content": trimmed},
    ]
    call_start = perf_counter()
    try:
        result = await call_llm_json(messages)
    except Exception as exc:
        call_ms = (perf_counter() - call_start) * 1000
        _log_timing(
            "ai_call",
            call_ms,
            request_id,
            {"status": "error", "error": type(exc).__name__},
        )
        raise
    call_ms = (perf_counter() - call_start) * 1000
    _log_timing(
        "ai_call",
        call_ms,
        request_id,
        {"status": "ok", "input_length": len(trimmed)},
    )
    _log_timing("parse_resume_total", call_ms, request_id)
    if not isinstance(result, dict):
        raise ValueError("模型返回的结果格式不正确。")
    return result


async def fetch_existing_experiences(
    session: AsyncSession, user_id: str
) -> List[ExistingExperience]:
    results: List[ExistingExperience] = []
    offset = 0
    while True:
        batch = await _list_active_experiences(session, user_id, MAX_LIMIT, offset)
        if not batch:
            break
        for master, version in batch:
            if not version:
                continue
            results.append(
                ExistingExperience(
                    category=master.category,
                    title=version.title,
                    org=version.org or "",
                )
            )
        if len(batch) < MAX_LIMIT:
            break
        offset += MAX_LIMIT
    return results


async def _list_active_experiences(
    session: AsyncSession, user_id: str, limit: int, offset: int
) -> List[Tuple[MasterExperience, Optional[ExperienceVersion]]]:
    statement = (
        select(MasterExperience, ExperienceVersion)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == MasterExperience.latest_version_id,
            isouter=True,
        )
        .where(
            MasterExperience.user_id == user_id,
            MasterExperience.is_archived.is_(False),
        )
        .order_by(desc(MasterExperience.updated_at))
        .limit(limit)
        .offset(offset)
    )
    result = await session.execute(statement)
    return list(result.all())


def _build_duplicate_index(
    entries: Iterable[ExistingExperience],
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
    existing_entries: Iterable[ExistingExperience],
) -> List[ParsedExperienceItem]:
    # Duplicates are detected per category by normalized (org + title) signature,
    # falling back to similarity when exact matches are not found.
    index = _build_duplicate_index(existing_entries)
    for item in items:
        signature = _build_signature(item.version.title, item.version.org)
        item.duplicate = _find_duplicate(signature, index.get(item.category))
    return items
