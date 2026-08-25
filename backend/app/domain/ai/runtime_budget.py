from __future__ import annotations

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Any, Awaitable, Callable, Coroutine, TypeVar
import uuid

from fastapi import HTTPException, Request
from fastapi.routing import APIRoute
from starlette.status import HTTP_413_CONTENT_TOO_LARGE

from ...config import (
    DEFAULT_AI_ASSISTANT_BUFFER_MAX_CHARS,
    DEFAULT_AI_MAX_OUTPUT_TOKENS,
    DEFAULT_AI_MAX_REQUEST_BODY_BYTES,
    DEFAULT_AI_MAX_TEXT_FIELD_CHARS,
    DEFAULT_AI_STREAM_MAX_EVENT_BYTES,
    DEFAULT_AI_STREAM_MAX_EVENTS,
    DEFAULT_AI_STREAM_MAX_TOTAL_BYTES,
    DEFAULT_AI_STREAM_QUEUE_MAX_EVENTS,
    DEFAULT_AI_STREAM_TOTAL_TIMEOUT_SECONDS,
    load_settings,
)


@dataclass(frozen=True)
class AiRuntimeBudget:
    max_request_body_bytes: int = DEFAULT_AI_MAX_REQUEST_BODY_BYTES
    max_text_field_chars: int = DEFAULT_AI_MAX_TEXT_FIELD_CHARS
    max_sse_event_bytes: int = DEFAULT_AI_STREAM_MAX_EVENT_BYTES
    max_sse_total_bytes: int = DEFAULT_AI_STREAM_MAX_TOTAL_BYTES
    max_sse_events: int = DEFAULT_AI_STREAM_MAX_EVENTS
    max_assistant_buffer_chars: int = DEFAULT_AI_ASSISTANT_BUFFER_MAX_CHARS
    stream_total_timeout_seconds: float = DEFAULT_AI_STREAM_TOTAL_TIMEOUT_SECONDS
    stream_queue_max_events: int = DEFAULT_AI_STREAM_QUEUE_MAX_EVENTS
    max_output_tokens: int = DEFAULT_AI_MAX_OUTPUT_TOKENS


class AiRuntimeBudgetExceeded(ValueError):
    code = "ai_runtime_budget_exceeded"
    public_message = "AI 请求或响应超过安全处理上限，请缩短内容后重试。"
    status_code = HTTP_413_CONTENT_TOO_LARGE
    retryable = False


class AiRuntimeTimeoutError(ValueError):
    code = "ai_runtime_timeout"
    public_message = "AI 请求处理超时，请稍后重试。"
    status_code = 504
    retryable = True


class AiUsageAccountingError(RuntimeError):
    code = "ai_usage_accounting_failed"
    public_message = "AI 用量记录失败，请稍后重试。"
    status_code = 503
    retryable = True


class AiStreamConsumerError(RuntimeError):
    code = "ai_stream_consumer_failed"
    public_message = "AI 流式响应传递失败，请稍后重试。"
    status_code = 500
    retryable = False


class AiUsagePayloadError(ValueError):
    code = "ai_usage_payload_invalid"
    public_message = "AI 服务返回了无效的用量数据，请稍后重试。"
    status_code = 502
    retryable = False


TERMINAL_AI_RUNTIME_ERRORS = (
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
    AiUsageAccountingError,
    AiStreamConsumerError,
    AiUsagePayloadError,
)

_ai_runtime_deadline: ContextVar[float | None] = ContextVar(
    "ai_runtime_deadline",
    default=None,
)


def ai_runtime_http_exception(
    exc: (
        AiRuntimeBudgetExceeded
        | AiRuntimeTimeoutError
        | AiUsageAccountingError
        | AiStreamConsumerError
        | AiUsagePayloadError
    ),
) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail=exc.public_message,
    )


def get_ai_runtime_budget() -> AiRuntimeBudget:
    settings = load_settings()
    return AiRuntimeBudget(
        max_request_body_bytes=int(
            getattr(
                settings,
                "ai_max_request_body_bytes",
                DEFAULT_AI_MAX_REQUEST_BODY_BYTES,
            )
        ),
        max_text_field_chars=int(
            getattr(
                settings,
                "ai_max_text_field_chars",
                DEFAULT_AI_MAX_TEXT_FIELD_CHARS,
            )
        ),
        max_sse_event_bytes=int(
            getattr(
                settings,
                "ai_stream_max_event_bytes",
                DEFAULT_AI_STREAM_MAX_EVENT_BYTES,
            )
        ),
        max_sse_total_bytes=int(
            getattr(
                settings,
                "ai_stream_max_total_bytes",
                DEFAULT_AI_STREAM_MAX_TOTAL_BYTES,
            )
        ),
        max_sse_events=int(
            getattr(settings, "ai_stream_max_events", DEFAULT_AI_STREAM_MAX_EVENTS)
        ),
        max_assistant_buffer_chars=int(
            getattr(
                settings,
                "ai_assistant_buffer_max_chars",
                DEFAULT_AI_ASSISTANT_BUFFER_MAX_CHARS,
            )
        ),
        stream_total_timeout_seconds=float(
            getattr(
                settings,
                "ai_stream_total_timeout_seconds",
                DEFAULT_AI_STREAM_TOTAL_TIMEOUT_SECONDS,
            )
        ),
        stream_queue_max_events=int(
            getattr(
                settings,
                "ai_stream_queue_max_events",
                DEFAULT_AI_STREAM_QUEUE_MAX_EVENTS,
            )
        ),
        max_output_tokens=int(
            getattr(settings, "ai_max_output_tokens", DEFAULT_AI_MAX_OUTPUT_TOKENS)
        ),
    )


def validate_ai_text_field(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    if len(value) > get_ai_runtime_budget().max_text_field_chars:
        raise ValueError(f"{field_name} 超过 AI 文本处理上限。")
    return value


class BoundedAiRequestBodyRoute(APIRoute):
    def get_route_handler(self):
        original_route_handler = super().get_route_handler()

        async def bounded_route_handler(request: Request):
            budget = get_ai_runtime_budget()
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    declared_length = int(content_length)
                except ValueError:
                    declared_length = -1
                if declared_length > budget.max_request_body_bytes:
                    raise HTTPException(
                        status_code=HTTP_413_CONTENT_TOO_LARGE,
                        detail=AiRuntimeBudgetExceeded.public_message,
                    )

            received_bytes = 0
            original_receive = request.receive

            async def bounded_receive():
                nonlocal received_bytes
                message = await original_receive()
                if message.get("type") == "http.request":
                    received_bytes += len(message.get("body") or b"")
                    if received_bytes > budget.max_request_body_bytes:
                        raise HTTPException(
                            status_code=HTTP_413_CONTENT_TOO_LARGE,
                            detail=AiRuntimeBudgetExceeded.public_message,
                        )
                return message

            bounded_request = Request(request.scope, receive=bounded_receive)
            try:
                return await original_route_handler(bounded_request)
            except TERMINAL_AI_RUNTIME_ERRORS as exc:
                raise ai_runtime_http_exception(exc) from exc

        return bounded_route_handler


def create_bounded_event_queue(
    budget: AiRuntimeBudget | None = None,
) -> asyncio.Queue[dict[str, Any] | None]:
    resolved = budget or get_ai_runtime_budget()
    return asyncio.Queue(maxsize=resolved.stream_queue_max_events)


async def finish_event_queue(
    queue: asyncio.Queue[dict[str, Any] | None],
) -> None:
    try:
        queue.put_nowait(None)
        return
    except asyncio.QueueFull:
        current_task = asyncio.current_task()
        if current_task is not None and current_task.cancelling():
            return
    await queue.put(None)


T = TypeVar("T")


async def run_with_total_timeout(
    operation: Awaitable[T],
    *,
    budget: AiRuntimeBudget | None = None,
) -> T:
    resolved = budget or get_ai_runtime_budget()
    loop = asyncio.get_running_loop()
    requested_deadline = loop.time() + resolved.stream_total_timeout_seconds
    inherited_deadline = _ai_runtime_deadline.get()
    deadline = (
        min(inherited_deadline, requested_deadline)
        if inherited_deadline is not None
        else requested_deadline
    )
    deadline_token = _ai_runtime_deadline.set(deadline)
    try:
        async with asyncio.timeout(max(deadline - loop.time(), 0)):
            return await operation
    except TimeoutError as exc:
        raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message) from exc
    finally:
        _ai_runtime_deadline.reset(deadline_token)


AsyncFunctionT = TypeVar("AsyncFunctionT", bound=Callable[..., Coroutine[Any, Any, Any]])


def ai_wall_clock_limited(function: AsyncFunctionT) -> AsyncFunctionT:
    @wraps(function)
    async def wrapped(*args, **kwargs):
        return await run_with_total_timeout(function(*args, **kwargs))

    return wrapped  # type: ignore[return-value]


def ai_deadline_scoped(function: AsyncFunctionT) -> AsyncFunctionT:
    """Share one absolute deadline with nested AI calls without masking stream errors."""

    @wraps(function)
    async def wrapped(*args, **kwargs):
        resolved = get_ai_runtime_budget()
        loop = asyncio.get_running_loop()
        requested_deadline = loop.time() + resolved.stream_total_timeout_seconds
        inherited_deadline = _ai_runtime_deadline.get()
        deadline = (
            min(inherited_deadline, requested_deadline)
            if inherited_deadline is not None
            else requested_deadline
        )
        deadline_token = _ai_runtime_deadline.set(deadline)
        try:
            return await function(*args, **kwargs)
        finally:
            _ai_runtime_deadline.reset(deadline_token)

    return wrapped  # type: ignore[return-value]


def new_ai_request_id() -> str:
    return uuid.uuid4().hex


def build_public_stream_error_event(
    exc: Exception,
    *,
    request_id: str,
    preserve_value_error: bool = False,
    preserve_exceptions: tuple[type[Exception], ...] = (),
) -> dict[str, Any]:
    if isinstance(exc, HTTPException):
        message = exc.detail if isinstance(exc.detail, str) else "请求处理失败。"
        return {
            "type": "error",
            "code": "http_error",
            "message": message,
            "requestId": request_id,
            "statusCode": exc.status_code,
            "retryable": exc.status_code == 504,
        }
    if isinstance(exc, TERMINAL_AI_RUNTIME_ERRORS):
        return {
            "type": "error",
            "code": exc.code,
            "message": exc.public_message,
            "requestId": request_id,
            "statusCode": exc.status_code,
            "retryable": exc.retryable,
        }
    if preserve_value_error and isinstance(exc, ValueError):
        return {
            "type": "error",
            "code": "request_failed",
            "message": str(exc),
            "requestId": request_id,
            "retryable": False,
        }
    if preserve_exceptions and isinstance(exc, preserve_exceptions):
        return {
            "type": "error",
            "code": "request_failed",
            "message": str(exc),
            "requestId": request_id,
            "retryable": False,
        }
    return {
        "type": "error",
        "code": "internal_error",
        "message": "请求处理失败，请稍后重试。",
        "requestId": request_id,
        "retryable": False,
    }
