import inspect
import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE, HTTP_504_GATEWAY_TIMEOUT

from ...config import load_settings
from ..billing import billing_service
from .response_normalizers import _parse_json_content, _parse_json_content_candidates

settings = load_settings()
logger = logging.getLogger(__name__)

MAX_ERROR_BODY_LOG_LENGTH = 2000
AI_CONNECT_TIMEOUT_SECONDS = 10.0
AI_POOL_TIMEOUT_SECONDS = 10.0
GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
QWEN_THOUGHT_SUMMARY_MAX_LENGTH = 80
QWEN_RESPONSES_THOUGHT_SUMMARY_MAX_LENGTH = 32
ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
UsageCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
THOUGHT_TITLE_PATTERN = re.compile(r"\*\*([^*\n]+?)\*\*")
THOUGHT_NOISE_PREFIX_PATTERN = re.compile(
    r"^(?:思考中|思考过程|思考摘要|摘要|thinking process|reasoning summary|reasoning|summary)\s*[:：-]\s*",
    re.IGNORECASE,
)
THOUGHT_JSON_FIELD_PREFIX_PATTERN = re.compile(
    r"^[{,\[\s]*[\"']?(?:summary|text|reasoning|reasoning_summary|thought|title|content)[\"']?\s*[:：]\s*",
    re.IGNORECASE,
)
THOUGHT_ACTION_PREFIXES = (
    "读取",
    "识别",
    "解析",
    "分析",
    "匹配",
    "对齐",
    "比较",
    "评估",
    "提炼",
    "归纳",
    "整理",
    "优化",
    "生成",
    "构建",
    "检查",
    "沉淀",
    "记录",
)
THOUGHT_ACTIVE_PREFIXES = ("正在", "已", "完成", "开始", "继续", "准备")


def _extract_content(response_data: Dict[str, Any]) -> str:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise ValueError("LLM response missing content")
    return content


def _is_qwen_model(model: Optional[str]) -> bool:
    return (model or "").strip().lower().startswith("qwen")


def _should_use_qwen_thinking() -> bool:
    return bool(getattr(settings, "ai_api_key", None)) and _is_qwen_model(
        getattr(settings, "ai_model", None)
    )


def _prepare_chat_completion_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    request_payload = {**payload}
    if (
        _is_qwen_model(str(request_payload.get("model") or ""))
        and not request_payload.get("stream")
        and "enable_thinking" not in request_payload
    ):
        request_payload["enable_thinking"] = False
    return request_payload


def _normalize_thought_summary(raw_text: str) -> str:
    text = raw_text.replace("\r", "\n").strip()
    if not text:
        return ""

    title_matches = [
        item.strip() for item in THOUGHT_TITLE_PATTERN.findall(text) if item.strip()
    ]
    if title_matches:
        summary = title_matches[-1]
    else:
        first_line = next(
            (
                line.replace("*", "").replace("#", "").replace("`", "").strip()
                for line in text.splitlines()
                if line.strip()
            ),
            "",
        )
        summary = re.split(r"[。！？!?；;\n]", first_line, maxsplit=1)[0].strip()

    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) <= QWEN_THOUGHT_SUMMARY_MAX_LENGTH:
        return summary
    return f"{summary[: QWEN_THOUGHT_SUMMARY_MAX_LENGTH - 3].rstrip()}..."


def _is_junk_qwen_responses_thought_summary(summary: str) -> bool:
    stripped = summary.strip()
    if not stripped:
        return True
    compact = re.sub(r"\s+", "", stripped)
    if re.fullmatch(
        r"[:：,，;；{}\[\]()'\"`]*(?:true|false|null|none)[:：,，;；{}\[\]()'\"`]*",
        compact,
        re.IGNORECASE,
    ):
        return True
    if re.fullmatch(
        r"[{,\[]?[\"']?[A-Za-z_][\w.-]*[\"']?[:=：](?:true|false|null|none)[,，}]?",
        compact,
        re.IGNORECASE,
    ):
        return True
    generic = compact.lower().strip(":：-_*#`\"'{}[]()（）")
    return generic in {
        "thinkingprocess",
        "reasoning",
        "reasoningsummary",
        "summary",
        "thought",
        "thoughts",
        "includethoughts",
        "enablethinking",
        "enable_thinking",
    }


def _clean_qwen_responses_thought_summary(summary: str) -> str:
    if _is_junk_qwen_responses_thought_summary(summary):
        return ""

    previous = None
    while previous != summary:
        previous = summary
        summary = THOUGHT_JSON_FIELD_PREFIX_PATTERN.sub("", summary).strip()
        summary = THOUGHT_NOISE_PREFIX_PATTERN.sub("", summary).strip()
        summary = summary.strip(" \t`\"'“”‘’{}[]()（）")

    if _is_junk_qwen_responses_thought_summary(summary):
        return ""

    summary = re.split(r"[，,。！？!?；;\n]", summary, maxsplit=1)[0].strip()
    summary = re.sub(r"\s+", " ", summary).strip()
    if _is_junk_qwen_responses_thought_summary(summary):
        return ""

    if (
        summary.startswith(THOUGHT_ACTION_PREFIXES)
        and not summary.startswith(THOUGHT_ACTIVE_PREFIXES)
    ):
        summary = f"正在{summary}"

    if len(summary) <= QWEN_RESPONSES_THOUGHT_SUMMARY_MAX_LENGTH:
        return summary
    return f"{summary[: QWEN_RESPONSES_THOUGHT_SUMMARY_MAX_LENGTH - 3].rstrip()}..."


def _normalize_qwen_responses_thought_summary(raw_text: str) -> str:
    text = raw_text.replace("\r", "\n")
    candidates = [text]
    candidates.extend(line for line in text.splitlines() if line.strip())
    for candidate in candidates:
        summary = _clean_qwen_responses_thought_summary(
            _normalize_thought_summary(candidate)
        )
        if summary:
            return summary
    return ""


def _is_thought_summary_boundary(text: str) -> bool:
    if re.search(r"[\n\r]\s*$", text):
        return True
    stripped = text.strip()
    if not stripped:
        return False
    if THOUGHT_TITLE_PATTERN.search(stripped):
        return True
    return bool(re.search(r"[\n\r。！？!?；;]\s*$", stripped)) or len(stripped) >= 140


def _convert_user_part_to_openai_content(part: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if "text" in part and isinstance(part.get("text"), str):
        return {"type": "text", "text": part["text"]}
    if part.get("type") == "text" and isinstance(part.get("text"), str):
        return {"type": "text", "text": part["text"]}
    if part.get("type") == "image_url" and isinstance(part.get("image_url"), dict):
        return {"type": "image_url", "image_url": part["image_url"]}

    inline_data = part.get("inlineData")
    if isinstance(inline_data, dict):
        mime_type = str(inline_data.get("mimeType") or "").strip()
        data = str(inline_data.get("data") or "").strip()
        if mime_type and data:
            return {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{data}"},
            }
    return None


def _convert_user_part_to_qwen_responses_content(
    part: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if "text" in part and isinstance(part.get("text"), str):
        return {"type": "input_text", "text": part["text"]}
    if part.get("type") == "input_text" and isinstance(part.get("text"), str):
        return {"type": "input_text", "text": part["text"]}

    image_url = part.get("image_url")
    if part.get("type") == "input_image" and isinstance(image_url, str):
        response_part: Dict[str, Any] = {
            "type": "input_image",
            "image_url": image_url,
        }
        detail = part.get("detail")
        if isinstance(detail, str) and detail.strip():
            response_part["detail"] = detail
        return response_part
    if part.get("type") == "image_url" and isinstance(image_url, dict):
        url = image_url.get("url")
        if isinstance(url, str) and url.strip():
            response_part = {
                "type": "input_image",
                "image_url": url,
            }
            detail = image_url.get("detail")
            if isinstance(detail, str) and detail.strip():
                response_part["detail"] = detail
            return response_part

    inline_data = part.get("inlineData")
    if isinstance(inline_data, dict):
        mime_type = str(inline_data.get("mimeType") or "").strip()
        data = str(inline_data.get("data") or "").strip()
        if mime_type and data:
            return {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{data}",
            }
    return None


def _build_openai_messages(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    content_parts = [
        converted
        for converted in (
            _convert_user_part_to_openai_content(part) for part in user_parts
        )
        if converted is not None
    ]
    if not content_parts:
        content: Any = ""
    elif len(content_parts) == 1 and content_parts[0]["type"] == "text":
        content = content_parts[0]["text"]
    else:
        content = content_parts
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


def _build_qwen_responses_input_messages(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    content_parts = [
        converted
        for converted in (
            _convert_user_part_to_qwen_responses_content(part) for part in user_parts
        )
        if converted is not None
    ]
    if not content_parts:
        content: Any = ""
    elif len(content_parts) == 1 and content_parts[0]["type"] == "input_text":
        content = content_parts[0]["text"]
    else:
        content = content_parts
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


def _derive_qwen_responses_base_url(ai_base_url: str) -> str:
    normalized = (ai_base_url or "").rstrip("/")
    responses_suffix = "/api/v2/apps/protocols/compatible-mode/v1"
    if normalized.endswith(responses_suffix):
        return normalized

    chat_suffix = "/compatible-mode/v1"
    if normalized.endswith(chat_suffix):
        return f"{normalized[: -len(chat_suffix)]}{responses_suffix}"

    return normalized


def _build_qwen_responses_url() -> str:
    base_url = (
        getattr(settings, "ai_responses_base_url", None)
        or _derive_qwen_responses_base_url(getattr(settings, "ai_base_url", ""))
    )
    return f"{base_url.rstrip('/')}/responses"


def _extract_qwen_responses_message_text(item: Dict[str, Any]) -> str:
    content = item.get("content")
    if not isinstance(content, list):
        return ""
    text_parts = [
        part.get("text")
        for part in content
        if isinstance(part, dict)
        and part.get("type") in {"output_text", "text"}
        and isinstance(part.get("text"), str)
    ]
    return "".join(text_parts)


def _extract_qwen_responses_output_text(response_payload: Dict[str, Any]) -> str:
    output = response_payload.get("output")
    if not isinstance(output, list):
        return ""
    text_parts = [
        _extract_qwen_responses_message_text(item)
        for item in output
        if isinstance(item, dict) and item.get("type") == "message"
    ]
    return "".join(part for part in text_parts if part)


def _iter_qwen_responses_summary_texts(item: Dict[str, Any]):
    summary_items = item.get("summary")
    if not isinstance(summary_items, list):
        return
    for summary_item in summary_items:
        if not isinstance(summary_item, dict):
            continue
        text = summary_item.get("text")
        if isinstance(text, str) and text.strip():
            yield text


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
        raise ValueError("备用思考通道 API Key 未配置，无法返回实时思考节点。")
    return {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }


def _build_gemini_stream_url(model: str) -> str:
    base_url = (settings.gemini_base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("备用思考通道地址未配置，无法调用实时思考节点。")
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


def _safe_int(value: Any) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def _provider_from_base_url(base_url: str, model: Optional[str] = None) -> str:
    normalized = (base_url or "").lower()
    if "dashscope" in normalized or "aliyun" in normalized or _is_qwen_model(model):
        return "dashscope"
    if "googleapis" in normalized or "generativelanguage" in normalized:
        return "gemini"
    return "openai_compatible"


def _normalize_usage_numbers(usage: Any) -> Dict[str, int]:
    if not isinstance(usage, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    prompt_tokens = _safe_int(
        usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or usage.get("promptTokenCount")
        or usage.get("inputTokenCount")
    )
    completion_tokens = _safe_int(
        usage.get("completion_tokens")
        or usage.get("output_tokens")
        or usage.get("completionTokenCount")
        or usage.get("candidatesTokenCount")
        or usage.get("outputTokenCount")
    )
    total_tokens = _safe_int(
        usage.get("total_tokens")
        or usage.get("totalTokens")
        or usage.get("totalTokenCount")
    )
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def _build_usage_payload(
    usage: Any,
    *,
    provider: str,
    model: str,
    request_label: str,
    status: str = "success",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    numbers = _normalize_usage_numbers(usage)
    return {
        **numbers,
        "provider": provider,
        "model": model,
        "request_label": request_label,
        "status": status,
        "metadata": metadata or {},
    }


async def _emit_usage_payload(
    usage_callback: UsageCallback,
    payload: Dict[str, Any],
) -> None:
    await billing_service.emit_usage_callback(usage_callback, payload)
    await billing_service.record_current_usage(payload)


async def _emit_usage_from_response(
    usage_callback: UsageCallback,
    response_data: Dict[str, Any],
    *,
    provider: str,
    model: str,
    request_label: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    usage = response_data.get("usage")
    if usage is None:
        usage = response_data.get("usageMetadata")
    if isinstance(usage, dict):
        await _emit_usage_payload(
            usage_callback,
            _build_usage_payload(
                usage,
                provider=provider,
                model=model,
                request_label=request_label,
                metadata=metadata,
            ),
        )
        return
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            {},
            provider=provider,
            model=model,
            request_label=request_label,
            status="usage_missing",
            metadata=metadata,
        ),
    )


async def _emit_failed_usage(
    usage_callback: UsageCallback,
    *,
    provider: str,
    model: str,
    request_label: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            {},
            provider=provider,
            model=model,
            request_label=request_label,
            status="failed",
            metadata=metadata,
        ),
    )


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
                logger.warning("[AI Stream] invalid SSE payload: %s", payload[:500])
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


async def _stream_gemini_json_response_legacy(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
    usage_callback: UsageCallback = None,
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
    final_usage: Dict[str, Any] | None = None

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
                        "备用思考通道返回了非流式响应，请检查服务地址配置。"
                    )
                async for payload in _iter_sse_json_payloads(response):
                    if isinstance(payload.get("usageMetadata"), dict):
                        final_usage = payload["usageMetadata"]
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
        raise ValueError("备用思考通道未返回可解析的结构化结果。")
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            final_usage or {},
            provider="gemini",
            model=model,
            request_label=request_label,
            status="success" if final_usage else "usage_missing",
        ),
    )
    parse_candidates: List[str] = [answer_text]
    if answer_snapshots:
        parse_candidates.append(answer_snapshots[-1])
        parse_candidates.extend(
            snapshot
            for snapshot in sorted(answer_snapshots, key=len, reverse=True)
            if snapshot not in parse_candidates
        )
    return _parse_json_content_candidates(parse_candidates)


async def _stream_qwen_responses_json_response(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    thought_callback: ThoughtCallback = None,
    usage_callback: UsageCallback = None,
) -> Dict[str, Any]:
    model = settings.ai_model
    payload: Dict[str, Any] = {
        "model": model,
        "input": _build_qwen_responses_input_messages(
            system_prompt=system_prompt,
            user_parts=user_parts,
        ),
        "temperature": 0.2,
        "stream": True,
        "enable_thinking": True,
    }

    answer_parts: List[str] = []
    answer_snapshots: List[str] = []
    thought_buffer = ""
    last_thought_summary = ""
    url = _build_qwen_responses_url()
    completed_usage: Dict[str, Any] | None = None

    async def emit_summary(raw_text: str) -> None:
        nonlocal last_thought_summary
        thought_summary = _normalize_qwen_responses_thought_summary(raw_text)
        if not thought_summary or thought_summary == last_thought_summary:
            return
        last_thought_summary = thought_summary
        await _emit_thought(
            thought_callback,
            {"type": "thought", "summary": thought_summary},
        )

    async def flush_summary_buffer() -> None:
        nonlocal thought_buffer
        if not thought_buffer.strip():
            return
        await emit_summary(thought_buffer)
        thought_buffer = ""

    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=_build_headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body_preview = (await response.aread()).decode("utf-8", errors="ignore")[:800]
                    logger.error(
                        "[AI Stream] unexpected Qwen Responses content-type label=%s content_type=%s body=%s",
                        request_label,
                        content_type,
                        body_preview,
                    )
                    raise ValueError("Qwen Responses 返回了非流式响应，请检查 AI_RESPONSES_BASE_URL 配置。")

                async for stream_payload in _iter_sse_json_payloads(response):
                    event_type = stream_payload.get("type")
                    if event_type == "response.reasoning_summary_text.delta":
                        delta = stream_payload.get("delta")
                        if isinstance(delta, str) and delta:
                            thought_buffer = f"{thought_buffer}{delta}"
                            if _is_thought_summary_boundary(thought_buffer):
                                await flush_summary_buffer()
                        continue

                    if event_type == "response.reasoning_summary_text.done":
                        await flush_summary_buffer()
                        text = stream_payload.get("text")
                        if isinstance(text, str) and text.strip():
                            await emit_summary(text)
                        continue

                    if event_type == "response.output_text.delta":
                        delta = stream_payload.get("delta")
                        if isinstance(delta, str) and delta:
                            answer_parts.append(delta)
                            answer_snapshots.append(delta)
                        continue

                    if event_type == "response.output_item.done":
                        item = stream_payload.get("item")
                        if not isinstance(item, dict):
                            continue
                        if item.get("type") == "reasoning":
                            await flush_summary_buffer()
                            for summary_text in _iter_qwen_responses_summary_texts(item):
                                await emit_summary(summary_text)
                            continue
                        if item.get("type") == "message" and not answer_parts:
                            message_text = _extract_qwen_responses_message_text(item)
                            if message_text:
                                answer_parts.append(message_text)
                                answer_snapshots.append(message_text)
                            continue

                    if event_type == "response.completed":
                        await flush_summary_buffer()
                        response_payload = stream_payload.get("response")
                        if isinstance(response_payload, dict):
                            usage = response_payload.get("usage")
                            if isinstance(usage, dict):
                                completed_usage = usage
                            output = response_payload.get("output")
                            if isinstance(output, list):
                                for item in output:
                                    if (
                                        isinstance(item, dict)
                                        and item.get("type") == "reasoning"
                                    ):
                                        for summary_text in _iter_qwen_responses_summary_texts(item):
                                            await emit_summary(summary_text)
                            if not answer_parts:
                                message_text = _extract_qwen_responses_output_text(
                                    response_payload
                                )
                                if message_text:
                                    answer_parts.append(message_text)
                                    answer_snapshots.append(message_text)
                        continue

                await flush_summary_buffer()
    except httpx.HTTPStatusError as exc:
        try:
            await exc.response.aread()
            error_text = exc.response.text[:1000]
        except Exception:
            error_text = "Failed to read response body."
        logger.error(
            "[AI Stream] Qwen Responses request failed label=%s status=%s body=%s",
            request_label,
            exc.response.status_code,
            error_text,
        )
        raise ValueError(error_message) from exc
    except httpx.TimeoutException as exc:
        raise ValueError(error_message) from exc

    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        raise ValueError("Qwen Responses 未返回可解析的结构化结果。")
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            completed_usage or {},
            provider="dashscope",
            model=model,
            request_label=request_label,
            status="success" if completed_usage else "usage_missing",
            metadata={"transport": "responses_stream"},
        ),
    )
    parse_candidates: List[str] = [answer_text]
    if answer_snapshots:
        parse_candidates.append(answer_snapshots[-1])
        parse_candidates.extend(
            snapshot
            for snapshot in sorted(answer_snapshots, key=len, reverse=True)
            if snapshot not in parse_candidates
        )
    return _parse_json_content_candidates(parse_candidates)


async def _stream_qwen_json_response(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
    usage_callback: UsageCallback = None,
) -> Dict[str, Any]:
    model = settings.ai_model
    payload: Dict[str, Any] = {
        "model": model,
        "messages": _build_openai_messages(
            system_prompt=system_prompt,
            user_parts=user_parts,
        ),
        "temperature": 0.2,
        "stream": True,
        "stream_options": {"include_usage": True},
        "enable_thinking": True,
    }
    if budget_tokens is not None:
        payload["thinking_budget"] = int(budget_tokens)

    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    answer_parts: List[str] = []
    answer_snapshots: List[str] = []
    thought_buffer = ""
    last_thought_summary = ""
    final_usage: Dict[str, Any] | None = None

    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=_build_headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body_preview = (await response.aread()).decode("utf-8", errors="ignore")[:800]
                    logger.error(
                        "[AI Stream] unexpected Qwen content-type label=%s content_type=%s body=%s",
                        request_label,
                        content_type,
                        body_preview,
                    )
                    raise ValueError("Qwen 返回了非流式响应，请检查 AI_BASE_URL 是否为兼容模式地址。")
                async for stream_payload in _iter_sse_json_payloads(response):
                    usage = stream_payload.get("usage")
                    if isinstance(usage, dict):
                        final_usage = usage
                    choices = stream_payload.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0] or {}).get("delta") or {}
                    reasoning_content = delta.get("reasoning_content")
                    if isinstance(reasoning_content, str) and reasoning_content.strip():
                        thought_buffer = f"{thought_buffer}{reasoning_content}"
                        thought_summary = (
                            _normalize_thought_summary(thought_buffer)
                            if _is_thought_summary_boundary(thought_buffer)
                            else ""
                        )
                        if thought_summary and thought_summary != last_thought_summary:
                            last_thought_summary = thought_summary
                            await _emit_thought(
                                thought_callback,
                                {"type": "thought", "summary": thought_summary},
                            )
                            if not THOUGHT_TITLE_PATTERN.search(thought_buffer):
                                thought_buffer = ""
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        answer_parts.append(content)
                        answer_snapshots.append(content)
                if thought_buffer.strip():
                    thought_summary = _normalize_thought_summary(thought_buffer)
                    if thought_summary and thought_summary != last_thought_summary:
                        await _emit_thought(
                            thought_callback,
                            {"type": "thought", "summary": thought_summary},
                        )
    except httpx.HTTPStatusError as exc:
        try:
            await exc.response.aread()
            error_text = exc.response.text[:1000]
        except Exception:
            error_text = "Failed to read response body."
        logger.error(
            "[AI Stream] Qwen request failed label=%s status=%s body=%s",
            request_label,
            exc.response.status_code,
            error_text,
        )
        raise ValueError(error_message) from exc
    except httpx.TimeoutException as exc:
        raise ValueError(error_message) from exc

    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        raise ValueError("Qwen 未返回可解析的结构化结果。")
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            final_usage or {},
            provider="dashscope",
            model=model,
            request_label=request_label,
            status="success" if final_usage else "usage_missing",
            metadata={"transport": "chat_stream"},
        ),
    )
    parse_candidates: List[str] = [answer_text]
    if answer_snapshots:
        parse_candidates.append(answer_snapshots[-1])
        parse_candidates.extend(
            snapshot
            for snapshot in sorted(answer_snapshots, key=len, reverse=True)
            if snapshot not in parse_candidates
        )
    return _parse_json_content_candidates(parse_candidates)


async def _stream_gemini_json_response(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
    usage_callback: UsageCallback = None,
) -> Dict[str, Any]:
    async def record_stream_failure(error: Exception) -> None:
        await _emit_failed_usage(
            usage_callback,
            provider=_provider_from_base_url(settings.ai_base_url, settings.ai_model),
            model=str(settings.ai_model or ""),
            request_label=request_label,
            metadata={
                "transport": "thinking_stream",
                "error": type(error).__name__,
            },
        )

    if _should_use_qwen_thinking():
        try:
            return await _stream_qwen_responses_json_response(
                system_prompt=system_prompt,
                user_parts=user_parts,
                error_message=error_message,
                request_label=request_label,
                thought_callback=thought_callback,
                usage_callback=usage_callback,
            )
        except Exception:
            logger.warning(
                "[AI Stream] Qwen Responses thought streaming failed for %s.",
                request_label,
                exc_info=True,
            )
            await _emit_thought(thought_callback, {"type": "thought_reset"})
            try:
                return await _stream_qwen_json_response(
                    system_prompt=system_prompt,
                    user_parts=user_parts,
                    error_message=error_message,
                    request_label=request_label,
                    budget_tokens=budget_tokens,
                    thought_callback=thought_callback,
                    usage_callback=usage_callback,
                )
            except Exception as qwen_chat_error:
                logger.warning(
                    "[AI Stream] Qwen Chat Completions thought streaming failed for %s.",
                    request_label,
                    exc_info=True,
                )
                await _emit_thought(thought_callback, {"type": "thought_reset"})
                if getattr(settings, "gemini_api_key", None):
                    try:
                        return await _stream_gemini_json_response_legacy(
                            system_prompt=system_prompt,
                            user_parts=user_parts,
                            error_message=error_message,
                            request_label=request_label,
                            budget_tokens=budget_tokens,
                            thought_callback=thought_callback,
                            usage_callback=usage_callback,
                        )
                    except Exception as gemini_error:
                        await record_stream_failure(gemini_error)
                        raise
                await record_stream_failure(qwen_chat_error)
                raise

    try:
        return await _stream_gemini_json_response_legacy(
            system_prompt=system_prompt,
            user_parts=user_parts,
            error_message=error_message,
            request_label=request_label,
            budget_tokens=budget_tokens,
            thought_callback=thought_callback,
            usage_callback=usage_callback,
        )
    except Exception as gemini_error:
        await record_stream_failure(gemini_error)
        raise


async def _call_llm(
    messages: List[Dict[str, Any]],
    json_mode: bool = True,
    model: Optional[str] = None,
    *,
    usage_callback: UsageCallback = None,
    request_label: str = "chat_completion",
) -> Dict[str, Any]:
    resolved_model = model or settings.ai_model
    payload = _prepare_chat_completion_payload({
        "model": resolved_model,
        "messages": messages,
        "temperature": 0.3,
    })
    url = f"{settings.ai_base_url}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            response = await client.post(url, headers=_build_headers(), json=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                await _emit_failed_usage(
                    usage_callback,
                    provider=_provider_from_base_url(settings.ai_base_url, payload["model"]),
                    model=payload["model"],
                    request_label=request_label,
                    metadata={
                        "transport": "chat_completion",
                        "http_status": response.status_code,
                    },
                )
                raise
            data = response.json()
            _log_http_success(response, payload["model"], len(messages))
            await _emit_usage_from_response(
                usage_callback,
                data,
                provider=_provider_from_base_url(settings.ai_base_url, payload["model"]),
                model=payload["model"],
                request_label=request_label,
                metadata={"transport": "chat_completion"},
            )
    except httpx.TimeoutException as exc:
        logger.error(
            "AI request timed out: url=%s model=%s messages=%s read_timeout=%ss",
            url,
            payload["model"],
            len(messages),
            settings.ai_timeout_seconds,
        )
        await _emit_failed_usage(
            usage_callback,
            provider=_provider_from_base_url(settings.ai_base_url, payload["model"]),
            model=payload["model"],
            request_label=request_label,
            metadata={"transport": "chat_completion", "error": "timeout"},
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


async def _post_chat_completion(
    payload: Dict[str, Any],
    *,
    usage_callback: UsageCallback = None,
    request_label: str = "chat_completion",
) -> Dict[str, Any]:
    request_payload = _prepare_chat_completion_payload(payload)
    url = f"{settings.ai_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
        response = await client.post(url, headers=_build_headers(), json=request_payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_http_error(response)
            await _emit_failed_usage(
                usage_callback,
                provider=_provider_from_base_url(settings.ai_base_url, request_payload.get("model")),
                model=str(request_payload.get("model") or settings.ai_model),
                request_label=str(request_payload.get("request_label") or request_label),
                metadata={
                    "transport": "chat_completion",
                    "http_status": response.status_code,
                },
            )
            raise
        data = response.json()
        _log_http_success(response, request_payload["model"], len(request_payload.get("messages") or []))
        await _emit_usage_from_response(
            usage_callback,
            data,
            provider=_provider_from_base_url(settings.ai_base_url, request_payload.get("model")),
            model=str(request_payload.get("model") or settings.ai_model),
            request_label=str(request_payload.get("request_label") or request_label),
            metadata={"transport": "chat_completion"},
        )
        return data
