import asyncio
import hashlib
import logging
import json
import re
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ...config import load_settings
from .assistant_action_utils import (
    ASSISTANT_ACTION_INLINE_ORDERED_PATTERN,
    ASSISTANT_ACTION_INLINE_ORDERED_SPLIT_PATTERN,
    ASSISTANT_ACTION_ORDERED_LINE_PATTERN,
    ASSISTANT_ACTION_ORDERED_PREFIX_PATTERN,
    ASSISTANT_ACTION_UNORDERED_LINE_PATTERN,
    ASSISTANT_ACTION_UNORDERED_PREFIX_PATTERN,
    ASSISTANT_PLAIN_ITALIC_MARKDOWN_PATTERN,
    _is_likely_ordered_action_line,
    _is_likely_unordered_action_line,
    _is_plain_italic_markdown,
    _normalize_assistant_action_text,
    _normalize_assistant_draft_card,
    _split_inline_ordered_action_lines,
    _strip_action_list_prefix,
)
from .assistant_context import (
    MAX_SELECTED_EXPERIENCE_STAR_CHARS,
    MAX_SELECTED_EXPERIENCE_SUMMARY_CHARS,
    MAX_SELECTED_EXPERIENCE_TEXT_CHARS,
    MAX_SELECTED_EXPERIENCES,
    MAX_SELECTED_RESUME_CERTIFICATIONS,
    MAX_SELECTED_RESUME_EDUCATIONS,
    MAX_SELECTED_RESUME_EXPERIENCES,
    MAX_SELECTED_RESUME_ID_CHARS,
    MAX_SELECTED_RESUME_JD_CONTEXT_CHARS,
    MAX_SELECTED_RESUME_NAME_CHARS,
    MAX_SELECTED_RESUME_SKILLS,
    VALID_SELECTED_EXPERIENCE_CATEGORIES,
    _clip_optional_text,
    _normalize_selected_experience_item,
    _normalize_selected_experiences,
    _normalize_selected_resume,
    _normalize_selected_resume_certification_item,
    _normalize_selected_resume_education_item,
    _normalize_selected_resume_experience_item,
    _normalize_selected_resume_skill_item,
    _normalize_selected_resume_snapshot,
)
from .assistant_attachments import (
    MAX_ASSISTANT_REUSED_ATTACHMENTS,
    _attachment_signature,
    _build_assistant_attachment_context,
    _build_assistant_user_message,
    _build_assistant_user_parts,
    _collect_history_attachments,
    _complete_multi_attachment_selection,
    _infer_requested_attachment_count,
    _message_explicitly_references_attachment,
    _message_is_attachment_follow_up,
    _message_is_short_transformation_command,
    _message_references_attachment_generically,
    _message_requests_multi_attachment_context,
    _message_uses_relative_attachment_reference,
    _normalize_assistant_history,
    _read_attachment_image_payload,
    _resolve_relative_attachment_reference,
    _resolve_relevant_attachments,
    _unique_attachments,
)
from .assistant_turn_utils import (
    ASSISTANT_SKILL_PROMPTS,
    MAX_ASSISTANT_FOLLOWUP_LABEL_CHARS,
    MAX_ASSISTANT_FOLLOWUP_PROMPT_CHARS,
    MAX_ASSISTANT_SUGGESTED_FOLLOWUPS,
    SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS,
    _build_assistant_payload,
    _get_assistant_prompt,
    _is_off_scope_smart_complete_question,
    _normalize_assistant_result,
    _normalize_assistant_skill_id,
    _normalize_assistant_suggested_followups,
)
from .assistant_tool_utils import (
    _build_assistant_context_tool_executor,
    _build_assistant_context_tools,
    _call_llm_with_tools,
    _extract_message,
)
from .response_normalizers import (
    DEFAULT_MATCH_SCORE,
    RESUME_SKILLS_KEY,
    _clamp_match_score,
    _extract_json_payload,
    _hash_text,
    _normalize_greeting_result,
    _normalize_match_entries,
    _normalize_summary_result,
    _safe_parse_resume_payload,
    _strip_json_wrappers,
    _summarize_text,
)
from .star_polish_utils import (
    MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS,
    _build_polish_prompt,
    _normalize_polish_result,
    _normalize_smart_complete_polish_result,
    _resolve_star_prompt,
)
from .llm_transport import (
    AI_ROUTE_PROFILE_QWEN,
    _build_gemini_generation_config,
    _call_llm,
    _emit_thought,
    _stream_gemini_json_response,
)
from .assistant_link_preservation import preserve_assistant_result_star_links
from .jd_analysis_service import (
    analyze_jd,
    analyze_jd_with_image,
    analyze_jd_with_image_thoughts,
    analyze_jd_with_thoughts,
)
from .prompts import (
    CERTIFICATION_ASSISTANT_PROMPT,
    EXPERIENCE_ASSISTANT_PROMPT,
    GENERAL_ASSISTANT_PROMPT,
    BOSS_GREETING_GENERATION,
    PERSONAL_SUMMARY_GENERATION,
    SKILL_ASSISTANT_PROMPT,
    STAR_SPLIT_ONLY,
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AssistantTextCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AttachmentHydrator = Optional[Callable[[List[Dict[str, Any]]], Awaitable[List[Dict[str, Any]]]]]
SPLIT_EXPERIENCE_TEXT_CACHE_VERSION = "split-experience-text-v1"
SPLIT_EXPERIENCE_TEXT_CACHE_MAX_ENTRIES = 128
SPLIT_HINT_SEPARATOR_PATTERN = re.compile(r"^\s*-{2,}\s*$")
_SPLIT_EXPERIENCE_TEXT_CACHE: "OrderedDict[str, Dict[str, str]]" = OrderedDict()
_SPLIT_EXPERIENCE_TEXT_IN_FLIGHT: Dict[str, asyncio.Task[Dict[str, str]]] = {}


def _has_thinking_stream_provider() -> bool:
    ai_model = str(getattr(settings, "ai_model", "") or "").strip().lower()
    route_profile = str(getattr(settings, "ai_route_profile", "") or "").strip().lower()
    has_qwen = (
        route_profile == AI_ROUTE_PROFILE_QWEN
        and bool(getattr(settings, "ai_api_key", None))
        and ai_model.startswith("qwen")
    )
    return has_qwen or bool(getattr(settings, "gemini_api_key", None))


async def call_llm_json(
    messages: List[Dict[str, Any]],
    model: Optional[str] = None,
    *,
    lane: str = "default",
    request_label: str = "chat_completion",
) -> Dict[str, Any]:
    return await _call_llm(
        messages,
        json_mode=True,
        model=model,
        lane=lane,
        request_label=request_label,
    )


async def polish_experience(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    has_jd_text = bool(jd_text and jd_text.strip())
    prompt = _build_polish_prompt(target_field, mode, jd_text, custom_prompt)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    if mode:
        content_payload["polish_mode"] = mode
    if custom_prompt:
        content_payload["custom_prompt"] = custom_prompt
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(content_payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_polish_result(result, mode, has_jd_text=has_jd_text)


def _normalize_split_experience_result(result: Dict[str, Any]) -> Dict[str, str]:
    normalized: Dict[str, str] = {}
    for key in ("s", "t", "a", "r"):
        value = result.get(key)
        if not isinstance(value, str):
            normalized[key] = ""
            continue
        lines = [
            line.strip()
            for line in value.splitlines()
            if line.strip() and not SPLIT_HINT_SEPARATOR_PATTERN.match(line)
        ]
        normalized[key] = "\n".join(lines)
    return normalized


def clear_split_experience_text_cache() -> None:
    _SPLIT_EXPERIENCE_TEXT_CACHE.clear()
    _SPLIT_EXPERIENCE_TEXT_IN_FLIGHT.clear()


def _clone_split_experience_result(result: Dict[str, str]) -> Dict[str, str]:
    return {key: result.get(key, "") for key in ("s", "t", "a", "r")}


def _build_split_experience_text_cache_key(
    raw_text: str,
    category: str,
    org: Optional[str],
    title: Optional[str],
) -> str:
    payload = {
        "version": SPLIT_EXPERIENCE_TEXT_CACHE_VERSION,
        "model": settings.ai_model,
        "prompt": hashlib.sha256(STAR_SPLIT_ONLY.encode("utf-8")).hexdigest(),
        "raw_text": raw_text,
        "category": category,
        "org": org or "",
        "title": title or "",
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _get_cached_split_experience_text(cache_key: str) -> Optional[Dict[str, str]]:
    cached = _SPLIT_EXPERIENCE_TEXT_CACHE.get(cache_key)
    if cached is None:
        return None
    _SPLIT_EXPERIENCE_TEXT_CACHE.move_to_end(cache_key)
    return _clone_split_experience_result(cached)


def _store_cached_split_experience_text(cache_key: str, result: Dict[str, str]) -> None:
    _SPLIT_EXPERIENCE_TEXT_CACHE[cache_key] = _clone_split_experience_result(result)
    _SPLIT_EXPERIENCE_TEXT_CACHE.move_to_end(cache_key)
    while len(_SPLIT_EXPERIENCE_TEXT_CACHE) > SPLIT_EXPERIENCE_TEXT_CACHE_MAX_ENTRIES:
        _SPLIT_EXPERIENCE_TEXT_CACHE.popitem(last=False)


async def _split_experience_text_uncached(
    raw_text: str,
    category: str,
    org: Optional[str] = None,
    title: Optional[str] = None,
) -> Dict[str, str]:
    messages = [
        {"role": "system", "content": STAR_SPLIT_ONLY},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "raw_text": raw_text,
                    "category": category,
                    "org": org or "",
                    "title": title or "",
                },
                ensure_ascii=False,
            ),
        },
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_split_experience_result(result)


async def split_experience_text(
    raw_text: str,
    category: str,
    org: Optional[str] = None,
    title: Optional[str] = None,
) -> Dict[str, str]:
    if not raw_text.strip():
        return {"s": "", "t": "", "a": "", "r": ""}

    cache_key = _build_split_experience_text_cache_key(raw_text, category, org, title)
    cached = _get_cached_split_experience_text(cache_key)
    if cached is not None:
        return cached

    in_flight = _SPLIT_EXPERIENCE_TEXT_IN_FLIGHT.get(cache_key)
    if in_flight is not None:
        return _clone_split_experience_result(await asyncio.shield(in_flight))

    task = asyncio.create_task(
        _split_experience_text_uncached(raw_text, category, org, title)
    )
    _SPLIT_EXPERIENCE_TEXT_IN_FLIGHT[cache_key] = task
    try:
        result = await asyncio.shield(task)
    finally:
        if _SPLIT_EXPERIENCE_TEXT_IN_FLIGHT.get(cache_key) is task:
            _SPLIT_EXPERIENCE_TEXT_IN_FLIGHT.pop(cache_key, None)
    _store_cached_split_experience_text(cache_key, result)
    return _clone_split_experience_result(result)


async def polish_experience_with_thoughts(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not _has_thinking_stream_provider():
        return await polish_experience(content, target_field, jd_text, mode, custom_prompt)

    has_jd_text = bool(jd_text and jd_text.strip())
    prompt = _build_polish_prompt(target_field, mode, jd_text, custom_prompt)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    if mode:
        content_payload["polish_mode"] = mode
    if custom_prompt:
        content_payload["custom_prompt"] = custom_prompt
    try:
        result = await _stream_gemini_json_response(
            system_prompt=prompt,
            user_parts=[
                {"text": json.dumps(content_payload, ensure_ascii=False)},
            ],
            error_message="JD 润色失败，请稍后重试。",
            request_label="star_polish",
            budget_tokens=settings.ai_thinking_budget_polish,
            thought_callback=thought_callback,
        )
        return _normalize_polish_result(result, mode, has_jd_text=has_jd_text)
    except Exception:
        logger.warning(
            "[AI Stream] thought streaming failed for star_polish, falling back to standard polish.",
            exc_info=True,
        )
        return await polish_experience(content, target_field, jd_text, mode, custom_prompt)


async def run_assistant_turn(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]] = None,
    selected_experiences: Optional[List[Dict[str, Any]]] = None,
    selected_resume: Optional[Dict[str, Any]] = None,
    skill_id: Optional[str] = None,
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    source_stars: Optional[List[Dict[str, Any]]] = None,
    assistant_text_callback: AssistantTextCallback = None,
    attachment_hydrator: AttachmentHydrator = None,
) -> Dict[str, Any]:
    resolved_attachments = _resolve_relevant_attachments(history, attachments, user_message=user_message)
    if attachment_hydrator:
        resolved_attachments = await attachment_hydrator(resolved_attachments)
    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        bank_context=bank_context,
        selected_experiences=selected_experiences,
        selected_resume=selected_resume,
        skill_id=skill_id,
        history=history,
        attachments=resolved_attachments,
    )
    messages = [
        {"role": "system", "content": _get_assistant_prompt(mode, skill_id=skill_id)},
        _build_assistant_user_message(payload, resolved_attachments),
    ]
    normalized_skill_id = _normalize_assistant_skill_id(skill_id)
    if normalized_skill_id:
        result = await _call_llm_with_tools(
            messages,
            tools=_build_assistant_context_tools(),
            tool_executor=_build_assistant_context_tool_executor(payload),
            json_mode=True,
        )
    else:
        if assistant_text_callback and _has_thinking_stream_provider():
            try:
                result = await _stream_gemini_json_response(
                    system_prompt=_get_assistant_prompt(mode, skill_id=skill_id),
                    user_parts=_build_assistant_user_parts(payload, resolved_attachments),
                    error_message="AI 助理整理失败，请稍后重试。",
                    request_label=f"assistant_{mode}",
                    budget_tokens=0,
                    assistant_text_callback=assistant_text_callback,
                    enable_thinking=False,
                )
            except Exception:
                logger.warning(
                    "[AI Stream] assistant text streaming failed for assistant_%s, falling back to standard assistant turn.",
                    mode,
                    exc_info=True,
                )
                result = await _call_llm(messages, json_mode=True)
        else:
            result = await _call_llm(messages, json_mode=True)
    normalized = _normalize_assistant_result(result, skill_id=skill_id)
    return preserve_assistant_result_star_links(normalized, source_stars)


async def run_assistant_turn_with_thoughts(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]] = None,
    selected_experiences: Optional[List[Dict[str, Any]]] = None,
    selected_resume: Optional[Dict[str, Any]] = None,
    skill_id: Optional[str] = None,
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    source_stars: Optional[List[Dict[str, Any]]] = None,
    thought_callback: ThoughtCallback = None,
    assistant_text_callback: AssistantTextCallback = None,
    attachment_hydrator: AttachmentHydrator = None,
) -> Dict[str, Any]:
    if not _has_thinking_stream_provider():
        await _emit_thought(
            thought_callback,
            {"type": "thought", "summary": "正在整理上下文并生成回复"},
        )
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            bank_context=bank_context,
            selected_experiences=selected_experiences,
            selected_resume=selected_resume,
            skill_id=skill_id,
            history=history,
            attachments=attachments,
            source_stars=source_stars,
            attachment_hydrator=attachment_hydrator,
        )

    resolved_attachments = _resolve_relevant_attachments(history, attachments, user_message=user_message)
    if attachment_hydrator:
        resolved_attachments = await attachment_hydrator(resolved_attachments)
    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        bank_context=bank_context,
        selected_experiences=selected_experiences,
        selected_resume=selected_resume,
        skill_id=skill_id,
        history=history,
        attachments=resolved_attachments,
        include_selected_experience_full_text=False,
        preserve_selected_experience_star_text=True,
    )
    await _emit_thought(
        thought_callback,
        {"type": "thought", "summary": "正在分析上下文并组织回复"},
    )
    try:
        result = await _stream_gemini_json_response(
            system_prompt=_get_assistant_prompt(mode, skill_id=skill_id),
            user_parts=_build_assistant_user_parts(payload, resolved_attachments),
            error_message="AI 助理整理失败，请稍后重试。",
            request_label=f"assistant_{mode}",
            budget_tokens=settings.ai_thinking_budget_polish,
            thought_callback=thought_callback,
            assistant_text_callback=assistant_text_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] thought streaming failed for assistant_%s, falling back to standard assistant turn.",
            mode,
            exc_info=True,
        )
        await _emit_thought(
            thought_callback,
            {"type": "thought", "summary": "实时思考流不可用，正在切换为标准生成"},
        )
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            bank_context=bank_context,
            selected_experiences=selected_experiences,
            selected_resume=selected_resume,
            skill_id=skill_id,
            history=history,
            attachments=attachments,
            source_stars=source_stars,
            attachment_hydrator=attachment_hydrator,
        )
    normalized = _normalize_assistant_result(result, skill_id=skill_id)
    return preserve_assistant_result_star_links(normalized, source_stars)


async def generate_tags(text: str) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": TAG_GENERATION},
        {"role": "user", "content": text},
    ]
    return await _call_llm(messages, json_mode=True)


async def generate_boss_greeting(
    jd_text: str,
    analysis_summary: str,
    job_title: Optional[str] = None,
    company: Optional[str] = None,
    resume_text: Optional[str] = None,
) -> Dict[str, Any]:
    resume_payload = _safe_parse_resume_payload(resume_text) or {}
    payload = {
        "jd_text": jd_text,
        "analysis_summary": analysis_summary,
        "job_title": job_title or "",
        "company": company or "",
        "resume_text": resume_payload,
    }
    messages = [
        {"role": "system", "content": BOSS_GREETING_GENERATION},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_greeting_result(result)


async def generate_boss_greeting_with_thoughts(
    jd_text: str,
    analysis_summary: str,
    job_title: Optional[str] = None,
    company: Optional[str] = None,
    resume_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if settings.ai_thinking_budget_boss_greeting <= 0:
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )

    if not _has_thinking_stream_provider():
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )

    resume_payload = _safe_parse_resume_payload(resume_text) or {}
    payload = {
        "jd_text": jd_text,
        "analysis_summary": analysis_summary,
        "job_title": job_title or "",
        "company": company or "",
        "resume_text": resume_payload,
    }
    try:
        result = await _stream_gemini_json_response(
            system_prompt=BOSS_GREETING_GENERATION,
            user_parts=[{"text": json.dumps(payload, ensure_ascii=False)}],
            error_message="BOSS 招呼语生成失败，请稍后重试。",
            request_label="boss_greeting",
            budget_tokens=settings.ai_thinking_budget_boss_greeting,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] thought streaming failed for boss_greeting, falling back to standard generation.",
            exc_info=True,
        )
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )
    return _normalize_greeting_result(result)


async def generate_personal_summary(
    mode: str,
    profile: Optional[Dict[str, Any]] = None,
    work_experiences: Optional[List[Dict[str, Any]]] = None,
    project_experiences: Optional[List[Dict[str, Any]]] = None,
    education_experiences: Optional[List[Dict[str, Any]]] = None,
    certifications: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    jd_text: Optional[str] = None,
    polish_level: Optional[str] = None,
) -> Dict[str, Any]:
    payload = {
        "mode": mode,
        "profile": profile or {},
        "work_experiences": work_experiences or [],
        "project_experiences": project_experiences or [],
        "education_experiences": education_experiences or [],
        "certifications": certifications or [],
        "skills": skills or [],
        "jd_text": jd_text or "",
        "polish_level": polish_level or "标准",
    }
    messages = [
        {"role": "system", "content": PERSONAL_SUMMARY_GENERATION},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_summary_result(result)


async def generate_personal_summary_with_thoughts(
    mode: str,
    profile: Optional[Dict[str, Any]] = None,
    work_experiences: Optional[List[Dict[str, Any]]] = None,
    project_experiences: Optional[List[Dict[str, Any]]] = None,
    education_experiences: Optional[List[Dict[str, Any]]] = None,
    certifications: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    jd_text: Optional[str] = None,
    polish_level: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not _has_thinking_stream_provider():
        return await generate_personal_summary(
            mode=mode,
            profile=profile,
            work_experiences=work_experiences,
            project_experiences=project_experiences,
            education_experiences=education_experiences,
            certifications=certifications,
            skills=skills,
            jd_text=jd_text,
            polish_level=polish_level,
        )

    payload = {
        "mode": mode,
        "profile": profile or {},
        "work_experiences": work_experiences or [],
        "project_experiences": project_experiences or [],
        "education_experiences": education_experiences or [],
        "certifications": certifications or [],
        "skills": skills or [],
        "jd_text": jd_text or "",
        "polish_level": polish_level or "标准",
    }
    try:
        result = await _stream_gemini_json_response(
            system_prompt=PERSONAL_SUMMARY_GENERATION,
            user_parts=[{"text": json.dumps(payload, ensure_ascii=False)}],
            error_message="个人评价生成失败，请稍后重试。",
            request_label="personal_summary",
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] thought streaming failed for personal_summary, falling back to standard generation.",
            exc_info=True,
        )
        return await generate_personal_summary(
            mode=mode,
            profile=profile,
            work_experiences=work_experiences,
            project_experiences=project_experiences,
            education_experiences=education_experiences,
            certifications=certifications,
            skills=skills,
            jd_text=jd_text,
            polish_level=polish_level,
        )
    return _normalize_summary_result(result)

