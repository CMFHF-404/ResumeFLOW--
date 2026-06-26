from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
import inspect
import json
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from time import perf_counter
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import load_settings
from ...constants import MAX_LIMIT
from ...models import ExperienceCategory, ExperienceVersion, MasterExperience
from ..ai.ai_service import call_llm_json
from ..ai.llm_transport import (
    AI_ROUTE_PROFILE_QWEN,
    LANE_RESUME_PARSE,
    _stream_gemini_json_response as _stream_thinking_json_response,
)
from .chunking import (
    _chunk_paragraphs,
    _chunk_units,
    _hard_split_text,
    _merge_small_chunks,
    _normalize_text,
    _should_use_chunking,
    _split_into_paragraphs,
    _split_long_paragraph,
    _split_resume_text,
)
from .duplicate_detection import (
    DUPLICATE_SIMILARITY_THRESHOLD,
    _build_duplicate_index,
    _build_signature,
    _find_duplicate,
    _similarity,
    apply_duplicate_flags,
)
from .document_text import (
    MAX_ATTACHMENT_BYTES,
    MAX_RESUME_TEXT_CHARS,
    MIN_MEANINGFUL_TEXT_CHARS,
    MIN_TEXT_LENGTH,
    SUPPORTED_DOCX_TYPES,
    SUPPORTED_EXTENSIONS,
    SUPPORTED_PDF_TYPES,
    UNREADABLE_RESUME_TEXT_ERROR,
    _count_meaningful_text_chars,
    _ensure_attachment_size_limit,
    _extract_docx_text,
    _extract_pdf_text,
    _prepare_resume_text,
    _resolve_file_kind,
    _resolve_file_kind_from_metadata,
    _resolve_file_mime,
    extract_resume_text,
    extract_text,
)
from . import thinking_transport
from .thinking_transport import (
    GEMINI_CONNECT_TIMEOUT_SECONDS,
    GEMINI_POOL_TIMEOUT_SECONDS,
    THOUGHT_PAYLOAD_TIMEOUT_SECONDS,
)
from .payload_normalization import (
    DEFAULT_EDU_ORG,
    DEFAULT_EDU_TITLE,
    DEFAULT_SKILL_CATEGORY,
    DEFAULT_WORK_ORG,
    DEFAULT_WORK_TITLE,
    PERSONAL_INFO_FIELDS,
    PRESENT_MARKERS,
    PROJECT_KEYWORDS,
    PROJECT_MIN_SCORE,
    PROJECT_NAME_HINTS,
    PROJECT_ROLE_HINTS,
    PROJECT_TITLE_HINTS,
    WORK_KEYWORDS,
    WORK_ORG_HINTS,
    _build_education_version,
    _build_item,
    _build_project_version,
    _build_star_payload,
    _build_work_version,
    _clean_inline_text,
    _clean_multiline_text,
    _collect_entry_text,
    _contains_any,
    _count_keyword_hits,
    _dedupe_entries,
    _ensure_list,
    _ensure_optional_str,
    _ensure_str,
    _entry_score,
    _entry_signature,
    _extract_dict_entries,
    _infer_experience_category,
    _is_present_marker,
    _join_text_parts,
    _merge_personal_info,
    _normalize_certification_entry,
    _normalize_courses,
    _normalize_date,
    _normalize_personal_links,
    _normalize_personal_value,
    _normalize_project_entry,
    _normalize_skill_category,
    _normalize_skill_tags,
    _normalize_star_field,
    _normalize_text_list,
    _resolve_action_text,
    _should_swap_project_fields,
    _split_work_and_project_entries,
    build_resume_items,
    normalize_certifications,
    normalize_personal_info,
    normalize_skill_groups,
)
from .prompts import RESUME_CHUNK_PARSING_PROMPT, RESUME_MERGE_PROMPT, RESUME_PARSING_PROMPT
from .schemas import DuplicateMatch, ParsedExperienceItem, ParsedExperienceVersion

logger = logging.getLogger(__name__)
settings = load_settings()

LONG_RESUME_TEXT_THRESHOLD = 6_000
CHUNK_MAX_CHARS = 3_200
CHUNK_MIN_CHARS = 800
MAX_MERGE_PAYLOAD_CHARS = 10_000
DUPLICATE_SIMILARITY_THRESHOLD = 0.86
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
PARA_SPLIT_PATTERN = re.compile(r"\n\s*\n+")
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[。！？!?;；.])\s+")
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
LOG_WARN_THRESHOLDS_MS = {
    "read_file": 3_000,
    "parse_pdf": 8_000,
    "parse_docx": 5_000,
    "encode_file": 8_000,
    "ai_call": 20_000,
    "parse_resume_total": 25_000,
}
PARSE_CACHE_MAX_ENTRIES = 64
PARSE_CHUNK_CONCURRENCY = 3
PARSE_CACHE_VERSION = "resume-parser-v3"
ParseProgressCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]]
ThoughtCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]]
_PARSE_RESULT_CACHE: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


@dataclass(frozen=True)
class ExistingExperience:
    id: str
    category: ExperienceCategory
    title: str
    org: str


def clear_parse_cache() -> None:
    _PARSE_RESULT_CACHE.clear()


def _clone_parse_result(payload: Dict[str, Any]) -> Dict[str, Any]:
    return copy.deepcopy(payload)


def _prompt_signature() -> str:
    content = "\n".join(
        [
            PARSE_CACHE_VERSION,
            RESUME_PARSING_PROMPT,
            RESUME_CHUNK_PARSING_PROMPT,
            RESUME_MERGE_PROMPT,
        ]
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _has_qwen_thinking_provider() -> bool:
    ai_model = str(getattr(settings, "ai_model", "") or "").strip().lower()
    route_profile = str(getattr(settings, "ai_route_profile", "") or "").strip().lower()
    return (
        route_profile == AI_ROUTE_PROFILE_QWEN
        and bool(getattr(settings, "ai_api_key", None))
        and ai_model.startswith("qwen")
    )


def _has_thinking_stream_provider() -> bool:
    return _has_qwen_thinking_provider() or bool(getattr(settings, "gemini_api_key", None))


def _resolve_thinking_model_name() -> str:
    if _has_qwen_thinking_provider():
        return str(getattr(settings, "ai_model", "") or "")
    return str(getattr(settings, "gemini_model", "") or getattr(settings, "ai_model", ""))


def _resolve_standard_parse_model_name() -> str:
    return str(getattr(settings, "ai_fast_model", None) or getattr(settings, "ai_model", ""))


def _build_parse_cache_key(
    file_data: bytes,
    filename: str,
    file_mime_type: str,
    parser_mode: str,
) -> str:
    file_hash = hashlib.sha256(file_data).hexdigest()
    model = (
        _resolve_thinking_model_name()
        if parser_mode == "thinking"
        else _resolve_standard_parse_model_name()
    )
    payload = {
        "version": PARSE_CACHE_VERSION,
        "file_hash": file_hash,
        "filename": filename or "",
        "mime_type": file_mime_type or "",
        "mode": parser_mode,
        "model": model,
        "prompt": _prompt_signature(),
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _get_cached_parse_result(
    cache_key: str,
    request_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    cached = _PARSE_RESULT_CACHE.get(cache_key)
    if cached is None:
        return None
    _PARSE_RESULT_CACHE.move_to_end(cache_key)
    _log_timing("parse_cache", 0, request_id, {"status": "hit"})
    return _clone_parse_result(cached)


def _store_cached_parse_result(
    cache_key: str,
    payload: Dict[str, Any],
    request_id: Optional[str],
) -> None:
    _PARSE_RESULT_CACHE[cache_key] = _clone_parse_result(payload)
    _PARSE_RESULT_CACHE.move_to_end(cache_key)
    while len(_PARSE_RESULT_CACHE) > PARSE_CACHE_MAX_ENTRIES:
        _PARSE_RESULT_CACHE.popitem(last=False)
    _log_timing("parse_cache", 0, request_id, {"status": "stored"})


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


def _build_resume_messages(prompt: str, content: str) -> List[Dict[str, Any]]:
    return [
        {"role": "system", "content": prompt},
        {"role": "user", "content": content},
    ]


def _encode_upload_data(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _build_resume_attachment_messages(
    prompt: str,
    filename: str,
    mime_type: str,
    encoded_file: str,
) -> List[Dict[str, Any]]:
    data_url = f"data:{mime_type};base64,{encoded_file}"
    return [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "请直接解析附件简历，并严格按 JSON schema 返回。"
                        f"文件名：{filename or 'resume'}"
                    ),
                },
                {
                    "type": "file_url",
                    "file_url": {"url": data_url},
                },
            ],
        },
    ]


async def _emit_progress(
    progress_callback: ParseProgressCallback,
    payload: Dict[str, Any],
) -> None:
    if not progress_callback:
        return
    result = progress_callback(payload)
    if inspect.isawaitable(result):
        await result


async def _emit_thought(
    thought_callback: ThoughtCallback,
    payload: Dict[str, Any],
) -> None:
    if not thought_callback:
        return
    result = thought_callback(payload)
    if inspect.isawaitable(result):
        await result


def _build_gemini_headers() -> Dict[str, str]:
    return thinking_transport._build_gemini_headers(settings)


def _build_gemini_stream_url(model: str) -> str:
    return thinking_transport._build_gemini_stream_url(settings, model)


def _build_gemini_timeout() -> httpx.Timeout:
    return thinking_transport._build_gemini_timeout(settings)


def _build_gemini_payload_timeout_seconds() -> float:
    return thinking_transport._build_gemini_payload_timeout_seconds(
        settings,
        THOUGHT_PAYLOAD_TIMEOUT_SECONDS,
    )


def _build_resume_thinking_request(cleaned_text: str) -> Dict[str, Any]:
    return thinking_transport._build_resume_thinking_request(
        cleaned_text,
        RESUME_PARSING_PROMPT,
    )


async def _iter_sse_json_payloads(response: httpx.Response):
    async for payload in thinking_transport._iter_sse_json_payloads(response):
        yield payload


async def _stream_resume_thinking_parse(
    cleaned_text: str,
    request_id: Optional[str],
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if _has_qwen_thinking_provider():
        call_start = perf_counter()
        result = await _stream_thinking_json_response(
            system_prompt=RESUME_PARSING_PROMPT,
            user_parts=[
                {
                    "text": (
                        "请解析以下简历正文，并严格输出 JSON。"
                        "不要补充正文中不存在的信息。\n\n"
                        f"{cleaned_text}"
                    )
                }
            ],
            error_message="AI 深度解析失败，请稍后重试。",
            request_label="resume_parse",
            thought_callback=thought_callback,
        )
        call_ms = (perf_counter() - call_start) * 1000
        _log_timing(
            "ai_call",
            call_ms,
            request_id,
            {
                "mode": "qwen_thinking",
                "input_length": len(cleaned_text),
            },
        )
        return _normalize_parse_result(result)

    return await thinking_transport.stream_resume_thinking_parse(
        cleaned_text=cleaned_text,
        request_id=request_id,
        thought_callback=thought_callback,
        settings=settings,
        request_body=_build_resume_thinking_request(cleaned_text),
        build_headers=_build_gemini_headers,
        build_stream_url=_build_gemini_stream_url,
        build_timeout=_build_gemini_timeout,
        build_payload_timeout_seconds=_build_gemini_payload_timeout_seconds,
        iter_sse_json_payloads=_iter_sse_json_payloads,
        emit_thought=_emit_thought,
        parse_structured_response_text=_parse_structured_response_text,
        normalize_parse_result=_normalize_parse_result,
        log_timing=_log_timing,
        httpx_module=httpx,
    )


async def _call_resume_llm(
    messages: List[Dict[str, Any]],
    request_id: Optional[str],
    step: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    call_start = perf_counter()
    model = _resolve_standard_parse_model_name()
    try:
        result = await call_llm_json(
            messages,
            model=model,
            lane=LANE_RESUME_PARSE,
            request_label=step,
        )
    except Exception as exc:
        call_ms = (perf_counter() - call_start) * 1000
        payload = {"status": "error", "error": type(exc).__name__}
        if extra:
            payload.update(extra)
        _log_timing(step, call_ms, request_id, payload)
        raise
    call_ms = (perf_counter() - call_start) * 1000
    payload = {"status": "ok", "model": model}
    if extra:
        payload.update(extra)
    _log_timing(step, call_ms, request_id, payload)
    return result


def _parse_structured_response_text(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("模型返回内容为空。")
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("模型返回的结构化内容不是合法 JSON。")
        try:
            parsed = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError("模型返回的结构化内容不是合法 JSON。") from exc
    if not isinstance(parsed, dict):
        raise ValueError("模型返回的结构化内容格式不正确。")
    return parsed


def _normalize_parse_result(result: Any) -> Dict[str, Any]:
    if not isinstance(result, dict):
        raise ValueError("模型返回的结果格式不正确。")
    return result


def _merge_chunk_results(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {
        "work_experiences": [],
        "project_experiences": [],
        "education": [],
        "certifications": [],
        "skills": [],
    }
    personal_info = _merge_personal_info(results)
    if personal_info:
        merged["personal_info"] = personal_info
    for result in results:
        merged["work_experiences"].extend(
            _extract_dict_entries(result.get("work_experiences"))
        )
        merged["project_experiences"].extend(
            _extract_dict_entries(result.get("project_experiences"))
        )
        merged["education"].extend(
            _extract_dict_entries(result.get("education"))
        )
        merged["certifications"].extend(
            _extract_dict_entries(result.get("certifications"))
        )
        merged["skills"].extend(
            _extract_dict_entries(result.get("skills"))
        )
    merged["work_experiences"] = _dedupe_entries(
        merged["work_experiences"],
        ("title", "org", "start_date", "end_date"),
    )
    merged["project_experiences"] = _dedupe_entries(
        merged["project_experiences"],
        ("title", "org", "start_date", "end_date"),
    )
    merged["education"] = _dedupe_entries(
        merged["education"],
        ("school", "major", "degree", "start_date", "end_date"),
    )
    merged["certifications"] = normalize_certifications(merged)
    merged["skills"] = normalize_skill_groups(merged)
    return merged


async def _merge_with_llm(
    draft: Dict[str, Any], request_id: Optional[str]
) -> Dict[str, Any]:
    payload = json.dumps(draft, ensure_ascii=False)
    if len(payload) > MAX_MERGE_PAYLOAD_CHARS:
        return draft
    messages = _build_resume_messages(RESUME_MERGE_PROMPT, payload)
    try:
        result = await _call_resume_llm(
            messages,
            request_id,
            "ai_merge_call",
            {"input_length": len(payload)},
        )
    except Exception:
        return draft
    if not isinstance(result, dict):
        return draft
    return result


async def _parse_resume_single(
    text: str, request_id: Optional[str]
) -> Dict[str, Any]:
    trimmed = text
    if len(trimmed) > MAX_RESUME_TEXT_CHARS:
        trimmed = trimmed[:MAX_RESUME_TEXT_CHARS]
    messages = _build_resume_messages(RESUME_PARSING_PROMPT, trimmed)
    result = await _call_resume_llm(
        messages,
        request_id,
        "ai_call",
        {"input_length": len(trimmed)},
    )
    return _normalize_parse_result(result)


async def _parse_resume_chunked(
    text: str, request_id: Optional[str]
) -> Dict[str, Any]:
    chunks = _split_resume_text(text)
    semaphore = asyncio.Semaphore(PARSE_CHUNK_CONCURRENCY)

    async def parse_chunk(index: int, chunk: str) -> Optional[Tuple[int, Dict[str, Any]]]:
        messages = _build_resume_messages(RESUME_CHUNK_PARSING_PROMPT, chunk)
        try:
            async with semaphore:
                result = await _call_resume_llm(
                    messages,
                    request_id,
                    "ai_chunk_call",
                    {
                        "chunk_index": index + 1,
                        "chunk_total": len(chunks),
                        "input_length": len(chunk),
                    },
                )
        except Exception:
            return None
        if not isinstance(result, dict):
            return None
        return index, result

    chunk_outputs = await asyncio.gather(
        *(parse_chunk(index, chunk) for index, chunk in enumerate(chunks))
    )
    chunk_results = [
        result
        for _index, result in sorted(
            [item for item in chunk_outputs if item is not None],
            key=lambda item: item[0],
        )
    ]
    if not chunk_results:
        return await _parse_resume_single(text, request_id)
    draft = _merge_chunk_results(chunk_results)
    merged = await _merge_with_llm(draft, request_id)
    return _normalize_parse_result(merged)


async def _parse_resume_cached(
    *,
    file_data: bytes,
    filename: str,
    file_mime_type: str,
    request_id: Optional[str],
    parser_mode: str,
    progress_callback: ParseProgressCallback,
    parse_cleaned: Callable[[str], Awaitable[Dict[str, Any]]],
    should_store_cache: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    if not file_data:
        raise ValueError("文件为空，无法解析。")
    _ensure_attachment_size_limit(file_data)

    cache_key = _build_parse_cache_key(
        file_data,
        filename,
        file_mime_type,
        parser_mode,
    )
    cached = _get_cached_parse_result(cache_key, request_id)
    if cached is not None:
        await _emit_progress(
            progress_callback,
            {"type": "progress", "node": "merge_result", "title": "复用解析结果"},
        )
        return cached

    await _emit_progress(
        progress_callback,
        {"type": "progress", "node": "extract_text", "title": "提取简历正文"},
    )
    cleaned = _prepare_resume_text(
        extract_resume_text(
            file_data=file_data,
            filename=filename,
            file_mime_type=file_mime_type,
            request_id=request_id,
        ),
        request_id,
    )

    if not cleaned:
        raise ValueError(UNREADABLE_RESUME_TEXT_ERROR)

    result = await parse_cleaned(cleaned)
    if should_store_cache is None or should_store_cache():
        _store_cached_parse_result(cache_key, result, request_id)
    return _clone_parse_result(result)


async def _parse_resume_from_text(
    *,
    cleaned_text: str,
    request_id: Optional[str],
    progress_callback: ParseProgressCallback = None,
) -> Dict[str, Any]:
    use_chunking = _should_use_chunking(cleaned_text)
    await _emit_progress(
        progress_callback,
        {
            "type": "progress",
            "node": "segment_resume",
            "title": "切分简历结构" if use_chunking else "构建解析上下文",
        },
    )
    await _emit_progress(
        progress_callback,
        {"type": "progress", "node": "request_ai", "title": "调用 AI 结构化解析"},
    )

    total_start = perf_counter()
    if use_chunking:
        result = await _parse_resume_chunked(cleaned_text, request_id)
        mode = "chunked"
    else:
        result = await _parse_resume_single(cleaned_text, request_id)
        mode = "single"

    await _emit_progress(
        progress_callback,
        {"type": "progress", "node": "merge_result", "title": "整理解析结果"},
    )
    total_ms = (perf_counter() - total_start) * 1000
    _log_timing(
        "parse_resume_total",
        total_ms,
        request_id,
        {"mode": mode, "input_length": len(cleaned_text)},
    )
    return _normalize_parse_result(result)


async def _parse_resume_from_attachment(
    *,
    encoded_file: str,
    filename: str,
    file_mime_type: str,
    request_id: Optional[str],
    progress_callback: ParseProgressCallback = None,
) -> Dict[str, Any]:
    await _emit_progress(
        progress_callback,
        {"type": "progress", "node": "request_ai", "title": "调用 AI 解析附件"},
    )
    total_start = perf_counter()
    messages = _build_resume_attachment_messages(
        RESUME_PARSING_PROMPT,
        filename,
        file_mime_type,
        encoded_file,
    )
    result = await _call_resume_llm(
        messages,
        request_id,
        "ai_call",
        {
            "filename": filename,
            "content_type": file_mime_type,
            "mode": "attachment",
        },
    )
    await _emit_progress(
        progress_callback,
        {"type": "progress", "node": "merge_result", "title": "整理解析结果"},
    )
    total_ms = (perf_counter() - total_start) * 1000
    _log_timing(
        "parse_resume_total",
        total_ms,
        request_id,
        {"mode": "attachment"},
    )
    return _normalize_parse_result(result)


async def parse_resume(
    file_data: bytes,
    filename: str,
    file_mime_type: str,
    request_id: Optional[str] = None,
    progress_callback: ParseProgressCallback = None,
) -> Dict[str, Any]:
    async def parse_cleaned(cleaned_text: str) -> Dict[str, Any]:
        return await _parse_resume_from_text(
            cleaned_text=cleaned_text,
            request_id=request_id,
            progress_callback=progress_callback,
        )

    return await _parse_resume_cached(
        file_data=file_data,
        filename=filename,
        file_mime_type=file_mime_type,
        request_id=request_id,
        parser_mode="standard",
        progress_callback=progress_callback,
        parse_cleaned=parse_cleaned,
    )


async def parse_resume_with_thoughts(
    file_data: bytes,
    filename: str,
    file_mime_type: str,
    request_id: Optional[str] = None,
    progress_callback: ParseProgressCallback = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    did_use_thinking_parser = False

    async def parse_cleaned(cleaned_text: str) -> Dict[str, Any]:
        nonlocal did_use_thinking_parser
        if not _has_thinking_stream_provider():
            logger.warning(
                "[ResumeParse] thinking stream provider missing, fallback to standard parser request_id=%s",
                request_id,
            )
            return await _parse_resume_from_text(
                cleaned_text=cleaned_text,
                request_id=request_id,
                progress_callback=progress_callback,
            )

        await _emit_progress(
            progress_callback,
            {"type": "progress", "node": "request_ai", "title": "调用 AI 深度解析"},
        )
        try:
            result = await _stream_resume_thinking_parse(
                cleaned_text=cleaned_text,
                request_id=request_id,
                thought_callback=thought_callback,
            )
        except Exception as exc:
            logger.warning(
                "[ResumeParse] thinking stream fallback request_id=%s error_type=%s error=%s",
                request_id,
                type(exc).__name__,
                str(exc),
            )
            await _emit_thought(thought_callback, {"type": "thought_reset"})
            return await _parse_resume_from_text(
                cleaned_text=cleaned_text,
                request_id=request_id,
                progress_callback=progress_callback,
            )
        await _emit_progress(
            progress_callback,
            {"type": "progress", "node": "merge_result", "title": "整理结构化结果"},
        )
        did_use_thinking_parser = True
        return result

    return await _parse_resume_cached(
        file_data=file_data,
        filename=filename,
        file_mime_type=file_mime_type,
        request_id=request_id,
        parser_mode="thinking",
        progress_callback=progress_callback,
        parse_cleaned=parse_cleaned,
        should_store_cache=lambda: did_use_thinking_parser,
    )


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
                    id=str(master.id),
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
