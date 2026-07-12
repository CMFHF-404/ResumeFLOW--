from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional


UsageCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
UsageCallbackEmitter = Callable[
    [UsageCallback, Dict[str, Any]], Awaitable[None]
]
UsageRecorder = Callable[[Dict[str, Any]], Awaitable[None]]


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

    async def emit(
        self,
        usage_callback: UsageCallback,
        payload: Dict[str, Any],
    ) -> None:
        await self.callback_emitter(usage_callback, payload)
        await self.recorder(payload)


_usage_sink = UsageSink()


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
