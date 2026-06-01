import inspect
import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE, HTTP_504_GATEWAY_TIMEOUT

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
from .response_normalizers import (
    DEFAULT_MATCH_SCORE,
    RESUME_SKILLS_KEY,
    _clamp_match_score,
    _ensure_skill_matches,
    _extract_json_payload,
    _extract_skill_ids,
    _hash_text,
    _normalize_greeting_result,
    _normalize_jd_analysis_result,
    _normalize_match_entries,
    _normalize_summary_result,
    _parse_json_content,
    _parse_json_content_candidates,
    _safe_parse_resume_payload,
    _strip_json_wrappers,
    _summarize_text,
)
from .prompts import (
    CERTIFICATION_ASSISTANT_PROMPT,
    EXPERIENCE_ASSISTANT_PROMPT,
    GENERAL_ASSISTANT_PROMPT,
    BOSS_GREETING_GENERATION,
    JD_ANALYSIS,
    JD_ANALYSIS_IMAGE,
    POLISH_MODE_INSTRUCTIONS,
    PERSONAL_SUMMARY_GENERATION,
    SKILL_ASSISTANT_PROMPT,
    STAR_GENERAL_REWRITE_NO_JD,
    STAR_HIGHLIGHT,
    STAR_HIGHLIGHT_NO_JD,
    STAR_POLISH,
    STAR_RESUME_READY_REWRITE,
    STAR_SMART_COMPLETE_REWRITE,
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

MAX_ERROR_BODY_LOG_LENGTH = 2000
AI_CONNECT_TIMEOUT_SECONDS = 10.0
AI_POOL_TIMEOUT_SECONDS = 10.0
GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS = 3
MAX_ASSISTANT_SUGGESTED_FOLLOWUPS = 3
MAX_ASSISTANT_FOLLOWUP_LABEL_CHARS = 16
MAX_ASSISTANT_FOLLOWUP_PROMPT_CHARS = 220
SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS = (
    "其他项目",
    "其它项目",
    "非本项目",
    "非当前项目",
    "本项目以外",
    "项目以外",
    "非该项目",
    "课程项目",
    "个人练习",
    "个人项目",
    "专业背景",
    "其他案例",
    "其它案例",
)
ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AttachmentHydrator = Optional[Callable[[List[Dict[str, Any]]], Awaitable[List[Dict[str, Any]]]]]

ASSISTANT_SKILL_PROMPTS: Dict[str, Dict[str, str]] = {
    "star_guidance": {
        "title": "STAR 引导助手",
        "prompt": (
            "Current assistant skill: STAR 引导助手. Your primary job is to guide the user to complete "
            "a factual STAR experience. First inspect selected_experiences, selected_resume, attachments, "
            "and bank_context. If information is insufficient, ask exactly one focused follow-up question "
            "about the most important missing STAR detail and set draftCard to null. Do not rush to produce "
            "a finished draft. You may return a draftCard only when the user explicitly asks for a draft, "
            "confirms the information is enough, or the supplied facts already cover S/T/A/R with concrete "
            "actions and results. When returning draftCard, follow the experience card schema exactly."
        ),
    },
    "experience_completion": {
        "title": "智能补全",
        "prompt": (
            "Current assistant skill: 智能补全. Diagnose whether the selected current STAR experience contains enough "
            "factual evidence for the target JD before rewriting. If evidence is insufficient, ask 0-3 focused Chinese "
            "questions limited to truthful, plausibly answerable facts inside this current experience only. Do not ask "
            "about other projects, course projects, personal exercises, the user's broader professional background, "
            "non-this-project cases, certifications, skills, or any experience outside the current input item. Do not "
            "create questions to fill a quota; if the current experience clearly has no relevant material for a missing "
            "JD capability, state that gap instead of asking for unrelated evidence. Do not transform technical "
            "implementation into product ownership unless the input proves product decisions, user research, MVP "
            "validation, metrics, or stakeholder work. Default draftCard to null unless the user asks to generate or save a card."
        ),
    },
    "mock_interview": {
        "title": "模拟面试教练",
        "prompt": (
            "Current assistant skill: 模拟面试教练. Act as an interviewer and coach. Use selected_resume, "
            "selected_experiences, JD context, and bank_context to generate role-fit interview questions, "
            "面试官追问, answer-improvement advice, and JD/company value gaps. draftCard must be null unless "
            "the user explicitly switches back to resume drafting. Do not output an experience card by default."
        ),
    },
}


def _normalize_assistant_skill_id(skill_id: Optional[str]) -> Optional[str]:
    if not isinstance(skill_id, str):
        return None
    normalized = skill_id.strip()
    return normalized if normalized in ASSISTANT_SKILL_PROMPTS else None


def _extract_content(response_data: Dict[str, Any]) -> str:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise ValueError("LLM response missing content")
    return content


def _build_headers() -> Dict[str, str]:
    api_key = settings.ai_api_key
    if not api_key:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_API_KEY is not configured",
        )
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _build_gemini_headers() -> Dict[str, str]:
    api_key = settings.gemini_api_key
    if not api_key:
        raise ValueError("GEMINI_API_KEY 未配置，无法返回 Gemini 实时思考节点。")
    return {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }


def _build_gemini_stream_url(model: str) -> str:
    base_url = (settings.gemini_base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("GEMINI_BASE_URL 未配置，无法调用 Gemini Thinking。")
    normalized = base_url.lower()
    if not normalized.endswith("/v1beta") and not normalized.endswith("/v1"):
        base_url = f"{base_url}/v1beta"
    return f"{base_url}/models/{model}:streamGenerateContent?alt=sse"

def _safe_response_text(response: httpx.Response) -> str:
    try:
        text = response.text
    except Exception:
        return "<failed to read response text>"
    trimmed = text.strip()
    if len(trimmed) > MAX_ERROR_BODY_LOG_LENGTH:
        return f"{trimmed[:MAX_ERROR_BODY_LOG_LENGTH]}...<truncated>"
    return trimmed


def _log_http_error(response: httpx.Response) -> None:
    logger.error(
        "AI request failed: status=%s url=%s body=%s",
        response.status_code,
        str(response.request.url) if response.request else "<unknown>",
        _safe_response_text(response),
    )

def _log_http_success(response: httpx.Response, model: str, message_count: int) -> None:
    request_id = response.headers.get("x-request-id") or response.headers.get("x-requestid")
    logger.info(
        "AI request success: url=%s model=%s messages=%s status=%s request_id=%s",
        str(response.request.url) if response.request else "<unknown>",
        model,
        message_count,
        response.status_code,
        request_id or "<none>",
    )



def _build_ai_timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=AI_CONNECT_TIMEOUT_SECONDS,
        write=float(settings.ai_timeout_seconds),
        read=float(settings.ai_timeout_seconds),
        pool=AI_POOL_TIMEOUT_SECONDS,
    )


def _build_gemini_timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=GEMINI_CONNECT_TIMEOUT_SECONDS,
        write=float(settings.ai_timeout_seconds),
        read=float(settings.ai_timeout_seconds),
        pool=GEMINI_POOL_TIMEOUT_SECONDS,
    )


async def _emit_thought(
    thought_callback: ThoughtCallback,
    payload: Dict[str, Any],
) -> None:
    if not thought_callback:
        return
    result = thought_callback(payload)
    if inspect.isawaitable(result):
        await result


async def _iter_sse_json_payloads(response: httpx.Response):
    def build_payload(lines: List[str]) -> str:
        data_lines: List[str] = []
        for item in lines:
            if not item.startswith("data:"):
                continue
            value = item[5:]
            if value.startswith(" "):
                value = value[1:]
            data_lines.append(value)
        return "\n".join(data_lines)

    event_lines: List[str] = []
    async for raw_line in response.aiter_lines():
        line = raw_line.rstrip("\r")
        if not line.strip():
            if not event_lines:
                continue
            payload = build_payload(event_lines)
            event_lines = []
            if not payload:
                continue
            if payload == "[DONE]":
                break
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("[AI Stream] invalid Gemini SSE payload: %s", payload[:500])
            continue
        event_lines.append(line)

    if event_lines:
        payload = build_payload(event_lines)
        if payload and payload != "[DONE]":
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("[AI Stream] invalid Gemini SSE trailing payload: %s", payload[:500])


def _build_gemini_generation_config(
    budget_tokens: Optional[int] = None,
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "temperature": 0.2,
        "thinkingConfig": {
            "includeThoughts": True,
        },
    }
    normalized_model = (model or "").strip().lower()
    if not normalized_model.startswith("gemini-3"):
        config["responseMimeType"] = "application/json"
    if budget_tokens is None:
        return config

    config["thinkingConfig"]["thinkingBudget"] = int(budget_tokens)
    return config


def _build_gemini_request_body(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    budget_tokens: Optional[int] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "systemInstruction": {
            "parts": [{"text": system_prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": user_parts,
            }
        ],
        "generationConfig": _build_gemini_generation_config(
            budget_tokens,
            model=model,
        ),
    }


async def _stream_gemini_json_response(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    model = settings.gemini_model
    request_body = _build_gemini_request_body(
        system_prompt=system_prompt,
        user_parts=user_parts,
        budget_tokens=budget_tokens,
        model=model,
    )
    url = _build_gemini_stream_url(model)
    answer_parts: List[str] = []
    answer_snapshots: List[str] = []

    try:
        async with httpx.AsyncClient(timeout=_build_gemini_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=_build_gemini_headers(),
                json=request_body,
            ) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body_preview = (await response.aread()).decode("utf-8", errors="ignore")[:800]
                    logger.error(
                        "[AI Stream] unexpected Gemini content-type label=%s content_type=%s body=%s",
                        request_label,
                        content_type,
                        body_preview,
                    )
                    raise ValueError(
                        "Gemini 中转站返回了非流式响应，请检查 GEMINI_BASE_URL 是否需要包含 /v1beta。"
                    )
                async for payload in _iter_sse_json_payloads(response):
                    candidates = payload.get("candidates") or []
                    if not candidates:
                        continue
                    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
                    event_answer_parts: List[str] = []
                    for part in parts:
                        text = part.get("text")
                        if not isinstance(text, str) or not text:
                            continue
                        if part.get("thought") is True:
                            await _emit_thought(
                                thought_callback,
                                {"type": "thought", "summary": text},
                            )
                            continue
                        answer_parts.append(text)
                        event_answer_parts.append(text)
                    if event_answer_parts:
                        answer_snapshots.append("".join(event_answer_parts))
    except httpx.HTTPStatusError as exc:
        try:
            await exc.response.aread()
            error_text = exc.response.text[:1000]
        except Exception:
            error_text = "Failed to read response body."
        logger.error(
            "[AI Stream] Gemini request failed label=%s status=%s body=%s",
            request_label,
            exc.response.status_code,
            error_text,
        )
        raise ValueError(error_message) from exc
    except httpx.TimeoutException as exc:
        raise ValueError(error_message) from exc

    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        raise ValueError("Gemini 未返回可解析的结构化结果。")
    parse_candidates: List[str] = [answer_text]
    if answer_snapshots:
        parse_candidates.append(answer_snapshots[-1])
        parse_candidates.extend(
            snapshot
            for snapshot in sorted(answer_snapshots, key=len, reverse=True)
            if snapshot not in parse_candidates
        )
    return _parse_json_content_candidates(parse_candidates)

async def _call_llm(messages: List[Dict[str, Any]], json_mode: bool = True) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
    }
    url = f"{settings.ai_base_url}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            response = await client.post(url, headers=_build_headers(), json=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                raise
            data = response.json()
            _log_http_success(response, payload["model"], len(messages))
    except httpx.TimeoutException as exc:
        logger.error(
            "AI request timed out: url=%s model=%s messages=%s read_timeout=%ss",
            url,
            payload["model"],
            len(messages),
            settings.ai_timeout_seconds,
        )
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                "AI analysis timed out. The request took too long to finish; "
                "please try again later."
            ),
        ) from exc
    content = _extract_content(data)
    if json_mode:
        return _parse_json_content(content)
    return {"content": content}


def _extract_message(response_data: Dict[str, Any]) -> Dict[str, Any]:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    return message


async def _post_chat_completion(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{settings.ai_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
        response = await client.post(url, headers=_build_headers(), json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_http_error(response)
            raise
        data = response.json()
        _log_http_success(response, payload["model"], len(payload.get("messages") or []))
        return data


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


async def analyze_jd(
    text: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
) -> Dict[str, Any]:
    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    messages = [
        {"role": "system", "content": JD_ANALYSIS},
        {
            "role": "user",
            "content": (
                "Job Description:\n"
                f"{text}\n\n"
                "Resume Content:\n"
                f"{resume_payload}\n\n"
                "Current Experience Content:\n"
                f"{experience_payload}\n\n"
                "Previous Experience Content:\n"
                f"{previous_experience_payload}\n\n"
                "Previous Result:\n"
                f"{previous_payload}"
            ),
        },
    ]
    result = await _call_llm(messages, json_mode=True)
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_jd_analysis_user_parts(
    text: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
) -> List[Dict[str, Any]]:
    return [
        {
            "text": (
                "Job Description:\n"
                f"{text}\n\n"
                "Resume Content:\n"
                f"{resume_payload}\n\n"
                "Current Experience Content:\n"
                f"{experience_payload}\n\n"
                "Previous Experience Content:\n"
                f"{previous_experience_payload}\n\n"
                "Previous Result:\n"
                f"{previous_payload}"
            )
        }
    ]


async def analyze_jd_with_thoughts(
    text: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await analyze_jd(
            text,
            resume_text,
            prev_result,
            experience_text,
            prev_experience_text,
        )

    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    try:
        result = await _stream_gemini_json_response(
            system_prompt=JD_ANALYSIS,
            user_parts=_build_jd_analysis_user_parts(
                text,
                resume_payload,
                experience_payload,
                previous_payload,
                previous_experience_payload,
            ),
            error_message="JD 分析失败，请稍后重试。",
            request_label="jd_text_analysis",
            budget_tokens=settings.ai_thinking_budget_jd_analysis,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for jd_text_analysis, falling back to standard analysis.",
            exc_info=True,
        )
        return await analyze_jd(
            text,
            resume_text,
            prev_result,
            experience_text,
            prev_experience_text,
        )
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_image_jd_user_message(
    image_b64: str,
    mime_type: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
    jd_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建包含图像 part 的 multimodal user message。
    图像以 base64 data URL 内嵌，模型可直接读取图像中的 JD 内容。
    """
    text_context = (
        f"Supplementary JD Text:\n{jd_text or 'None'}\n\n"
        f"Resume Content:\n{resume_payload}\n\n"
        f"Current Experience Content:\n{experience_payload}\n\n"
        f"Previous Experience Content:\n{previous_experience_payload}\n\n"
        f"Previous Result:\n{previous_payload}"
    )
    return {
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{image_b64}"
                },
            },
            {"type": "text", "text": text_context},
        ],
    }


async def analyze_jd_with_image(
    image_b64: str,
    mime_type: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    jd_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Vision 路径：将 JD 图像以 base64 内嵌到 multimodal message，
    由模型一次完成 OCR + 分析，无需额外 OCR 服务。
    """
    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    user_message = _build_image_jd_user_message(
        image_b64,
        mime_type,
        resume_payload,
        experience_payload,
        previous_payload,
        previous_experience_payload,
        jd_text,
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": JD_ANALYSIS_IMAGE},
        user_message,
    ]
    result = await _call_llm(messages, json_mode=True)
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_image_jd_user_parts(
    image_b64: str,
    mime_type: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
    jd_text: Optional[str] = None,
) -> List[Dict[str, Any]]:
    return [
        {
            "inlineData": {
                "mimeType": mime_type,
                "data": image_b64,
            }
        },
        {
            "text": (
                f"Supplementary JD Text:\n{jd_text or 'None'}\n\n"
                f"Resume Content:\n{resume_payload}\n\n"
                f"Current Experience Content:\n{experience_payload}\n\n"
                f"Previous Experience Content:\n{previous_experience_payload}\n\n"
                f"Previous Result:\n{previous_payload}"
            )
        },
    ]


async def analyze_jd_with_image_thoughts(
    image_b64: str,
    mime_type: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    jd_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await analyze_jd_with_image(
            image_b64=image_b64,
            mime_type=mime_type,
            resume_text=resume_text,
            prev_result=prev_result,
            experience_text=experience_text,
            jd_text=jd_text,
            prev_experience_text=prev_experience_text,
        )

    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    try:
        result = await _stream_gemini_json_response(
            system_prompt=JD_ANALYSIS_IMAGE,
            user_parts=_build_image_jd_user_parts(
                image_b64,
                mime_type,
                resume_payload,
                experience_payload,
                previous_payload,
                previous_experience_payload,
                jd_text,
            ),
            error_message="JD 附件分析失败，请稍后重试。",
            request_label="jd_image_analysis",
            budget_tokens=settings.ai_thinking_budget_jd_analysis,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for jd_image_analysis, falling back to standard image analysis.",
            exc_info=True,
        )
        return await analyze_jd_with_image(
            image_b64=image_b64,
            mime_type=mime_type,
            resume_text=resume_text,
            prev_result=prev_result,
            experience_text=experience_text,
            jd_text=jd_text,
            prev_experience_text=prev_experience_text,
        )
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _resolve_star_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    has_jd_text: bool = False,
) -> str:
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"smart_complete", "smart_completion"}:
        return STAR_SMART_COMPLETE_REWRITE
    if normalized_mode == "default":
        if has_jd_text:
            return STAR_RESUME_READY_REWRITE
        return STAR_GENERAL_REWRITE_NO_JD
    if normalized_mode in {"highlight", "match_highlight"}:
        if has_jd_text:
            return STAR_HIGHLIGHT
        return STAR_HIGHLIGHT_NO_JD
    return STAR_POLISH


def _build_polish_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    jd_text: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> str:
    has_jd_text = bool(jd_text and jd_text.strip())
    base_prompt = _resolve_star_prompt(target_field, mode, has_jd_text=has_jd_text)
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"highlight", "match_highlight"}:
        mode_instruction = None
    elif normalized_mode == "default" and not has_jd_text:
        mode_instruction = None
    else:
        mode_instruction = POLISH_MODE_INSTRUCTIONS.get(normalized_mode)
    prompt_parts = [base_prompt]
    if mode_instruction:
        prompt_parts.append(mode_instruction)
    if custom_prompt and custom_prompt.strip():
        prompt_parts.append(
            "Additional user instruction for this rewrite: "
            f"{custom_prompt.strip()}"
        )
    return " ".join(prompt_parts)


def _is_off_scope_smart_complete_question(question: str) -> bool:
    normalized = re.sub(r"\s+", "", question)
    if not normalized:
        return True
    if any(term in normalized for term in SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS):
        return True
    if ("其他" in normalized or "其它" in normalized) and ("项目" in normalized or "案例" in normalized):
        return True
    return "是否有过任何" in normalized


def _normalize_smart_complete_polish_result(result: Dict[str, Any]) -> Dict[str, Any]:
    questions = result.get("followUpQuestions")
    if not isinstance(questions, list):
        if isinstance(questions, str) and questions.strip():
            raw_questions: List[Any] = [questions]
        else:
            raw_questions = []
    else:
        raw_questions = questions

    normalized_questions: List[str] = []
    seen_questions: set[str] = set()
    for item in raw_questions:
        if not isinstance(item, str):
            continue
        question = item.strip()
        if not question or _is_off_scope_smart_complete_question(question):
            continue
        question_key = re.sub(r"\s+", "", question)
        if question_key in seen_questions:
            continue
        seen_questions.add(question_key)
        normalized_questions.append(question)
        if len(normalized_questions) >= MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS:
            break

    return {
        **result,
        "followUpQuestions": normalized_questions,
    }


def _normalize_polish_result(result: Dict[str, Any], mode: Optional[str] = None) -> Dict[str, Any]:
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"smart_complete", "smart_completion"}:
        return _normalize_smart_complete_polish_result(result)
    return result


def _normalize_assistant_suggested_followups(
    value: Any,
    *,
    active_skill_id: Optional[str] = None,
) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized_active_skill_id = _normalize_assistant_skill_id(active_skill_id)
    normalized_items: List[Dict[str, str]] = []
    seen_prompts: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        raw_label = item.get("label")
        raw_prompt = item.get("prompt")
        raw_skill_id = item.get("skillId") or item.get("skill_id")
        if not isinstance(raw_label, str) or not isinstance(raw_prompt, str):
            continue
        label = raw_label.strip()
        prompt = raw_prompt.strip()
        skill_id = _normalize_assistant_skill_id(str(raw_skill_id or ""))
        if not label or not prompt or not skill_id:
            continue
        if normalized_active_skill_id == "experience_completion" and _is_off_scope_smart_complete_question(f"{label} {prompt}"):
            continue
        prompt_key = re.sub(r"\s+", "", prompt)
        if prompt_key in seen_prompts:
            continue
        seen_prompts.add(prompt_key)
        normalized_items.append(
            {
                "label": label[:MAX_ASSISTANT_FOLLOWUP_LABEL_CHARS],
                "prompt": prompt[:MAX_ASSISTANT_FOLLOWUP_PROMPT_CHARS],
                "skillId": skill_id,
            }
        )
        if len(normalized_items) >= MAX_ASSISTANT_SUGGESTED_FOLLOWUPS:
            break
    return normalized_items


def _get_assistant_prompt(mode: str, skill_id: Optional[str] = None) -> str:
    normalized_skill_id = _normalize_assistant_skill_id(skill_id)
    if mode == "general":
        prompt = GENERAL_ASSISTANT_PROMPT
    if mode == "experience":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: experience. Start by focusing on experience organization, but do not refuse other topics. "
            + "When 'context.masterId' exists, treat that record as the primary optimization target. "
            + "When 'bank_context' clearly matches an existing experience and the user wants to optimize it, return an experience draftCard with data.targetMasterId set to that masterId. "
            + "The experience draft data may include optional key 'targetMasterId' (string or null). Never fabricate a targetMasterId."
        )
    elif mode == "certification":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: certification. Start by focusing on certification organization, but do not refuse other topics."
        )
    elif mode == "skill":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: skill. Start by focusing on skill organization, but do not refuse other topics."
        )
    elif mode != "general":
        raise ValueError(f"Unsupported assistant mode: {mode}")
    if normalized_skill_id:
        prompt = f"{prompt} {ASSISTANT_SKILL_PROMPTS[normalized_skill_id]['prompt']}"
    return prompt


def _build_assistant_payload(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]],
    selected_experiences: Optional[List[Dict[str, Any]]],
    selected_resume: Optional[Dict[str, Any]],
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    skill_id: Optional[str] = None,
    include_selected_experience_full_text: bool = True,
    preserve_selected_experience_star_text: bool = False,
) -> Dict[str, Any]:
    normalized_history = _normalize_assistant_history(history[-16:], include_attachment_content=False)
    normalized_selected_experiences = _normalize_selected_experiences(
        selected_experiences,
        include_full_text=include_selected_experience_full_text,
        preserve_star_text=preserve_selected_experience_star_text,
    )
    normalized_selected_resume = _normalize_selected_resume(selected_resume)
    normalized_skill_id = _normalize_assistant_skill_id(skill_id)
    payload = {
        "mode": mode,
        "session_title": session_title,
        "entry_source": entry_source,
        "context": context_json,
        "history": normalized_history,
    }
    if normalized_skill_id:
        payload["skill_id"] = normalized_skill_id
        payload["skill"] = {
            "id": normalized_skill_id,
            "title": ASSISTANT_SKILL_PROMPTS[normalized_skill_id]["title"],
        }
    if bank_context is not None:
        payload["bank_context"] = bank_context
    if normalized_selected_experiences:
        payload["selected_experiences"] = normalized_selected_experiences
    if normalized_selected_resume:
        payload["selected_resume"] = normalized_selected_resume
    if attachments:
        attachment_contexts = [
            _build_assistant_attachment_context(item, include_attachment_content=True)
            for item in attachments
        ]
        if len(attachment_contexts) == 1:
            payload["attachment"] = attachment_contexts[0]
        else:
            payload["attachments"] = attachment_contexts
    payload["user_message"] = user_message
    return payload


def _normalize_assistant_result(
    result: Dict[str, Any],
    *,
    skill_id: Optional[str] = None,
) -> Dict[str, Any]:
    assistant_text = result.get("assistantText")
    title = result.get("title")
    draft_card = result.get("draftCard")
    normalized_text = assistant_text.strip() if isinstance(assistant_text, str) else ""
    normalized_title = title.strip() if isinstance(title, str) and title.strip() else "AI 助理"
    normalized_card = None if _normalize_assistant_skill_id(skill_id) == "mock_interview" else _normalize_assistant_draft_card(draft_card)
    if not normalized_text:
        raise ValueError("AI 助理未返回有效回复。")
    return {
        "assistantText": normalized_text,
        "draftCard": normalized_card,
        "title": normalized_title,
        "suggestedFollowups": _normalize_assistant_suggested_followups(
            result.get("suggestedFollowups"),
            active_skill_id=skill_id,
        ),
    }


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

