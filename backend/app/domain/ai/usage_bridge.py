from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional


UsageCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
UsageCallbackEmitter = Callable[
    [UsageCallback, Dict[str, Any]], Awaitable[None]
]
UsageRecorder = Callable[[Dict[str, Any]], Awaitable[None]]
logger = logging.getLogger(__name__)


async def _emit_usage_callback(
    usage_callback: UsageCallback,
    payload: Dict[str, Any],
) -> None:
    if not usage_callback:
        return
    result = usage_callback(payload)
    if inspect.isawaitable(result):
        await result


async def _ignore_usage(_payload: Dict[str, Any]) -> None:
    return None


@dataclass(frozen=True)
class UsageSink:
    callback_emitter: UsageCallbackEmitter = _emit_usage_callback
    recorder: UsageRecorder = _ignore_usage

    async def record(self, payload: Dict[str, Any]) -> None:
        from .runtime_budget import AiUsageAccountingError

        try:
            await self.recorder(payload)
        except AiUsageAccountingError:
            raise
        except Exception as exc:
            logger.error(
                "AI usage recorder failed error_type=%s",
                type(exc).__name__,
            )
            raise AiUsageAccountingError(
                AiUsageAccountingError.public_message
            ) from exc

    async def emit_callback(
        self,
        usage_callback: UsageCallback,
        payload: Dict[str, Any],
    ) -> None:
        from .runtime_budget import AiUsageAccountingError

        try:
            await self.callback_emitter(usage_callback, payload)
        except AiUsageAccountingError:
            raise
        except Exception as exc:
            logger.error(
                "AI usage callback failed error_type=%s",
                type(exc).__name__,
            )
            raise AiUsageAccountingError(
                AiUsageAccountingError.public_message
            ) from exc

    async def emit(
        self,
        usage_callback: UsageCallback,
        payload: Dict[str, Any],
    ) -> None:
        from .runtime_budget import AiUsageAccountingError

        first_error: AiUsageAccountingError | None = None
        try:
            await self.record(payload)
        except AiUsageAccountingError as exc:
            first_error = exc

        try:
            await self.emit_callback(usage_callback, payload)
        except AiUsageAccountingError as exc:
            if first_error is None:
                first_error = exc

        if first_error is not None:
            raise first_error


_usage_sink = UsageSink()
MAX_USAGE_CLEANUP_TIMEOUT_SECONDS = 5.0


def configure_usage_sink(
    *,
    callback_emitter: UsageCallbackEmitter,
    recorder: UsageRecorder,
) -> None:
    """Install the application-level usage handlers without importing them here."""

    global _usage_sink
    _usage_sink = UsageSink(
        callback_emitter=callback_emitter,
        recorder=recorder,
    )


async def emit_usage_payload(
    usage_callback: UsageCallback,
    payload: Dict[str, Any],
) -> None:
    await _usage_sink.emit(usage_callback, payload)


async def emit_usage_callback(
    usage_callback: UsageCallback,
    payload: Dict[str, Any],
) -> None:
    await _usage_sink.emit_callback(usage_callback, payload)


async def record_usage_payload(payload: Dict[str, Any]) -> None:
    """Persist usage without invoking an optional request-scoped callback."""

    await _usage_sink.record(payload)


def usage_cleanup_timeout_seconds() -> float:
    from .runtime_budget import get_ai_runtime_budget

    return max(
        min(
            float(get_ai_runtime_budget().stream_total_timeout_seconds),
            MAX_USAGE_CLEANUP_TIMEOUT_SECONDS,
        ),
        0.001,
    )


async def record_usage_payload_resilient(payload: Dict[str, Any]) -> None:
    """Persist usage synchronously before any final-payload consumer callback."""

    recorder_task = asyncio.create_task(record_usage_payload(payload))
    try:
        await asyncio.shield(recorder_task)
    except asyncio.CancelledError:
        try:
            async with asyncio.timeout(usage_cleanup_timeout_seconds()):
                await recorder_task
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "AI cancellation cleanup usage accounting failed error_type=%s",
                type(exc).__name__,
            )
        finally:
            if not recorder_task.done():
                recorder_task.cancel()
            await asyncio.gather(recorder_task, return_exceptions=True)
        raise


async def record_usage_payload_best_effort(payload: Dict[str, Any]) -> None:
    """Persist cleanup usage without replacing a primary non-cancellation error."""

    try:
        async with asyncio.timeout(usage_cleanup_timeout_seconds()):
            await record_usage_payload(payload)
    except Exception as exc:
        logger.error(
            "AI cleanup usage accounting failed error_type=%s",
            type(exc).__name__,
        )
