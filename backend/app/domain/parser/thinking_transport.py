from __future__ import annotations

import asyncio
import json
import logging
from time import perf_counter
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx

logger = logging.getLogger("app.domain.parser.parser_service")

GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
THOUGHT_PAYLOAD_TIMEOUT_SECONDS = 180.0

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]]


def _build_gemini_headers(settings: Any) -> Dict[str, str]:
    api_key = settings.gemini_api_key
    if not api_key:
        raise ValueError("GEMINI_API_KEY 未配置，无法返回 Gemini 实时思考节点。")
    return {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }


def _build_gemini_stream_url(settings: Any, model: str) -> str:
    base_url = (settings.gemini_base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("GEMINI_BASE_URL 未配置，无法调用 Gemini Thinking。")
    normalized = base_url.lower()
    if not normalized.endswith("/v1beta") and not normalized.endswith("/v1"):
        base_url = f"{base_url}/v1beta"
    return f"{base_url}/models/{model}:streamGenerateContent?alt=sse"


def _build_gemini_timeout(settings: Any) -> httpx.Timeout:
    return httpx.Timeout(
        connect=GEMINI_CONNECT_TIMEOUT_SECONDS,
        write=float(settings.ai_timeout_seconds),
        read=float(settings.ai_timeout_seconds),
        pool=GEMINI_POOL_TIMEOUT_SECONDS,
    )


def _build_gemini_payload_timeout_seconds(
    settings: Any,
    max_timeout_seconds: float = THOUGHT_PAYLOAD_TIMEOUT_SECONDS,
) -> float:
    return min(float(settings.ai_timeout_seconds), max_timeout_seconds)


def _build_resume_thinking_request(cleaned_text: str, prompt: str) -> Dict[str, Any]:
    return {
        "systemInstruction": {
            "parts": [{"text": prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "请解析以下简历正文，并严格输出 JSON。"
                            "不要补充正文中不存在的信息。\n\n"
                            f"{cleaned_text}"
                        )
                    }
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "thinkingConfig": {
                "includeThoughts": True,
            },
        },
    }


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
                logger.warning("[ResumeParse] invalid Gemini SSE payload: %s", payload[:500])
            continue
        event_lines.append(line)

    if event_lines:
        payload = build_payload(event_lines)
        if payload and payload != "[DONE]":
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("[ResumeParse] invalid Gemini SSE trailing payload: %s", payload[:500])


async def stream_resume_thinking_parse(
    *,
    cleaned_text: str,
    request_id: Optional[str],
    thought_callback: ThoughtCallback,
    settings: Any,
    request_body: Dict[str, Any],
    build_headers: Callable[[], Dict[str, str]],
    build_stream_url: Callable[[str], str],
    build_timeout: Callable[[], httpx.Timeout],
    build_payload_timeout_seconds: Callable[[], float],
    iter_sse_json_payloads: Callable[[httpx.Response], Any],
    emit_thought: Callable[[ThoughtCallback, Dict[str, Any]], Awaitable[None]],
    parse_structured_response_text: Callable[[str], Dict[str, Any]],
    normalize_parse_result: Callable[[Any], Dict[str, Any]],
    log_timing: Callable[[str, float, Optional[str], Optional[Dict[str, Any]]], None],
    httpx_module: Any = httpx,
) -> Dict[str, Any]:
    model = settings.gemini_model
    url = build_stream_url(model)
    answer_parts: List[str] = []
    call_start = perf_counter()

    try:
        async with httpx_module.AsyncClient(timeout=build_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=build_headers(),
                json=request_body,
            ) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body_preview = (await response.aread()).decode("utf-8", errors="ignore")[:800]
                    logger.error(
                        "[ResumeParse] Gemini proxy returned unexpected content-type request_id=%s content_type=%s body=%s",
                        request_id,
                        content_type,
                        body_preview,
                    )
                    raise ValueError(
                        "Gemini 中转站返回了非流式响应，请检查 GEMINI_BASE_URL 是否需要包含 /v1beta。"
                    )
                payload_iter = iter_sse_json_payloads(response).__aiter__()
                while True:
                    try:
                        payload = await asyncio.wait_for(
                            payload_iter.__anext__(),
                            timeout=build_payload_timeout_seconds(),
                        )
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError as exc:
                        raise ValueError(
                            "Gemini Thinking 长时间未收到新的解析流数据，请稍后重试。"
                        ) from exc
                    candidates = payload.get("candidates") or []
                    if not candidates:
                        continue
                    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
                    for part in parts:
                        text = part.get("text")
                        if not isinstance(text, str) or not text:
                            continue
                        if part.get("thought") is True:
                            await emit_thought(
                                thought_callback,
                                {"type": "thought", "summary": text},
                            )
                            continue
                        answer_parts.append(text)
    except httpx_module.HTTPStatusError as exc:
        try:
            await exc.response.aread()
            error_text = exc.response.text[:1000]
        except Exception:
            error_text = "Failed to read response body."
        logger.error(
            "[ResumeParse] Gemini thinking request failed request_id=%s status=%s body=%s",
            request_id,
            exc.response.status_code,
            error_text,
        )
        raise ValueError("Gemini Thinking 解析失败，请稍后重试。") from exc
    except httpx_module.TimeoutException as exc:
        raise ValueError("Gemini Thinking 解析超时，请稍后重试。") from exc

    call_ms = (perf_counter() - call_start) * 1000
    log_timing(
        "ai_call",
        call_ms,
        request_id,
        {
            "mode": "gemini_thinking",
            "input_length": len(cleaned_text),
        },
    )

    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        raise ValueError("Gemini 未返回可解析的结构化结果。")
    return normalize_parse_result(parse_structured_response_text(answer_text))
