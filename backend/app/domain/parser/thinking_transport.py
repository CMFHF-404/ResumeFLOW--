from __future__ import annotations

import asyncio
import logging
from time import perf_counter
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx

from ..ai.sse_events import iter_sse_json_payloads
from ..ai import runtime_budget
from ..ai.llm_transport import _UsageAttempt, _build_usage_payload
from ..ai.public_errors import AiProviderPayloadError, AiProviderUnavailableError
from ..ai.response_diagnostics import response_body_log_metadata
from ..ai.upstream_response import UPSTREAM_ACCEPT_ENCODING, read_bounded_response_body
from ..ai.usage_bridge import (
    emit_usage_payload,
    record_usage_payload_best_effort,
    record_usage_payload_resilient,
)

logger = logging.getLogger("app.domain.parser.parser_service")

GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
THOUGHT_PAYLOAD_TIMEOUT_SECONDS = 180.0

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]]


def _build_gemini_headers(settings: Any) -> Dict[str, str]:
    api_key = settings.gemini_api_key
    if not api_key:
        raise AiProviderUnavailableError(
            "备用思考通道 API Key 未配置，无法返回实时思考节点。"
        )
    return {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
        "Accept-Encoding": UPSTREAM_ACCEPT_ENCODING,
    }


def _build_gemini_stream_url(settings: Any, model: str) -> str:
    base_url = (settings.gemini_base_url or "").rstrip("/")
    if not base_url:
        raise AiProviderUnavailableError(
            "备用思考通道地址未配置，无法调用实时思考节点。"
        )
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
            "maxOutputTokens": runtime_budget.get_ai_runtime_budget().max_output_tokens,
            "responseMimeType": "application/json",
            "thinkingConfig": {
                "includeThoughts": True,
            },
        },
    }


async def _iter_sse_json_payloads(response: httpx.Response):
    async for payload in iter_sse_json_payloads(
        response,
        logger=logger,
        invalid_payload_message=(
            "[ResumeParse] invalid Gemini SSE payload: %s"
        ),
        invalid_trailing_payload_message=(
            "[ResumeParse] invalid Gemini SSE trailing payload: %s"
        ),
    ):
        yield payload


async def _record_known_resume_parse_usage_best_effort(
    model: str,
    usage: Dict[str, Any] | None,
) -> None:
    if not isinstance(usage, dict):
        return
    try:
        payload = _build_usage_payload(
            usage,
            provider="gemini",
            model=model,
            request_label="resume_parse",
            metadata={
                "transport": "gemini_stream_generate_content",
                "finalized_during_cleanup": True,
            },
        )
    except Exception as exc:
        logger.error(
            "[ResumeParse] cleanup usage payload rejected error_type=%s",
            type(exc).__name__,
        )
        return
    await record_usage_payload_best_effort(payload)


def _gemini_payload_has_final_usage(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload.get("usageMetadata"), dict):
        return False
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return True
    return any(
        isinstance(candidate, dict) and bool(candidate.get("finishReason"))
        for candidate in candidates
    )


@runtime_budget.ai_wall_clock_limited
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
    final_usage: Dict[str, Any] | None = None
    usage_persistence_started = False
    usage_persisted = False
    call_start = perf_counter()
    error_body: bytes | None = None
    usage_attempt = _UsageAttempt(
        usage_callback=None,
        provider="gemini",
        model=model,
        request_label="resume_parse",
        transport="gemini_stream_generate_content",
    )

    try:
        async with httpx_module.AsyncClient(timeout=build_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=build_headers(),
                json=request_body,
            ) as response:
                if int(getattr(response, "status_code", 200)) >= 300:
                    error_body = await read_bounded_response_body(response)
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body = await read_bounded_response_body(response)
                    _, body_bytes, body_sha256 = response_body_log_metadata(
                        response,
                        body,
                    )
                    logger.error(
                        "[ResumeParse] Gemini proxy returned unexpected content-type request_id=%s content_type=%s body_bytes=%s body_sha256=%s",
                        request_id,
                        content_type,
                        body_bytes,
                        body_sha256,
                    )
                    content_type_error = AiProviderPayloadError(
                        "备用思考通道返回了非流式响应，请检查服务地址配置。"
                    )
                    await usage_attempt.fail_once(
                        content_type_error,
                        error_type="unexpected_content_type",
                    )
                    raise content_type_error
                async with asyncio.timeout(build_payload_timeout_seconds()):
                    async for payload in iter_sse_json_payloads(response):
                        usage = payload.get("usageMetadata")
                        if isinstance(usage, dict):
                            final_usage = usage
                            if (
                                not usage_persistence_started
                                and _gemini_payload_has_final_usage(payload)
                            ):
                                usage_attempt.begin_final_usage()
                                usage_persistence_started = True
                                await record_usage_payload_resilient(
                                    _build_usage_payload(
                                        final_usage,
                                        provider="gemini",
                                        model=model,
                                        request_label="resume_parse",
                                        metadata={
                                            "transport": "gemini_stream_generate_content"
                                        },
                                    )
                                )
                                usage_persisted = True
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
        content_type, body_bytes, body_sha256 = response_body_log_metadata(
            exc.response,
            error_body,
        )
        logger.error(
            "[ResumeParse] Gemini thinking request failed request_id=%s status=%s content_type=%s body_bytes=%s body_sha256=%s",
            request_id,
            exc.response.status_code,
            content_type,
            body_bytes,
            body_sha256,
        )
        await usage_attempt.fail_once(
            exc,
            error_type="http_status",
            metadata={"http_status": exc.response.status_code},
        )
        translated_error = AiProviderUnavailableError(
            "AI 深度解析失败，请稍后重试。"
        )
        await usage_attempt.fail_once(translated_error)
        raise translated_error from exc
    except httpx_module.TimeoutException as exc:
        if final_usage is not None and not usage_persistence_started:
            usage_attempt.begin_final_usage()
            await _record_known_resume_parse_usage_best_effort(model, final_usage)
        elif final_usage is None:
            await usage_attempt.fail_once(exc, error_type="timeout")
        raise runtime_budget.AiRuntimeTimeoutError(
            runtime_budget.AiRuntimeTimeoutError.public_message
        ) from exc
    except TimeoutError as exc:
        if final_usage is not None and not usage_persistence_started:
            usage_attempt.begin_final_usage()
            await _record_known_resume_parse_usage_best_effort(model, final_usage)
        elif final_usage is None:
            await usage_attempt.fail_once(exc, error_type="timeout")
        raise runtime_budget.AiRuntimeTimeoutError(
            runtime_budget.AiRuntimeTimeoutError.public_message
        ) from exc
    except asyncio.CancelledError as exc:
        if final_usage is not None and not usage_persistence_started:
            usage_attempt.begin_final_usage()
            await _record_known_resume_parse_usage_best_effort(model, final_usage)
        elif final_usage is None:
            await usage_attempt.fail_once(exc, error_type="cancelled")
        raise
    except runtime_budget.TERMINAL_AI_RUNTIME_ERRORS as exc:
        if final_usage is not None and not usage_persistence_started:
            usage_attempt.begin_final_usage()
            await _record_known_resume_parse_usage_best_effort(model, final_usage)
        elif final_usage is None:
            await usage_attempt.fail_once(exc)
        raise
    except Exception as exc:
        if final_usage is not None and not usage_persistence_started:
            usage_attempt.begin_final_usage()
            await _record_known_resume_parse_usage_best_effort(model, final_usage)
        elif final_usage is None:
            await usage_attempt.fail_once(exc)
        raise

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
    usage_attempt.begin_final_usage()
    if not usage_persisted:
        await emit_usage_payload(
            None,
            _build_usage_payload(
                final_usage or {},
                provider="gemini",
                model=model,
                request_label="resume_parse",
                status="success" if final_usage else "usage_missing",
                metadata={"transport": "gemini_stream_generate_content"},
            ),
        )
    if not answer_text:
        raise AiProviderPayloadError("备用思考通道未返回可解析的结构化结果。")
    return normalize_parse_result(parse_structured_response_text(answer_text))
