from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

from .runtime_budget import (
    AiRuntimeBudget,
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
    get_ai_runtime_budget,
)


RAW_RESPONSE_CHUNK_BYTES = 64 * 1024
UPSTREAM_ACCEPT_ENCODING = "identity"


def _reject_compressed_response(response: Any) -> None:
    headers = getattr(response, "headers", {}) or {}
    content_encoding = str(headers.get("content-encoding") or "").strip().lower()
    if content_encoding and content_encoding != UPSTREAM_ACCEPT_ENCODING:
        raise AiRuntimeBudgetExceeded(
            "Compressed AI upstream responses are not permitted."
        )


async def iter_bounded_response_bytes(
    response: Any,
    *,
    budget: AiRuntimeBudget | None = None,
) -> AsyncIterator[bytes]:
    """Read decoded upstream bytes incrementally before any line/body buffering."""
    resolved_budget = budget or get_ai_runtime_budget()
    _reject_compressed_response(response)
    chunk_size = min(
        RAW_RESPONSE_CHUNK_BYTES,
        resolved_budget.max_sse_total_bytes + 1,
    )
    iterator = response.aiter_bytes(chunk_size=chunk_size).__aiter__()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + resolved_budget.stream_total_timeout_seconds
    total_bytes = 0

    while True:
        remaining_seconds = deadline - loop.time()
        if remaining_seconds <= 0:
            raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)
        try:
            async with asyncio.timeout(remaining_seconds):
                chunk = await iterator.__anext__()
        except StopAsyncIteration:
            break
        except TimeoutError as exc:
            raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message) from exc

        if not chunk:
            continue
        decoded_chunk = bytes(chunk)
        if len(decoded_chunk) > RAW_RESPONSE_CHUNK_BYTES:
            raise AiRuntimeBudgetExceeded(
                "AI upstream response violated the decoded chunk-size budget."
            )
        total_bytes += len(decoded_chunk)
        if total_bytes > resolved_budget.max_sse_total_bytes:
            raise AiRuntimeBudgetExceeded(
                "AI upstream response exceeded the cumulative byte budget."
            )
        yield decoded_chunk


async def read_bounded_response_body(
    response: Any,
    *,
    budget: AiRuntimeBudget | None = None,
) -> bytes:
    chunks: list[bytes] = []
    async for chunk in iter_bounded_response_bytes(response, budget=budget):
        chunks.append(chunk)
    return b"".join(chunks)
