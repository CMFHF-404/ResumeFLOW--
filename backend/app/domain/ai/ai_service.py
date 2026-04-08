import hashlib
import inspect
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE, HTTP_504_GATEWAY_TIMEOUT

from ...config import load_settings
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
    STAR_POLISH,
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

MAX_ERROR_BODY_LOG_LENGTH = 2000
DEFAULT_MATCH_SCORE = 0
RESUME_SKILLS_KEY = "skills"
AI_CONNECT_TIMEOUT_SECONDS = 10.0
AI_POOL_TIMEOUT_SECONDS = 10.0
GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()

def _summarize_text(text: str) -> str:
    if not text:
        return "len=0 sha256=<empty>"
    return f"len={len(text)} sha256={_hash_text(text)}"

def _strip_json_wrappers(text: str) -> str:
    cleaned = text.strip()
    if "```" not in cleaned:
        return cleaned
    start = cleaned.find("```")
    end = cleaned.rfind("```")
    if end <= start:
        return cleaned
    inner = cleaned[start + 3 : end].strip()
    if inner.lower().startswith("json"):
        inner = inner[4:].strip()
    return inner


def _extract_json_payload(text: str) -> str:
    cleaned = _strip_json_wrappers(text)
    if cleaned.startswith("{") or cleaned.startswith("["):
        return cleaned
    brace_index = cleaned.find("{")
    bracket_index = cleaned.find("[")
    candidates = [i for i in (brace_index, bracket_index) if i >= 0]
    if not candidates:
        return cleaned
    start = min(candidates)
    end_char = "}" if start == brace_index else "]"
    end = cleaned.rfind(end_char)
    if end <= start:
        return cleaned
    return cleaned[start : end + 1]


def _parse_json_content(text: str) -> Dict[str, Any]:
    payload = _extract_json_payload(text)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        logger.error("JSON Parse Error: %s", exc)
        logger.error("Raw Text Summary: %s", _summarize_text(text))
        logger.error("Extracted Payload Summary: %s", _summarize_text(payload))
        raise ValueError(f"Invalid JSON returned by model: {exc}") from exc


def _safe_parse_resume_payload(resume_text: Optional[str]) -> Optional[Dict[str, Any]]:
    if not resume_text:
        return None
    try:
        data = json.loads(resume_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _extract_skill_ids(resume_text: Optional[str]) -> List[str]:
    payload = _safe_parse_resume_payload(resume_text)
    if not payload:
        return []
    skills = payload.get(RESUME_SKILLS_KEY)
    if not isinstance(skills, list):
        return []
    ids: List[str] = []
    for item in skills:
        if isinstance(item, dict):
            skill_id = item.get("id")
            if isinstance(skill_id, str) and skill_id:
                ids.append(skill_id)
    return ids


def _clamp_match_score(value: Any) -> Optional[int]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not numeric == numeric:
        return None
    return max(0, min(100, int(round(numeric))))


def _normalize_match_entries(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        match_id = item.get("id")
        if not isinstance(match_id, str) or not match_id:
            continue
        score = _clamp_match_score(item.get("score"))
        if score is None:
            continue
        entry: Dict[str, Any] = {"id": match_id, "score": score}
        reason = item.get("reason")
        if isinstance(reason, str) and reason.strip():
            entry["reason"] = reason
        normalized.append(entry)
    return normalized


def _ensure_skill_matches(
    result: Dict[str, Any],
    skill_ids: List[str],
) -> Dict[str, Any]:
    if not skill_ids:
        return result
    known_ids = set(skill_ids)
    normalized = _normalize_match_entries(result.get("skillMatches"))
    normalized = [entry for entry in normalized if entry["id"] in known_ids]
    existing = {entry["id"] for entry in normalized}
    for skill_id in skill_ids:
        if skill_id not in existing:
            normalized.append({"id": skill_id, "score": DEFAULT_MATCH_SCORE})
    result["skillMatches"] = normalized
    return result


def _normalize_jd_analysis_result(result: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(result)
    extracted_jd_text = normalized.get("extractedJdText")
    if not isinstance(extracted_jd_text, str):
        extracted_jd_text = normalized.get("extracted_jd_text")
    if isinstance(extracted_jd_text, str) and extracted_jd_text.strip():
        normalized["extractedJdText"] = extracted_jd_text.strip()
    else:
        normalized.pop("extractedJdText", None)
        normalized.pop("extracted_jd_text", None)
    return normalized


def _normalize_greeting_result(result: Dict[str, Any]) -> Dict[str, Any]:
    greeting = result.get("greeting")
    if isinstance(greeting, str) and greeting.strip():
        return {"greeting": greeting.strip()}
    return {"greeting": ""}


def _normalize_summary_result(result: Dict[str, Any]) -> Dict[str, Any]:
    summary = result.get("summary")
    if isinstance(summary, str) and summary.strip():
        return {"summary": summary.strip()}
    return {"summary": ""}


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
) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "temperature": 0.2,
        "responseMimeType": "application/json",
        "thinkingConfig": {
            "includeThoughts": True,
        },
    }
    if budget_tokens is None:
        return config

    config["thinkingConfig"]["thinkingBudget"] = int(budget_tokens)
    return config


def _build_gemini_request_body(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    budget_tokens: Optional[int] = None,
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
        "generationConfig": _build_gemini_generation_config(budget_tokens),
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
    request_body = _build_gemini_request_body(
        system_prompt=system_prompt,
        user_parts=user_parts,
        budget_tokens=budget_tokens,
    )
    model = settings.gemini_model
    url = _build_gemini_stream_url(model)
    answer_parts: List[str] = []

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
    return _parse_json_content(answer_text)

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


def _resolve_star_prompt(target_field: Optional[str]) -> str:
    return STAR_POLISH


def _build_polish_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> str:
    base_prompt = _resolve_star_prompt(target_field)
    normalized_mode = (mode or "default").strip().lower()
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


def _get_assistant_prompt(mode: str) -> str:
    if mode == "general":
        return GENERAL_ASSISTANT_PROMPT
    if mode == "experience":
        return (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: experience. Start by focusing on experience organization, but do not refuse other topics."
        )
    if mode == "certification":
        return (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: certification. Start by focusing on certification organization, but do not refuse other topics."
        )
    if mode == "skill":
        return (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: skill. Start by focusing on skill organization, but do not refuse other topics."
        )
    raise ValueError(f"Unsupported assistant mode: {mode}")


def _build_assistant_payload(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "mode": mode,
        "session_title": session_title,
        "entry_source": entry_source,
        "context": context_json,
        "history": history[-16:],
        "user_message": user_message,
    }


def _normalize_assistant_result(result: Dict[str, Any]) -> Dict[str, Any]:
    assistant_text = result.get("assistantText")
    title = result.get("title")
    draft_card = result.get("draftCard")
    normalized_text = assistant_text.strip() if isinstance(assistant_text, str) else ""
    normalized_title = title.strip() if isinstance(title, str) and title.strip() else "AI 助理"
    normalized_card = draft_card if isinstance(draft_card, dict) else None
    if not normalized_text:
        raise ValueError("AI 助理未返回有效回复。")
    return {
        "assistantText": normalized_text,
        "draftCard": normalized_card,
        "title": normalized_title,
    }


async def polish_experience(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    prompt = _build_polish_prompt(target_field, mode, custom_prompt)
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
    return await _call_llm(messages, json_mode=True)


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

    prompt = _build_polish_prompt(target_field, mode, custom_prompt)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    if mode:
        content_payload["polish_mode"] = mode
    if custom_prompt:
        content_payload["custom_prompt"] = custom_prompt
    try:
        return await _stream_gemini_json_response(
            system_prompt=prompt,
            user_parts=[
                {"text": json.dumps(content_payload, ensure_ascii=False)},
            ],
            error_message="JD 润色失败，请稍后重试。",
            request_label="star_polish",
            budget_tokens=settings.ai_thinking_budget_polish,
            thought_callback=thought_callback,
        )
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
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        history=history,
    )
    messages = [
        {"role": "system", "content": _get_assistant_prompt(mode)},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_assistant_result(result)


async def run_assistant_turn_with_thoughts(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    history: List[Dict[str, Any]],
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            history=history,
        )

    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        history=history,
    )
    try:
        result = await _stream_gemini_json_response(
            system_prompt=_get_assistant_prompt(mode),
            user_parts=[{"text": json.dumps(payload, ensure_ascii=False)}],
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
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            history=history,
        )
    return _normalize_assistant_result(result)


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
        )
    return _normalize_summary_result(result)

