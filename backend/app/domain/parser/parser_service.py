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
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import MAX_LIMIT
from ...models import ExperienceCategory
from ..ai.ai_service import call_llm_json
from ..experience.experience_service import list_experiences
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


def build_resume_items(payload: Dict[str, Any]) -> List[ParsedExperienceItem]:
    items: List[ParsedExperienceItem] = []
    for entry in _ensure_list(payload.get("work_experiences")):
        if isinstance(entry, dict):
            items.append(_build_item(ExperienceCategory.WORK, _build_work_version(entry)))
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
        batch = await list_experiences(session, user_id, None, None, MAX_LIMIT, offset)
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
