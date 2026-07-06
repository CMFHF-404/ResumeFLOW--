import inspect
import json
import logging
import re
from dataclasses import dataclass
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
GEMINI_HIDDEN_THOUGHT_STATUS_SUMMARY = "深度思考已启用，但当前模型通道未返回可展示的思考摘要"
AI_CONNECT_TIMEOUT_SECONDS = 10.0
AI_POOL_TIMEOUT_SECONDS = 10.0
GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
QWEN_THOUGHT_SUMMARY_MAX_LENGTH = 80
QWEN_RESPONSES_THOUGHT_SUMMARY_MAX_LENGTH = 32
ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AssistantTextCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
UsageCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AI_ROUTE_PROFILE_HYBRID = "hybrid_gemini_aifast"
AI_ROUTE_PROFILE_GEMINI = "gemini_primary"
AI_ROUTE_PROFILE_QWEN = "qwen_primary"
LANE_DEFAULT = "default"
LANE_TOOL_CALL = "tool_call"
LANE_THINKING = "thinking"
LANE_RESUME_PARSE = "resume_parse"
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


@dataclass(frozen=True)
class AIRoute:
    provider: str
    api_key: Optional[str]
    base_url: str
    model: str
    transport: str


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


def _route_profile() -> str:
    return str(
        getattr(settings, "ai_route_profile", AI_ROUTE_PROFILE_HYBRID)
        or AI_ROUTE_PROFILE_HYBRID
    ).strip().lower()


def _has_gemini_provider() -> bool:
    return bool(getattr(settings, "gemini_api_key", None))


def _is_gemini_route(route: AIRoute) -> bool:
    return route.provider == "gemini"


def _resolve_openai_compatible_route(
    *,
    lane: str,
    model: Optional[str] = None,
) -> AIRoute:
    if lane == LANE_RESUME_PARSE:
        base_url = str(
            getattr(settings, "ai_fast_base_url", None)
            or getattr(settings, "ai_base_url", "")
            or ""
        )
        resolved_model = str(
            model
            or getattr(settings, "ai_fast_model", None)
            or getattr(settings, "ai_model", "")
            or ""
        )
        return AIRoute(
            provider=_provider_from_base_url(base_url, resolved_model),
            api_key=(
                getattr(settings, "ai_fast_api_key", None)
                or getattr(settings, "ai_api_key", None)
            ),
            base_url=base_url,
            model=resolved_model,
            transport="chat_completion",
        )

    base_url = str(getattr(settings, "ai_base_url", "") or "")
    resolved_model = str(model or getattr(settings, "ai_model", "") or "")
    return AIRoute(
        provider=_provider_from_base_url(base_url, resolved_model),
        api_key=getattr(settings, "ai_api_key", None),
        base_url=base_url,
        model=resolved_model,
        transport="chat_completion",
    )


def _resolve_gemini_route(*, model: Optional[str] = None) -> AIRoute:
    requested_model = str(model or "").strip()
    resolved_model = (
        requested_model
        if requested_model.lower().startswith("gemini")
        else str(getattr(settings, "gemini_model", "") or "")
    )
    return AIRoute(
        provider="gemini",
        api_key=getattr(settings, "gemini_api_key", None),
        base_url=str(getattr(settings, "gemini_base_url", "") or ""),
        model=resolved_model,
        transport="gemini_generate_content",
    )


def _resolve_ai_route(
    *,
    lane: str = LANE_DEFAULT,
    model: Optional[str] = None,
) -> AIRoute:
    profile = _route_profile()
    normalized_lane = lane or LANE_DEFAULT
    if normalized_lane == LANE_RESUME_PARSE:
        return _resolve_openai_compatible_route(lane=LANE_RESUME_PARSE, model=model)
    if profile == AI_ROUTE_PROFILE_QWEN:
        return _resolve_openai_compatible_route(lane=normalized_lane, model=model)
    if _has_gemini_provider():
        return _resolve_gemini_route(model=model)
    return _resolve_openai_compatible_route(lane=normalized_lane, model=model)


def _should_use_qwen_thinking() -> bool:
    return _route_profile() == AI_ROUTE_PROFILE_QWEN and bool(
        getattr(settings, "ai_api_key", None)
    ) and _is_qwen_model(
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


def _build_headers(api_key: Optional[str] = None) -> Dict[str, str]:
    resolved_api_key = api_key or settings.ai_api_key
    if not resolved_api_key:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_API_KEY is not configured",
        )
    return {
        "Authorization": f"Bearer {resolved_api_key}",
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


def _build_gemini_generate_url(route: AIRoute) -> str:
    base_url = (route.base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("Gemini 服务地址未配置，无法调用 AI 生成。")
    normalized = base_url.lower()
    if not normalized.endswith("/v1beta") and not normalized.endswith("/v1"):
        base_url = f"{base_url}/v1beta"
    return f"{base_url}/models/{route.model}:generateContent"


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


async def _emit_assistant_text(
    assistant_text_callback: AssistantTextCallback,
    payload: Dict[str, Any],
) -> None:
    if not assistant_text_callback:
        return
    result = assistant_text_callback(payload)
    if inspect.isawaitable(result):
        await result


def _decode_json_string_prefix(
    text: str,
    start: int,
) -> tuple[str, bool, int]:
    if start >= len(text) or text[start] != '"':
        return "", False, start
    index = start + 1
    last_safe_index = index
    escaped = False
    while index < len(text):
        char = text[index]
        if escaped:
            if char == "u":
                unicode_end = index + 5
                if unicode_end > len(text):
                    break
                if not all(
                    item in "0123456789abcdefABCDEF"
                    for item in text[index + 1 : unicode_end]
                ):
                    break
                index = unicode_end
            else:
                index += 1
            escaped = False
            last_safe_index = index
            continue
        if char == "\\":
            escaped = True
            index += 1
            continue
        if char == '"':
            try:
                return json.loads(text[start : index + 1]), True, index + 1
            except json.JSONDecodeError:
                return "", False, start
        if ord(char) < 0x20:
            break
        index += 1
        last_safe_index = index

    if last_safe_index <= start + 1:
        return "", False, last_safe_index
    try:
        decoded = json.loads(f"{text[start:last_safe_index]}\"")
    except json.JSONDecodeError:
        return "", False, last_safe_index
    if decoded and 0xD800 <= ord(decoded[-1]) <= 0xDBFF:
        decoded = decoded[:-1]
    return decoded, False, last_safe_index


def _find_json_field_value_start(text: str, field_name: str) -> int | None:
    index = 0
    while index < len(text):
        if text[index] != '"':
            index += 1
            continue
        value, closed, end_index = _decode_json_string_prefix(text, index)
        if not closed:
            return None
        index = end_index
        if value != field_name:
            continue
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] != ":":
            continue
        index += 1
        while index < len(text) and text[index].isspace():
            index += 1
        return index
    return None


def _extract_assistant_text_prefix(text: str) -> str | None:
    value_start = _find_json_field_value_start(text, "assistantText")
    if value_start is None or value_start >= len(text) or text[value_start] != '"':
        return None
    value, _, _ = _decode_json_string_prefix(text, value_start)
    return value


class _AssistantTextDeltaTracker:
    def __init__(self, callback: AssistantTextCallback = None):
        self._callback = callback
        self._buffer = ""
        self._last_text = ""
        self._started = False

    def _events_for_chunk(self, raw_chunk: str) -> list[Dict[str, Any]]:
        if not raw_chunk:
            return []
        self._buffer = f"{self._buffer}{raw_chunk}"
        text = _extract_assistant_text_prefix(self._buffer)
        if text is None:
            return []

        events: list[Dict[str, Any]] = []
        if not self._started:
            self._started = True
            events.append({"type": "assistant_text_reset"})

        if text.startswith(self._last_text):
            delta = text[len(self._last_text) :]
        else:
            events.append({"type": "assistant_text_reset"})
            delta = text
        if delta:
            events.append({"type": "assistant_delta", "delta": delta})
        self._last_text = text
        return events

    def update(self, raw_chunk: str) -> list[Dict[str, Any]]:
        events = self._events_for_chunk(raw_chunk)
        if self._callback:
            for event in events:
                result = self._callback(event)
                if inspect.isawaitable(result):
                    raise RuntimeError("Use emit_update for async assistant text callbacks.")
        return events

    async def emit_update(self, raw_chunk: str) -> None:
        for event in self._events_for_chunk(raw_chunk):
            await _emit_assistant_text(self._callback, event)


def _safe_int(value: Any) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def _provider_from_base_url(base_url: str, model: Optional[str] = None) -> str:
    normalized = (base_url or "").lower()
    if "aifast" in normalized or str(model or "").lower().startswith("aifast"):
        return "aifast"
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


def _supports_gemini_response_mime_type(model: Optional[str] = None) -> bool:
    return not (model or "").strip().lower().startswith("gemini-3")


def _build_gemini_generation_config(
    budget_tokens: Optional[int] = None,
    *,
    model: Optional[str] = None,
    include_thoughts: bool = True,
) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "temperature": 0.2,
    }
    if include_thoughts:
        config["thinkingConfig"] = {
            "includeThoughts": True,
        }
    if _supports_gemini_response_mime_type(model):
        config["responseMimeType"] = "application/json"
    if budget_tokens is None:
        return config

    thinking_config = config.setdefault("thinkingConfig", {})
    thinking_config["thinkingBudget"] = int(budget_tokens)
    return config


def _build_gemini_request_body(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    budget_tokens: Optional[int] = None,
    model: Optional[str] = None,
    include_thoughts: bool = True,
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
            include_thoughts=include_thoughts,
        ),
    }


def _convert_openai_content_part_to_gemini(part: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(part, dict):
        return None
    if part.get("type") == "text" and isinstance(part.get("text"), str):
        return {"text": part["text"]}
    if "text" in part and isinstance(part.get("text"), str):
        return {"text": part["text"]}

    image_url = part.get("image_url")
    if part.get("type") == "image_url" and isinstance(image_url, dict):
        url = str(image_url.get("url") or "").strip()
        match = re.match(r"^data:([^;,]+);base64,(.+)$", url, re.DOTALL)
        if match:
            return {
                "inlineData": {
                    "mimeType": match.group(1),
                    "data": match.group(2),
                }
            }
        if url:
            return {"fileData": {"fileUri": url}}

    inline_data = part.get("inlineData")
    if isinstance(inline_data, dict):
        mime_type = str(inline_data.get("mimeType") or "").strip()
        data = str(inline_data.get("data") or "").strip()
        if mime_type and data:
            return {"inlineData": {"mimeType": mime_type, "data": data}}

    return None


def _convert_openai_content_to_gemini_parts(content: Any) -> List[Dict[str, Any]]:
    if isinstance(content, str):
        return [{"text": content}]
    if isinstance(content, list):
        parts = [
            converted
            for converted in (
                _convert_openai_content_part_to_gemini(part)
                for part in content
                if isinstance(part, dict)
            )
            if converted is not None
        ]
        if parts:
            return parts
    return [{"text": str(content or "")}]


def _convert_openai_content_to_non_empty_gemini_parts(content: Any) -> List[Dict[str, Any]]:
    parts = _convert_openai_content_to_gemini_parts(content)
    if len(parts) == 1 and parts[0].get("text") == "":
        return []
    return parts


def _parse_gemini_function_args(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_gemini_function_response(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        if not value.strip():
            return {}
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {"result": value}
        return parsed if isinstance(parsed, dict) else {"result": parsed}
    if value is None:
        return {}
    return {"result": value}


def _convert_openai_tool_calls_to_gemini_parts(message: Dict[str, Any]) -> List[Dict[str, Any]]:
    parts = _convert_openai_content_to_non_empty_gemini_parts(message.get("content"))
    tool_calls = message.get("tool_calls")
    if isinstance(tool_calls, list):
        for tool_call in tool_calls:
            function = tool_call.get("function") if isinstance(tool_call, dict) else None
            if not isinstance(function, dict):
                continue
            name = str(function.get("name") or "").strip()
            if not name:
                continue
            parts.append(
                {
                    "functionCall": {
                        "name": name,
                        "args": _parse_gemini_function_args(function.get("arguments")),
                    }
                }
            )
    if parts:
        return parts
    return _convert_openai_content_to_gemini_parts(message.get("content"))


def _convert_openai_tool_response_to_gemini_parts(message: Dict[str, Any]) -> List[Dict[str, Any]]:
    name = str(message.get("name") or "").strip()
    if not name:
        return _convert_openai_content_to_gemini_parts(message.get("content"))
    return [
        {
            "functionResponse": {
                "name": name,
                "response": _parse_gemini_function_response(message.get("content")),
            }
        }
    ]


def _build_gemini_generate_body(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    system_parts: List[Dict[str, Any]] = []
    contents: List[Dict[str, Any]] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = message.get("content")
        if role == "system":
            system_parts.extend(_convert_openai_content_to_gemini_parts(content))
            continue
        if role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": _convert_openai_tool_response_to_gemini_parts(message),
                }
            )
            continue
        if role == "assistant":
            contents.append(
                {
                    "role": "model",
                    "parts": _convert_openai_tool_calls_to_gemini_parts(message),
                }
            )
            continue
        contents.append(
            {
                "role": "user",
                "parts": _convert_openai_content_to_gemini_parts(content),
            }
        )

    if not contents:
        contents.append({"role": "user", "parts": [{"text": ""}]})

    generation_config: Dict[str, Any] = {"temperature": 0.3}
    if _supports_gemini_response_mime_type(model):
        generation_config["responseMimeType"] = "application/json"
    body: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": generation_config,
    }
    if system_parts:
        body["systemInstruction"] = {"parts": system_parts}
    function_declarations = _build_gemini_function_declarations(tools or [])
    if function_declarations:
        body["tools"] = [{"functionDeclarations": function_declarations}]
    return body


def _build_gemini_function_declarations(
    tools: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    declarations: List[Dict[str, Any]] = []
    for tool in tools:
        function = tool.get("function") if isinstance(tool, dict) else None
        if not isinstance(function, dict):
            continue
        name = str(function.get("name") or "").strip()
        if not name:
            continue
        declaration: Dict[str, Any] = {"name": name}
        description = function.get("description")
        if isinstance(description, str) and description.strip():
            declaration["description"] = description
        parameters = function.get("parameters")
        if isinstance(parameters, dict):
            declaration["parameters"] = parameters
        declarations.append(declaration)
    return declarations


def _extract_gemini_content(response_data: Dict[str, Any]) -> str:
    candidates = response_data.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini response missing candidates")
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    text_parts = [
        part.get("text")
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    content = "".join(text_parts).strip()
    if not content:
        raise ValueError("Gemini response missing content")
    return content


def _extract_gemini_tool_calls(response_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates = response_data.get("candidates") or []
    if not candidates:
        return []
    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
    tool_calls: List[Dict[str, Any]] = []
    for index, part in enumerate(parts):
        function_call = part.get("functionCall") if isinstance(part, dict) else None
        if not isinstance(function_call, dict):
            continue
        name = str(function_call.get("name") or "").strip()
        if not name:
            continue
        args = function_call.get("args")
        if not isinstance(args, dict):
            args = {}
        tool_calls.append(
            {
                "id": f"gemini-call-{index}",
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": json.dumps(args, ensure_ascii=False),
                },
            }
        )
    return tool_calls


async def _call_gemini_generate_content(
    messages: List[Dict[str, Any]],
    *,
    route: AIRoute,
    json_mode: bool,
    usage_callback: UsageCallback,
    request_label: str,
) -> Dict[str, Any]:
    if not route.api_key:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY is not configured",
        )
    url = _build_gemini_generate_url(route)
    payload = _build_gemini_generate_body(messages, model=route.model)
    try:
        async with httpx.AsyncClient(timeout=_build_gemini_timeout()) as client:
            response = await client.post(
                url,
                headers={
                    "x-goog-api-key": route.api_key or "",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                await _emit_failed_usage(
                    usage_callback,
                    provider=route.provider,
                    model=route.model,
                    request_label=request_label,
                    metadata={
                        "transport": route.transport,
                        "http_status": response.status_code,
                    },
                )
                raise
            data = response.json()
            _log_http_success(response, route.model, len(messages))
            await _emit_usage_from_response(
                usage_callback,
                data,
                provider=route.provider,
                model=route.model,
                request_label=request_label,
                metadata={"transport": route.transport},
            )
    except httpx.TimeoutException as exc:
        logger.error(
            "Gemini request timed out: url=%s model=%s messages=%s read_timeout=%ss",
            url,
            route.model,
            len(messages),
            settings.ai_timeout_seconds,
        )
        await _emit_failed_usage(
            usage_callback,
            provider=route.provider,
            model=route.model,
            request_label=request_label,
            metadata={"transport": route.transport, "error": "timeout"},
        )
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                "AI analysis timed out. The request took too long to finish; "
                "please try again later."
            ),
        ) from exc

    content = _extract_gemini_content(data)
    if json_mode:
        return _parse_json_content(content)
    return {"content": content}


async def _post_gemini_chat_completion(
    payload: Dict[str, Any],
    *,
    route: AIRoute,
    usage_callback: UsageCallback,
    request_label: str,
) -> Dict[str, Any]:
    if not route.api_key:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY is not configured",
        )
    url = _build_gemini_generate_url(route)
    request_body = _build_gemini_generate_body(
        payload.get("messages") or [],
        tools=payload.get("tools") or [],
        model=route.model,
    )
    try:
        async with httpx.AsyncClient(timeout=_build_gemini_timeout()) as client:
            response = await client.post(
                url,
                headers={
                    "x-goog-api-key": route.api_key,
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                await _emit_failed_usage(
                    usage_callback,
                    provider=route.provider,
                    model=route.model,
                    request_label=request_label,
                    metadata={
                        "transport": route.transport,
                        "http_status": response.status_code,
                    },
                )
                raise
            data = response.json()
            _log_http_success(response, route.model, len(payload.get("messages") or []))
            await _emit_usage_from_response(
                usage_callback,
                data,
                provider=route.provider,
                model=route.model,
                request_label=request_label,
                metadata={"transport": route.transport},
            )
    except httpx.TimeoutException as exc:
        await _emit_failed_usage(
            usage_callback,
            provider=route.provider,
            model=route.model,
            request_label=request_label,
            metadata={"transport": route.transport, "error": "timeout"},
        )
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                "AI analysis timed out. The request took too long to finish; "
                "please try again later."
            ),
        ) from exc

    tool_calls = _extract_gemini_tool_calls(data)
    if tool_calls:
        return {"choices": [{"message": {"role": "assistant", "tool_calls": tool_calls}}]}
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": _extract_gemini_content(data),
                }
            }
        ]
    }


async def _stream_gemini_json_response_legacy(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
    assistant_text_callback: AssistantTextCallback = None,
    enable_thinking: bool = True,
    usage_callback: UsageCallback = None,
) -> Dict[str, Any]:
    model = settings.gemini_model
    request_body = _build_gemini_request_body(
        system_prompt=system_prompt,
        user_parts=user_parts,
        budget_tokens=budget_tokens,
        model=model,
        include_thoughts=enable_thinking,
    )
    url = _build_gemini_stream_url(model)
    answer_parts: List[str] = []
    answer_snapshots: List[str] = []
    assistant_text_tracker = _AssistantTextDeltaTracker(assistant_text_callback)
    final_usage: Dict[str, Any] | None = None
    emitted_thought_text = False
    saw_hidden_thought_signature = False

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
                        if "thoughtSignature" in part and part.get("thought") is not True:
                            saw_hidden_thought_signature = True
                        text = part.get("text")
                        if not isinstance(text, str) or not text:
                            continue
                        if part.get("thought") is True:
                            emitted_thought_text = True
                            await _emit_thought(
                                thought_callback,
                                {"type": "thought", "summary": text},
                            )
                            continue
                        answer_parts.append(text)
                        event_answer_parts.append(text)
                        await assistant_text_tracker.emit_update(text)
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
    if enable_thinking and saw_hidden_thought_signature and not emitted_thought_text:
        await _emit_thought(
            thought_callback,
            {
                "type": "thought_status",
                "status": "hidden",
                "summary": GEMINI_HIDDEN_THOUGHT_STATUS_SUMMARY,
            },
        )
    await _emit_usage_payload(
        usage_callback,
        _build_usage_payload(
            final_usage or {},
            provider="gemini",
            model=model,
            request_label=request_label,
            status="success" if final_usage else "usage_missing",
            metadata={"transport": "gemini_stream_generate_content"},
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
    assistant_text_callback: AssistantTextCallback = None,
    enable_thinking: bool = True,
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
        "enable_thinking": enable_thinking,
    }

    answer_parts: List[str] = []
    answer_snapshots: List[str] = []
    assistant_text_tracker = _AssistantTextDeltaTracker(assistant_text_callback)
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
                            await assistant_text_tracker.emit_update(delta)
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
                                await assistant_text_tracker.emit_update(message_text)
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
                                    await assistant_text_tracker.emit_update(message_text)
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
    assistant_text_callback: AssistantTextCallback = None,
    enable_thinking: bool = True,
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
        "enable_thinking": enable_thinking,
    }
    if enable_thinking and budget_tokens is not None:
        payload["thinking_budget"] = int(budget_tokens)

    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    answer_parts: List[str] = []
    answer_snapshots: List[str] = []
    assistant_text_tracker = _AssistantTextDeltaTracker(assistant_text_callback)
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
                        await assistant_text_tracker.emit_update(content)
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
    assistant_text_callback: AssistantTextCallback = None,
    enable_thinking: bool = True,
    usage_callback: UsageCallback = None,
) -> Dict[str, Any]:
    stream_route = _resolve_ai_route(lane=LANE_THINKING)

    async def record_stream_failure(error: Exception) -> None:
        await _emit_failed_usage(
            usage_callback,
            provider=stream_route.provider,
            model=stream_route.model,
            request_label=request_label,
            metadata={
                "transport": "thinking_stream",
                "error": type(error).__name__,
            },
        )

    if _should_use_qwen_thinking() and enable_thinking:
        try:
            return await _stream_qwen_responses_json_response(
                system_prompt=system_prompt,
                user_parts=user_parts,
                error_message=error_message,
                request_label=request_label,
                thought_callback=thought_callback,
                assistant_text_callback=assistant_text_callback,
                enable_thinking=enable_thinking,
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
                    assistant_text_callback=assistant_text_callback,
                    enable_thinking=enable_thinking,
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
                            assistant_text_callback=assistant_text_callback,
                            enable_thinking=enable_thinking,
                            usage_callback=usage_callback,
                        )
                    except Exception as gemini_error:
                        await record_stream_failure(gemini_error)
                        raise
                await record_stream_failure(qwen_chat_error)
                raise

    if _should_use_qwen_thinking():
        try:
            return await _stream_qwen_json_response(
                system_prompt=system_prompt,
                user_parts=user_parts,
                error_message=error_message,
                request_label=request_label,
                budget_tokens=budget_tokens,
                thought_callback=thought_callback,
                assistant_text_callback=assistant_text_callback,
                enable_thinking=False,
                usage_callback=usage_callback,
            )
        except Exception as qwen_chat_error:
            logger.warning(
                "[AI Stream] Qwen Chat Completions text streaming failed for %s.",
                request_label,
                exc_info=True,
            )
            if not getattr(settings, "gemini_api_key", None):
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
            assistant_text_callback=assistant_text_callback,
            enable_thinking=enable_thinking,
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
    lane: str = LANE_DEFAULT,
) -> Dict[str, Any]:
    route = _resolve_ai_route(lane=lane, model=model)
    if _is_gemini_route(route):
        return await _call_gemini_generate_content(
            messages,
            route=route,
            json_mode=json_mode,
            usage_callback=usage_callback,
            request_label=request_label,
        )

    resolved_model = route.model
    payload = _prepare_chat_completion_payload({
        "model": resolved_model,
        "messages": messages,
        "temperature": 0.3,
    })
    url = f"{route.base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            response = await client.post(url, headers=_build_headers(route.api_key), json=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                await _emit_failed_usage(
                    usage_callback,
                    provider=route.provider,
                    model=payload["model"],
                    request_label=request_label,
                    metadata={
                        "transport": route.transport,
                        "http_status": response.status_code,
                    },
                )
                raise
            data = response.json()
            _log_http_success(response, payload["model"], len(messages))
            await _emit_usage_from_response(
                usage_callback,
                data,
                provider=route.provider,
                model=payload["model"],
                request_label=request_label,
                metadata={"transport": route.transport},
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
            provider=route.provider,
            model=payload["model"],
            request_label=request_label,
            metadata={"transport": route.transport, "error": "timeout"},
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
    lane: str = LANE_TOOL_CALL,
) -> Dict[str, Any]:
    route = _resolve_ai_route(
        lane=lane,
        model=str(payload.get("model") or "") or None,
    )
    if _is_gemini_route(route):
        return await _post_gemini_chat_completion(
            payload,
            route=route,
            usage_callback=usage_callback,
            request_label=request_label,
        )

    request_payload = _prepare_chat_completion_payload(payload)
    request_payload["model"] = route.model
    url = f"{route.base_url.rstrip('/')}/chat/completions"
    async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
        response = await client.post(url, headers=_build_headers(route.api_key), json=request_payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_http_error(response)
            await _emit_failed_usage(
                usage_callback,
                provider=route.provider,
                model=str(request_payload.get("model") or settings.ai_model),
                request_label=str(request_payload.get("request_label") or request_label),
                metadata={
                    "transport": route.transport,
                    "http_status": response.status_code,
                },
            )
            raise
        data = response.json()
        _log_http_success(response, request_payload["model"], len(request_payload.get("messages") or []))
        await _emit_usage_from_response(
            usage_callback,
            data,
            provider=route.provider,
            model=str(request_payload.get("model") or settings.ai_model),
            request_label=str(request_payload.get("request_label") or request_label),
            metadata={"transport": route.transport},
        )
        return data
