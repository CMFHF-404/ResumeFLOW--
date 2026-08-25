from __future__ import annotations

import asyncio
import json
import logging
import inspect
from typing import Any, AsyncIterator, List

from .runtime_budget import (
    AiRuntimeBudget,
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
    get_ai_runtime_budget,
)
from .response_diagnostics import safe_body_log_summary
from .upstream_response import iter_bounded_response_bytes


SSE_RESPONSE_CLOSE_MAX_SECONDS = 0.1


def _decode_sse_line(raw_line: bytes, response: Any) -> str:
    encoding = getattr(response, "encoding", None) or "utf-8"
    try:
        return raw_line.decode(encoding, errors="replace")
    except LookupError:
        return raw_line.decode("utf-8", errors="replace")


async def _iter_bounded_sse_lines(
    response: Any,
    budget: AiRuntimeBudget,
) -> AsyncIterator[tuple[str, int]]:
    line_buffer = bytearray()
    skip_leading_lf = False
    loop = asyncio.get_running_loop()
    deadline = loop.time() + budget.stream_total_timeout_seconds

    async for chunk in iter_bounded_response_bytes(response, budget=budget):
        index = 0
        while index < len(chunk):
            if skip_leading_lf:
                skip_leading_lf = False
                if chunk[index] == 0x0A:
                    index += 1
                    if index >= len(chunk):
                        break

            cr_index = chunk.find(b"\r", index)
            lf_index = chunk.find(b"\n", index)
            delimiter_indexes = [
                item for item in (cr_index, lf_index) if item >= 0
            ]
            delimiter_index = min(delimiter_indexes) if delimiter_indexes else -1
            segment_end = delimiter_index if delimiter_index >= 0 else len(chunk)
            segment = chunk[index:segment_end]
            if len(line_buffer) + len(segment) > budget.max_sse_event_bytes:
                raise AiRuntimeBudgetExceeded(
                    "AI upstream stream exceeded the single-event byte budget."
                )
            line_buffer.extend(segment)
            if delimiter_index < 0:
                break

            remaining_seconds = deadline - loop.time()
            if remaining_seconds <= 0:
                raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)
            delimiter = chunk[delimiter_index]
            yield _decode_sse_line(bytes(line_buffer), response), len(line_buffer) + 1
            line_buffer.clear()
            skip_leading_lf = delimiter == 0x0D
            index = delimiter_index + 1

    if line_buffer:
        if loop.time() >= deadline:
            raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)
        yield _decode_sse_line(bytes(line_buffer), response), len(line_buffer)


async def iter_sse_json_payloads(
    response: Any,
    *,
    logger: logging.Logger,
    invalid_payload_message: str,
    invalid_trailing_payload_message: str,
    budget: AiRuntimeBudget | None = None,
) -> AsyncIterator[Any]:
    resolved_budget = budget or get_ai_runtime_budget()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + resolved_budget.stream_total_timeout_seconds

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

    async def iter_budgeted_payloads() -> AsyncIterator[Any]:
        event_lines: List[str] = []
        event_bytes = 0
        event_count = 0
        async for line, line_bytes in _iter_bounded_sse_lines(
            response,
            resolved_budget,
        ):
            if not line.strip():
                if not event_lines:
                    continue
                event_count += 1
                if event_count > resolved_budget.max_sse_events:
                    raise AiRuntimeBudgetExceeded(
                        "AI upstream stream exceeded the event budget."
                    )
                payload = build_payload(event_lines)
                event_lines = []
                event_bytes = 0
                if not payload:
                    continue
                if payload == "[DONE]":
                    break
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    logger.warning(
                        invalid_payload_message,
                        safe_body_log_summary(payload),
                    )
                continue
            event_bytes += line_bytes
            if event_bytes > resolved_budget.max_sse_event_bytes:
                raise AiRuntimeBudgetExceeded(
                    "AI upstream stream exceeded the single-event byte budget."
                )
            event_lines.append(line)

        if event_lines:
            event_count += 1
            if event_count > resolved_budget.max_sse_events:
                raise AiRuntimeBudgetExceeded(
                    "AI upstream stream exceeded the event budget."
                )
            payload = build_payload(event_lines)
            if payload and payload != "[DONE]":
                try:
                    yield json.loads(payload)
                except json.JSONDecodeError:
                    logger.warning(
                        invalid_trailing_payload_message,
                        safe_body_log_summary(payload),
                    )

    try:
        async for payload in iter_budgeted_payloads():
            yield payload
    finally:
        close = getattr(response, "aclose", None)
        if callable(close):
            try:
                close_result = close()
                if inspect.isawaitable(close_result):
                    close_timeout = max(
                        min(
                            deadline - loop.time(),
                            SSE_RESPONSE_CLOSE_MAX_SECONDS,
                        ),
                        0.001,
                    )
                    async with asyncio.timeout(close_timeout):
                        await close_result
            except Exception as exc:
                logger.warning(
                    "AI upstream response cleanup failed error_type=%s",
                    type(exc).__name__,
                )
