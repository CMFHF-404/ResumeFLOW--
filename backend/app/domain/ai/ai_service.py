import json
import logging
import re
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
from .response_normalizers import (
    DEFAULT_MATCH_SCORE,
    RESUME_SKILLS_KEY,
    _clamp_match_score,
    _extract_json_payload,
    _hash_text,
    _normalize_greeting_result,
    _normalize_match_entries,
    _normalize_summary_result,
    _parse_json_content,
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
    _build_gemini_generation_config,
    _call_llm,
    _emit_thought,
    _post_chat_completion,
    _stream_gemini_json_response,
)
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
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AttachmentHydrator = Optional[Callable[[List[Dict[str, Any]]], Awaitable[List[Dict[str, Any]]]]]


def _extract_message(response_data: Dict[str, Any]) -> Dict[str, Any]:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    return message


async def _call_llm_with_tools(
    messages: List[Dict[str, Any]],
    *,
    tools: List[Dict[str, Any]],
    tool_executor: Callable[[str, Dict[str, Any]], Dict[str, Any]],
    json_mode: bool = True,
) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
        "tools": tools,
        "tool_choice": "auto",
    }
    try:
        data = await _post_chat_completion(payload)
        message = _extract_message(data)
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            follow_up_messages = [*messages, message]
            for tool_call in tool_calls:
                function_call = tool_call.get("function") if isinstance(tool_call, dict) else None
                if not isinstance(function_call, dict):
                    continue
                tool_name = str(function_call.get("name") or "")
                raw_arguments = function_call.get("arguments")
                try:
                    arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) and raw_arguments.strip() else {}
                except json.JSONDecodeError:
                    arguments = {}
                tool_result = tool_executor(tool_name, arguments if isinstance(arguments, dict) else {})
                follow_up_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.get("id"),
                        "name": tool_name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )
            return await _call_llm(follow_up_messages, json_mode=json_mode)
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("LLM response missing content")
        return _parse_json_content(content) if json_mode else {"content": content}
    except Exception:
        logger.warning("[AI Tools] tool calling unavailable; falling back to standard assistant generation.", exc_info=True)
        return await _call_llm(messages, json_mode=json_mode)


def _build_assistant_context_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_selected_experience_full_text",
                "description": "Return full, untruncated STAR text for the selected experience by masterId.",
                "parameters": {
                    "type": "object",
                    "properties": {"masterId": {"type": "string"}},
                    "required": ["masterId"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_selected_resume_context",
                "description": "Return the selected resume snapshot and linked JD context available in the current assistant turn.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_bank_context",
                "description": "Return the user's experience library, certifications, skills, and profile context already loaded for this turn.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _build_assistant_context_tool_executor(
    payload: Dict[str, Any],
) -> Callable[[str, Dict[str, Any]], Dict[str, Any]]:
    def execute(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name == "get_selected_experience_full_text":
            master_id = str(arguments.get("masterId") or "").strip()
            for item in payload.get("selected_experiences") or []:
                if isinstance(item, dict) and item.get("masterId") == master_id:
                    return {"experience": item.get("full_text") or item}
            return {"experience": None}
        if tool_name == "get_selected_resume_context":
            return {"selected_resume": payload.get("selected_resume")}
        if tool_name == "get_bank_context":
            return {"bank_context": payload.get("bank_context")}
        return {"error": f"Unknown tool: {tool_name}"}

    return execute

async def call_llm_json(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    return await _call_llm(messages, json_mode=True)


async def polish_experience(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> Dict[str, Any]:
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
    return _normalize_polish_result(result, mode)


async def polish_experience_with_thoughts(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await polish_experience(content, target_field, jd_text, mode, custom_prompt)

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
        return _normalize_polish_result(result, mode)
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for star_polish, falling back to standard polish.",
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
    if _normalize_assistant_skill_id(skill_id):
        result = await _call_llm_with_tools(
            messages,
            tools=_build_assistant_context_tools(),
            tool_executor=_build_assistant_context_tool_executor(payload),
            json_mode=True,
        )
    else:
        result = await _call_llm(messages, json_mode=True)
    return _normalize_assistant_result(result, skill_id=skill_id)


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
    thought_callback: ThoughtCallback = None,
    attachment_hydrator: AttachmentHydrator = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
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
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for assistant_%s, falling back to standard assistant turn.",
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
            attachment_hydrator=attachment_hydrator,
        )
    return _normalize_assistant_result(result, skill_id=skill_id)


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

    if not settings.gemini_api_key:
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
            "[AI Stream] Gemini thought streaming failed for boss_greeting, falling back to standard generation.",
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
    if not settings.gemini_api_key:
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
            "[AI Stream] Gemini thought streaming failed for personal_summary, falling back to standard generation.",
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

