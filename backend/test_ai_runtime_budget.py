import asyncio
import gzip
import json
import logging
import os
import io
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import ValidationError

from app.domain.ai import (
    ai_router,
    ai_service,
    assistant_tool_utils,
    assistant_text_stream,
    llm_transport,
    sse_events,
    upstream_response,
    usage_bridge,
)
from app.domain.assistant import assistant_context_service, assistant_router
from app.domain.parser import document_text, parser_router, parser_service, thinking_transport
from app import config
from app.domain.ai.runtime_budget import (
    AiRuntimeBudget,
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
    AiStreamConsumerError,
    AiUsageAccountingError,
    AiUsagePayloadError,
    BoundedAiRequestBodyRoute,
    ai_deadline_scoped,
    build_public_stream_error_event,
    create_bounded_event_queue,
    finish_event_queue,
    run_with_total_timeout,
)
from app.domain.agent.schemas import AgentJobRequest
from app.domain.assistant.schemas import AssistantSessionStreamRequest


class _FakeSseResponse:
    def __init__(self, lines, *, status_code=200, content_type="text/event-stream"):
        self._lines = list(lines)
        self.closed = False
        self.status_code = status_code
        self.headers = {"content-type": content_type}
        self.request = httpx.Request("POST", "https://provider.example/stream")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "provider request failed",
                request=self.request,
                response=self,
            )
        return None

    async def aiter_bytes(self, chunk_size=None):
        for line in self._lines:
            data = f"{line}\n".encode("utf-8")
            resolved_chunk_size = chunk_size or len(data) or 1
            for index in range(0, len(data), resolved_chunk_size):
                yield data[index : index + resolved_chunk_size]

    async def aclose(self):
        self.closed = True


class _SlowSseResponse(_FakeSseResponse):
    async def aiter_bytes(self, chunk_size=None):
        del chunk_size
        while True:
            await asyncio.sleep(1)
            yield b'data: {"ok":true}\n'


class _YieldThenSlowSseResponse(_FakeSseResponse):
    async def aiter_bytes(self, chunk_size=None):
        del chunk_size
        yield b'data: {"ok":true}\n\n'
        await asyncio.sleep(10)


class _RawChunkSseResponse:
    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.chunks_yielded = 0
        self.closed = False

    async def aiter_bytes(self, chunk_size=None):
        del chunk_size
        for chunk in self._chunks:
            self.chunks_yielded += 1
            yield chunk

    async def aiter_lines(self):
        raise AssertionError("SSE budgets must run before line buffering")
        yield ""  # pragma: no cover

    async def aclose(self):
        self.closed = True


class _CompressedResponse:
    def __init__(self):
        self.headers = {"content-encoding": "gzip"}
        self.aiter_bytes_called = False

    async def aiter_bytes(self, chunk_size=None):
        del chunk_size
        self.aiter_bytes_called = True
        raise AssertionError("compressed response must be rejected before decoding")
        yield b""  # pragma: no cover


class _CanaryCompressedByteStream(httpx.AsyncByteStream):
    def __init__(self):
        self.iterated = False

    async def __aiter__(self):
        self.iterated = True
        yield gzip.compress(b"CANARY_GZIP_BOMB" * 1_000_000)


class _ResponseContext:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, traceback):
        await self.response.aclose()
        return False


class _NonStreamingClient:
    def __init__(self, response):
        self.response = response
        self.post_calls = 0
        self.stream_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, *args, **kwargs):
        del args, kwargs
        self.post_calls += 1
        return self.response

    def stream(self, *args, **kwargs):
        del args, kwargs
        self.stream_calls += 1
        return _ResponseContext(self.response)


class _TimeoutStreamContext:
    async def __aenter__(self):
        raise httpx.ReadTimeout("CANARY_PROVIDER_TIMEOUT_DETAIL")

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _TimeoutStreamClient:
    def __init__(self):
        self.stream_calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def stream(self, *args, **kwargs):
        self.stream_calls.append((args, kwargs))
        return _TimeoutStreamContext()


class _BlockingStreamContext:
    def __init__(self, started):
        self.started = started

    async def __aenter__(self):
        self.started.set()
        await asyncio.Future()

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _BlockingStreamClient:
    def __init__(self):
        self.started = asyncio.Event()
        self.stream_calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def stream(self, *args, **kwargs):
        self.stream_calls.append((args, kwargs))
        return _BlockingStreamContext(self.started)


class _CloseFailingSseResponse(_RawChunkSseResponse):
    async def aclose(self):
        self.closed = True
        raise RuntimeError("CANARY_CLOSE_FAILURE")


class _CloseFailingSlowSseResponse(_CloseFailingSseResponse):
    async def aiter_bytes(self, chunk_size=None):
        del chunk_size
        await asyncio.Future()
        yield b""  # pragma: no cover


class _BlockingCloseSseResponse(_RawChunkSseResponse):
    def __init__(self, chunks):
        super().__init__(chunks)
        self.close_started = asyncio.Event()
        self.close_cancelled = asyncio.Event()

    async def aclose(self):
        self.close_started.set()
        try:
            await asyncio.Future()
        finally:
            self.closed = True
            self.close_cancelled.set()


class _AsyncContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, traceback):
        return False


def _budget(**overrides):
    values = {
        "max_request_body_bytes": 128,
        "max_text_field_chars": 12,
        "max_sse_event_bytes": 24,
        "max_sse_total_bytes": 64,
        "max_sse_events": 3,
        "max_assistant_buffer_chars": 16,
        "stream_total_timeout_seconds": 0.01,
        "stream_queue_max_events": 1,
        "max_output_tokens": 77,
    }
    values.update(overrides)
    return AiRuntimeBudget(**values)


class AiRuntimeBudgetTests(unittest.IsolatedAsyncioTestCase):
    def test_budget_defaults_are_finite_and_match_documented_safety_values(self):
        budget = AiRuntimeBudget()
        self.assertEqual(budget.max_request_body_bytes, 8 * 1024 * 1024)
        self.assertEqual(budget.max_text_field_chars, 200_000)
        self.assertEqual(budget.max_sse_event_bytes, 256 * 1024)
        self.assertEqual(budget.max_sse_total_bytes, 4 * 1024 * 1024)
        self.assertEqual(budget.max_sse_events, 10_000)
        self.assertEqual(budget.max_assistant_buffer_chars, 1_048_576)
        self.assertEqual(budget.stream_total_timeout_seconds, 360)
        self.assertEqual(budget.stream_queue_max_events, 64)
        self.assertEqual(budget.max_output_tokens, 16_384)

    def test_budget_env_parser_accepts_upper_bound_and_rejects_bad_config(self):
        with patch.dict(os.environ, {"BUDGET_TEST": "100"}, clear=False):
            self.assertEqual(
                config._get_bounded_int_env(
                    "BUDGET_TEST",
                    10,
                    minimum=1,
                    maximum=100,
                ),
                100,
            )

        for value in ("not-an-int", "0", "101"):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"BUDGET_TEST": value}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "Invalid BUDGET_TEST"):
                        config._get_bounded_int_env(
                            "BUDGET_TEST",
                            10,
                            minimum=1,
                            maximum=100,
                        )

    async def test_single_huge_sse_event_is_rejected_and_response_is_closed(self):
        response = _FakeSseResponse([f"data: {json.dumps({'value': 'x' * 80})}", ""])

        with self.assertRaises(AiRuntimeBudgetExceeded):
            async for _ in sse_events.iter_sse_json_payloads(
                response,
                logger=logging.getLogger(__name__),
                invalid_payload_message="invalid %s",
                invalid_trailing_payload_message="invalid trailing %s",
                budget=_budget(),
            ):
                pass

        self.assertTrue(response.closed)

    async def test_continuous_small_sse_chunks_hit_cumulative_budget(self):
        response = _FakeSseResponse(
            [item for index in range(8) for item in (f'data: {{"i":{index}}}', "")]
        )

        with self.assertRaises(AiRuntimeBudgetExceeded):
            async for _ in sse_events.iter_sse_json_payloads(
                response,
                logger=logging.getLogger(__name__),
                invalid_payload_message="invalid %s",
                invalid_trailing_payload_message="invalid trailing %s",
                budget=_budget(
                    max_sse_total_bytes=10_000,
                    stream_total_timeout_seconds=10,
                ),
            ):
                pass

    async def test_response_budget_counts_gzip_decoded_bytes(self):
        response = httpx.Response(
            200,
            content=gzip.compress(b"x" * 256),
            headers={"content-encoding": "gzip"},
        )
        with patch.object(
            upstream_response,
            "get_ai_runtime_budget",
            return_value=_budget(max_sse_total_bytes=64),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await upstream_response.read_bounded_response_body(response)

    async def test_compressed_response_is_rejected_before_decoder_runs(self):
        response = _CompressedResponse()

        with self.assertRaises(AiRuntimeBudgetExceeded):
            await upstream_response.read_bounded_response_body(
                response,
                budget=_budget(max_sse_total_bytes=64),
            )

        self.assertFalse(response.aiter_bytes_called)

    async def test_real_httpx_streaming_gzip_body_is_rejected_before_iteration(self):
        body_stream = _CanaryCompressedByteStream()

        async def handler(_request):
            return httpx.Response(
                200,
                headers={"content-encoding": "gzip"},
                stream=body_stream,
            )

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
        ) as client:
            async with client.stream(
                "GET",
                "https://provider.example/stream",
            ) as response:
                with self.assertRaises(AiRuntimeBudgetExceeded):
                    await upstream_response.read_bounded_response_body(
                        response,
                        budget=_budget(max_sse_total_bytes=64),
                    )

        self.assertFalse(body_stream.iterated)

    async def test_bounded_reader_fails_closed_on_nonconforming_source_chunk(self):
        response = _RawChunkSseResponse(
            [b"x" * (upstream_response.RAW_RESPONSE_CHUNK_BYTES * 2 + 7)]
        )
        with self.assertRaises(AiRuntimeBudgetExceeded):
            async for _chunk in upstream_response.iter_bounded_response_bytes(
                response,
                budget=_budget(
                    max_sse_total_bytes=(
                        upstream_response.RAW_RESPONSE_CHUNK_BYTES * 3
                    ),
                    stream_total_timeout_seconds=10,
                ),
            ):
                self.fail("oversized decoded chunk must not be yielded")

    async def test_unterminated_sse_line_is_rejected_while_reading_raw_chunks(self):
        response = _RawChunkSseResponse(
            [b"data: ", b"x" * 8, b"x" * 8, b"x" * 8, b"x" * 8]
        )

        with self.assertRaises(AiRuntimeBudgetExceeded):
            async for _ in sse_events.iter_sse_json_payloads(
                response,
                logger=logging.getLogger(__name__),
                invalid_payload_message="invalid %s",
                invalid_trailing_payload_message="invalid trailing %s",
                budget=_budget(
                    max_sse_event_bytes=20,
                    max_sse_total_bytes=1_000,
                    stream_total_timeout_seconds=10,
                ),
            ):
                pass

        self.assertLess(response.chunks_yielded, len(response._chunks))
        self.assertTrue(response.closed)

    async def test_malformed_sse_logs_metadata_without_payload_content(self):
        canary = "CANARY_STREAMED_RESUME_PII"
        response = _FakeSseResponse([f'data: {{"secret":"{canary}"', ""])

        with self.assertLogs(__name__, level="WARNING") as captured:
            async for _ in sse_events.iter_sse_json_payloads(
                response,
                logger=logging.getLogger(__name__),
                invalid_payload_message="invalid %s",
                invalid_trailing_payload_message="invalid trailing %s",
                budget=_budget(
                    max_sse_event_bytes=1_000,
                    max_sse_total_bytes=1_000,
                    stream_total_timeout_seconds=10,
                ),
            ):
                pass

        combined = "\n".join(captured.output)
        self.assertNotIn(canary, combined)
        self.assertIn("sha256=", combined)

    async def test_sse_total_wall_clock_timeout_closes_response(self):
        response = _SlowSseResponse([])

        with self.assertRaises(AiRuntimeTimeoutError):
            async for _ in sse_events.iter_sse_json_payloads(
                response,
                logger=logging.getLogger(__name__),
                invalid_payload_message="invalid %s",
                invalid_trailing_payload_message="invalid trailing %s",
                budget=_budget(stream_total_timeout_seconds=0.01),
            ):
                pass

        self.assertTrue(response.closed)

    async def test_sse_blocked_close_cannot_outlive_total_deadline(self):
        response = _BlockingCloseSseResponse([b'data: {"ok":true}\n\n'])

        async def consume():
            return [
                payload
                async for payload in sse_events.iter_sse_json_payloads(
                    response,
                    logger=logging.getLogger(__name__),
                    invalid_payload_message="invalid %s",
                    invalid_trailing_payload_message="invalid trailing %s",
                    budget=_budget(stream_total_timeout_seconds=0.01),
                )
            ]

        task = asyncio.create_task(consume())
        await asyncio.wait_for(response.close_started.wait(), timeout=1)
        await asyncio.sleep(0.03)
        finished_within_budget = task.done()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)

        self.assertTrue(finished_within_budget)
        self.assertTrue(response.close_cancelled.is_set())

    async def test_sse_deadline_survives_wait_for_across_yields(self):
        response = _YieldThenSlowSseResponse([])
        iterator = sse_events.iter_sse_json_payloads(
            response,
            logger=logging.getLogger(__name__),
            invalid_payload_message="invalid %s",
            invalid_trailing_payload_message="invalid trailing %s",
            budget=_budget(stream_total_timeout_seconds=0.02),
        ).__aiter__()

        self.assertEqual(
            await asyncio.wait_for(iterator.__anext__(), timeout=1),
            {"ok": True},
        )
        await asyncio.sleep(0.03)
        with self.assertRaises(AiRuntimeTimeoutError):
            await asyncio.wait_for(iterator.__anext__(), timeout=1)
        self.assertTrue(response.closed)

    async def test_active_caller_cancellation_remains_cancelled(self):
        response = _SlowSseResponse([])
        iterator = sse_events.iter_sse_json_payloads(
            response,
            logger=logging.getLogger(__name__),
            invalid_payload_message="invalid %s",
            invalid_trailing_payload_message="invalid trailing %s",
            budget=_budget(stream_total_timeout_seconds=10),
        ).__aiter__()
        pending = asyncio.create_task(iterator.__anext__())
        await asyncio.sleep(0)
        pending.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertTrue(response.closed)

    async def test_cleanup_failure_does_not_replace_budget_error(self):
        response = _CloseFailingSseResponse([b"data: " + b"x" * 64])
        with self.assertLogs(__name__, level="WARNING") as captured:
            with self.assertRaises(AiRuntimeBudgetExceeded):
                async for _ in sse_events.iter_sse_json_payloads(
                    response,
                    logger=logging.getLogger(__name__),
                    invalid_payload_message="invalid %s",
                    invalid_trailing_payload_message="invalid trailing %s",
                    budget=_budget(
                        max_sse_event_bytes=16,
                        max_sse_total_bytes=1_000,
                        stream_total_timeout_seconds=10,
                    ),
                ):
                    pass

        self.assertTrue(response.closed)
        self.assertNotIn("CANARY_CLOSE_FAILURE", "\n".join(captured.output))

    async def test_cleanup_failure_does_not_replace_caller_cancellation(self):
        response = _CloseFailingSlowSseResponse([])
        iterator = sse_events.iter_sse_json_payloads(
            response,
            logger=logging.getLogger(__name__),
            invalid_payload_message="invalid %s",
            invalid_trailing_payload_message="invalid trailing %s",
            budget=_budget(stream_total_timeout_seconds=10),
        ).__aiter__()
        pending = asyncio.create_task(iterator.__anext__())
        await asyncio.sleep(0)
        pending.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertTrue(response.closed)

    async def test_parser_timeout_emits_terminal_error_and_releases_lease(self):
        lease = SimpleNamespace(release=AsyncMock())
        upload = parser_router.UploadFile(filename="resume.pdf", file=io.BytesIO(b"pdf"))
        with (
            patch.object(
                parser_router.billing_service,
                "begin_ai_request",
                AsyncMock(return_value=lease),
            ),
            patch.object(
                parser_router.billing_service,
                "ai_billing_context",
                return_value=_AsyncContext(),
            ),
            patch.object(parser_router, "extract_text", AsyncMock(return_value=b"resume")),
            patch.object(parser_router, "_resolve_file_kind", return_value="pdf"),
            patch.object(parser_router, "_resolve_file_mime", return_value="application/pdf"),
            patch.object(
                parser_router,
                "parse_resume_with_thoughts",
                AsyncMock(
                    side_effect=AiRuntimeTimeoutError(
                        AiRuntimeTimeoutError.public_message
                    )
                ),
            ),
        ):
            response = await parser_router.parse_resume_stream_endpoint(
                file=upload,
                enable_thinking=True,
                session=object(),
                current_user=SimpleNamespace(id="user-1"),
            )
            events = [
                json.loads(chunk)
                async for chunk in response.body_iterator
            ]

        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["code"], "ai_runtime_timeout")
        self.assertEqual(events[-1]["statusCode"], 504)
        lease.release.assert_awaited_once()

    async def test_parser_deadline_timeout_still_emits_terminal_event(self):
        lease = SimpleNamespace(release=AsyncMock())
        upload = parser_router.UploadFile(filename="resume.pdf", file=io.BytesIO(b"pdf"))

        async def _expire_at_shared_deadline(*_args, **_kwargs):
            return await run_with_total_timeout(asyncio.sleep(1))

        with (
            patch.object(
                parser_router.billing_service,
                "begin_ai_request",
                AsyncMock(return_value=lease),
            ),
            patch.object(
                parser_router.billing_service,
                "ai_billing_context",
                return_value=_AsyncContext(),
            ),
            patch.object(parser_router, "extract_text", AsyncMock(return_value=b"resume")),
            patch.object(parser_router, "_resolve_file_kind", return_value="pdf"),
            patch.object(parser_router, "_resolve_file_mime", return_value="application/pdf"),
            patch.object(
                parser_router,
                "parse_resume_with_thoughts",
                side_effect=_expire_at_shared_deadline,
            ),
            patch(
                "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                return_value=AiRuntimeBudget(stream_total_timeout_seconds=0.02),
            ),
        ):
            response = await parser_router.parse_resume_stream_endpoint(
                file=upload,
                enable_thinking=True,
                session=object(),
                current_user=SimpleNamespace(id="user-1"),
            )
            events = [json.loads(chunk) async for chunk in response.body_iterator]

        self.assertEqual(events[-1]["code"], "ai_runtime_timeout")
        self.assertEqual(events[-1]["statusCode"], 504)
        lease.release.assert_awaited_once()

    async def test_assistant_buffer_has_a_hard_cap(self):
        tracker = assistant_text_stream._AssistantTextDeltaTracker(
            max_buffer_chars=8
        )
        tracker.update('{"assis')
        with self.assertRaises(AiRuntimeBudgetExceeded):
            tracker.update('tantText":"too long"}')

    async def test_bounded_queue_applies_backpressure_and_cancelled_producer_does_not_deadlock(self):
        queue = create_bounded_event_queue(_budget())
        await queue.put({"type": "first"})
        blocked_put = asyncio.create_task(queue.put({"type": "second"}))
        await asyncio.sleep(0)
        self.assertFalse(blocked_put.done())

        producer = asyncio.create_task(finish_event_queue(queue))
        producer.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await producer

        self.assertEqual((await queue.get())["type"], "first")
        await blocked_put

    async def test_total_wall_clock_timeout_cancels_operation(self):
        cancelled = asyncio.Event()

        async def never_finishes():
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        with self.assertRaises(AiRuntimeTimeoutError):
            await run_with_total_timeout(never_finishes(), budget=_budget())

        self.assertTrue(cancelled.is_set())

    async def test_non_streaming_router_preserves_terminal_runtime_status(self):
        for runtime_error in (
            AiRuntimeTimeoutError,
            AiRuntimeBudgetExceeded,
            AiStreamConsumerError,
        ):
            with self.subTest(runtime_error=runtime_error.__name__):
                operation = AsyncMock(
                    side_effect=runtime_error(runtime_error.public_message)
                )
                with self.assertRaises(HTTPException) as context:
                    await ai_router._resolve_jd_analysis_response(operation())
                self.assertEqual(context.exception.status_code, runtime_error.status_code)
                self.assertEqual(context.exception.detail, runtime_error.public_message)

    async def test_bounded_route_maps_terminal_runtime_errors_to_http(self):
        app = FastAPI()
        router = APIRouter(route_class=BoundedAiRequestBodyRoute)

        @router.post("/runtime-timeout")
        async def runtime_timeout_endpoint(payload: dict):
            del payload
            raise AiRuntimeTimeoutError(AiRuntimeTimeoutError.public_message)

        @router.post("/runtime-budget")
        async def runtime_budget_endpoint(payload: dict):
            del payload
            raise AiRuntimeBudgetExceeded(AiRuntimeBudgetExceeded.public_message)

        app.include_router(router)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
        ) as client:
            timeout_response = await client.post("/runtime-timeout", json={})
            budget_response = await client.post("/runtime-budget", json={})

        self.assertEqual(timeout_response.status_code, 504)
        self.assertEqual(budget_response.status_code, 413)

    async def test_assistant_service_does_not_fallback_after_terminal_runtime_error(self):
        for runtime_error in (
            AiRuntimeTimeoutError,
            AiRuntimeBudgetExceeded,
            AiStreamConsumerError,
        ):
            with self.subTest(runtime_error=runtime_error.__name__):
                fallback = AsyncMock(return_value={"assistantText": "fallback"})
                with (
                    patch.object(
                        ai_service,
                        "_has_thinking_stream_provider",
                        return_value=True,
                    ),
                    patch.object(
                        ai_service,
                        "_stream_gemini_json_response",
                        AsyncMock(side_effect=runtime_error(runtime_error.public_message)),
                    ),
                    patch.object(ai_service, "run_assistant_turn", fallback),
                ):
                    with self.assertRaises(runtime_error):
                        await ai_service.run_assistant_turn_with_thoughts(
                            mode="general",
                            user_message="hello",
                            session_title="session",
                            entry_source="direct",
                            context_json={},
                            history=[],
                        )
                fallback.assert_not_awaited()

    async def test_transport_does_not_retry_after_terminal_runtime_error(self):
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="responses",
        )
        for runtime_error in (
            AiRuntimeTimeoutError,
            AiRuntimeBudgetExceeded,
            AiStreamConsumerError,
        ):
            with self.subTest(runtime_error=runtime_error.__name__):
                fallback = AsyncMock(return_value={"ok": True})
                with (
                    patch.object(llm_transport, "_resolve_ai_route", return_value=route),
                    patch.object(
                        llm_transport,
                        "_should_use_qwen_thinking",
                        return_value=True,
                    ),
                    patch.object(
                        llm_transport,
                        "_stream_qwen_responses_json_response",
                        AsyncMock(side_effect=runtime_error(runtime_error.public_message)),
                    ),
                    patch.object(llm_transport, "_stream_qwen_json_response", fallback),
                ):
                    with self.assertRaises(runtime_error):
                        await llm_transport._stream_gemini_json_response(
                            system_prompt="system",
                            user_parts=[{"text": "hello"}],
                            error_message="failed",
                            request_label="runtime-terminal-test",
                        )
                fallback.assert_not_awaited()

    async def test_stream_callback_failures_are_terminal_and_sanitized(self):
        canary = "CANARY_STREAM_CALLBACK_PRIVATE_DETAIL"

        async def _failing_callback(_payload):
            raise RuntimeError(canary)

        emitters = (
            lambda: assistant_text_stream._emit_assistant_text(
                _failing_callback,
                {"type": "assistant_delta", "delta": "safe"},
            ),
            lambda: llm_transport._emit_thought(
                _failing_callback,
                {"type": "thought", "summary": "safe"},
            ),
            lambda: parser_service._emit_thought(
                _failing_callback,
                {"type": "thought", "summary": "safe"},
            ),
        )
        for emitter in emitters:
            with self.subTest(emitter=emitter.__code__.co_firstlineno):
                with self.assertRaises(AiStreamConsumerError) as context:
                    await emitter()
                self.assertNotIn(canary, str(context.exception))

        fallback = AsyncMock(return_value={"ok": True})
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="responses",
        )
        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport, "_should_use_qwen_thinking", return_value=True),
            patch.object(
                llm_transport,
                "_stream_qwen_responses_json_response",
                AsyncMock(
                    side_effect=AiStreamConsumerError(
                        AiStreamConsumerError.public_message
                    )
                ),
            ),
            patch.object(llm_transport, "_stream_qwen_json_response", fallback),
        ):
            with self.assertRaises(AiStreamConsumerError):
                await llm_transport._stream_gemini_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="consumer-failure",
                )
        fallback.assert_not_awaited()

    async def test_service_fallback_consumes_one_shared_absolute_deadline(self):
        fallback_started = asyncio.Event()
        fallback_cancelled = asyncio.Event()

        async def _slow_primary(**_kwargs):
            await asyncio.sleep(0.001)
            raise RuntimeError("provider unavailable")

        async def _slow_fallback(**_kwargs):
            fallback_started.set()
            try:
                await asyncio.sleep(1)
            finally:
                fallback_cancelled.set()

        with (
            patch.object(ai_service, "_has_thinking_stream_provider", return_value=True),
            patch.object(ai_service, "_stream_gemini_json_response", side_effect=_slow_primary),
            patch.object(ai_service, "run_assistant_turn", side_effect=_slow_fallback),
            patch(
                "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                return_value=AiRuntimeBudget(stream_total_timeout_seconds=0.05),
            ),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await ai_service.run_assistant_turn_with_thoughts(
                    mode="general",
                    user_message="hello",
                    session_title="session",
                    entry_source="direct",
                    context_json={},
                    history=[],
                )

        self.assertTrue(fallback_started.is_set())
        self.assertTrue(fallback_cancelled.is_set())

    async def test_deadline_scope_shares_remaining_time_across_sequential_calls(self):
        second_cancelled = asyncio.Event()

        async def second_stage():
            try:
                await asyncio.sleep(0.3)
                return "completed"
            finally:
                second_cancelled.set()

        @ai_deadline_scoped
        async def run_chain():
            await run_with_total_timeout(asyncio.sleep(0.05))
            return await run_with_total_timeout(second_stage())

        with patch(
            "app.domain.ai.runtime_budget.get_ai_runtime_budget",
            return_value=AiRuntimeBudget(stream_total_timeout_seconds=0.2),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await run_chain()

        self.assertTrue(second_cancelled.is_set())

    async def test_usage_accounting_error_is_terminal_and_never_falls_back(self):
        fallback = AsyncMock(return_value={"assistantText": "fallback"})
        with (
            patch.object(ai_service, "_has_thinking_stream_provider", return_value=True),
            patch.object(
                ai_service,
                "_stream_gemini_json_response",
                AsyncMock(
                    side_effect=AiUsageAccountingError(
                        AiUsageAccountingError.public_message
                    )
                ),
            ),
            patch.object(ai_service, "run_assistant_turn", fallback),
        ):
            with self.assertRaises(AiUsageAccountingError):
                await ai_service.run_assistant_turn_with_thoughts(
                    mode="general",
                    user_message="hello",
                    session_title="session",
                    entry_source="direct",
                    context_json={},
                    history=[],
                )
        fallback.assert_not_awaited()

    async def test_all_non_stream_transports_map_httpx_timeout_to_terminal_error(self):
        gemini_route = llm_transport.AIRoute(
            provider="gemini",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="gemini-test",
            transport="gemini_generate_content",
        )
        chat_route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completion",
        )

        async def assert_terminal(operation, *, route=None):
            client = _TimeoutStreamClient()
            recorder = AsyncMock()
            sink = usage_bridge.UsageSink(recorder=recorder)
            patches = [
                patch.object(llm_transport.httpx, "AsyncClient", return_value=client)
            ]
            if route is not None:
                patches.append(
                    patch.object(llm_transport, "_resolve_ai_route", return_value=route)
                )
            with patches[0], patch.object(usage_bridge, "_usage_sink", sink):
                if len(patches) == 2:
                    with patches[1]:
                        with self.assertRaises(AiRuntimeTimeoutError):
                            await operation()
                else:
                    with self.assertRaises(AiRuntimeTimeoutError):
                        await operation()
            self.assertEqual(len(client.stream_calls), 1)
            recorder.assert_awaited_once()
            self.assertEqual(recorder.await_args.args[0]["status"], "failed")
            self.assertEqual(
                client.stream_calls[0][1]["headers"]["Accept-Encoding"],
                "identity",
            )

        await assert_terminal(
            lambda: llm_transport._call_gemini_generate_content(
                [{"role": "user", "content": "hello"}],
                route=gemini_route,
                json_mode=True,
                usage_callback=None,
                request_label="gemini-call-timeout",
            )
        )
        await assert_terminal(
            lambda: llm_transport._post_gemini_chat_completion(
                {"messages": [{"role": "user", "content": "hello"}]},
                route=gemini_route,
                usage_callback=None,
                request_label="gemini-post-timeout",
            )
        )
        await assert_terminal(
            lambda: llm_transport._call_llm(
                [{"role": "user", "content": "hello"}],
                json_mode=True,
            ),
            route=chat_route,
        )
        await assert_terminal(
            lambda: llm_transport._post_chat_completion(
                {"messages": [{"role": "user", "content": "hello"}]},
            ),
            route=chat_route,
        )

    async def test_all_stream_transports_map_httpx_timeout_to_terminal_error(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        operations = (
            lambda: llm_transport._stream_gemini_json_response_legacy(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="gemini-stream-timeout",
            ),
            lambda: llm_transport._stream_qwen_responses_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="qwen-responses-timeout",
            ),
            lambda: llm_transport._stream_qwen_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="qwen-chat-timeout",
            ),
        )
        for operation in operations:
            with self.subTest(operation=operation.__code__.co_firstlineno):
                client = _TimeoutStreamClient()
                recorder = AsyncMock(
                    side_effect=RuntimeError("CANARY_STREAM_USAGE_FAILURE")
                )
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                    self.assertLogs(
                        llm_transport.logger.name,
                        level="ERROR",
                    ) as captured,
                ):
                    with self.assertRaises(AiRuntimeTimeoutError):
                        await operation()
                self.assertEqual(len(client.stream_calls), 1)
                self.assertEqual(recorder.await_count, 1)
                self.assertEqual(
                    client.stream_calls[0][1]["headers"]["Accept-Encoding"],
                    "identity",
                )
                self.assertNotIn(
                    "CANARY_STREAM_USAGE_FAILURE",
                    "\n".join(captured.output),
                )

    def _llm_low_level_operations(self):
        gemini_route = llm_transport.AIRoute(
            provider="gemini",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="gemini-test",
            transport="gemini_generate_content",
        )
        chat_route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completion",
        )
        return (
            (
                lambda: llm_transport._call_gemini_generate_content(
                    [{"role": "user", "content": "hello"}],
                    route=gemini_route,
                    json_mode=True,
                    usage_callback=None,
                    request_label="gemini-call-cancel",
                ),
                None,
            ),
            (
                lambda: llm_transport._post_gemini_chat_completion(
                    {"messages": [{"role": "user", "content": "hello"}]},
                    route=gemini_route,
                    usage_callback=None,
                    request_label="gemini-post-cancel",
                ),
                None,
            ),
            (
                lambda: llm_transport._call_llm(
                    [{"role": "user", "content": "hello"}],
                    json_mode=True,
                    request_label="chat-call-cancel",
                ),
                chat_route,
            ),
            (
                lambda: llm_transport._post_chat_completion(
                    {"messages": [{"role": "user", "content": "hello"}]},
                    request_label="chat-post-cancel",
                ),
                chat_route,
            ),
            (
                lambda: llm_transport._stream_gemini_json_response_legacy(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="gemini-stream-cancel",
                ),
                None,
            ),
            (
                lambda: llm_transport._stream_qwen_responses_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="responses-stream-cancel",
                ),
                None,
            ),
            (
                lambda: llm_transport._stream_qwen_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="chat-stream-cancel",
                ),
                None,
            ),
        )

    async def test_all_llm_low_level_client_cancellations_record_failed_once(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        for operation, route in self._llm_low_level_operations():
            with self.subTest(operation=operation.__code__.co_firstlineno):
                client = _BlockingStreamClient()
                recorder = AsyncMock(
                    side_effect=RuntimeError("CANARY_HTTP_USAGE_FAILURE")
                )
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    if route is None:
                        task = asyncio.create_task(operation())
                        await asyncio.wait_for(client.started.wait(), timeout=1)
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                    else:
                        with patch.object(
                            llm_transport,
                            "_resolve_ai_route",
                            return_value=route,
                        ):
                            task = asyncio.create_task(operation())
                            await asyncio.wait_for(client.started.wait(), timeout=1)
                            task.cancel()
                            with self.assertRaises(asyncio.CancelledError):
                                await task

                recorder.assert_awaited_once()
                payload = recorder.await_args.args[0]
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["metadata"]["error"], "cancelled")

    async def test_all_llm_low_level_wall_clock_timeouts_record_failed_once(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        timeout_budget = AiRuntimeBudget(stream_total_timeout_seconds=0.02)
        for operation, route in self._llm_low_level_operations():
            with self.subTest(operation=operation.__code__.co_firstlineno):
                client = _BlockingStreamClient()
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                    patch(
                        "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                        return_value=timeout_budget,
                    ),
                ):
                    if route is None:
                        with self.assertRaises(AiRuntimeTimeoutError):
                            await operation()
                    else:
                        with patch.object(
                            llm_transport,
                            "_resolve_ai_route",
                            return_value=route,
                        ):
                            with self.assertRaises(AiRuntimeTimeoutError):
                                await operation()

                self.assertTrue(client.started.is_set())
                recorder.assert_awaited_once()
                payload = recorder.await_args.args[0]
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["metadata"]["error"], "cancelled")

    async def test_all_llm_low_level_http_errors_record_failed_once(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        for operation, route in self._llm_low_level_operations():
            with self.subTest(operation=operation.__code__.co_firstlineno):
                response = httpx.Response(
                    500,
                    content=b'{"error":"provider failed"}',
                    headers={"content-type": "application/json"},
                    request=httpx.Request(
                        "POST",
                        "https://provider.example/v1/generate",
                    ),
                )
                client = _NonStreamingClient(response)
                recorder = AsyncMock(
                    side_effect=RuntimeError("CANARY_HTTP_USAGE_FAILURE")
                )
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    if route is None:
                        with self.assertRaises(Exception):
                            await operation()
                    else:
                        with patch.object(
                            llm_transport,
                            "_resolve_ai_route",
                            return_value=route,
                        ):
                            with self.assertRaises(Exception):
                                await operation()

                recorder.assert_awaited_once()
                payload = recorder.await_args.args[0]
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["metadata"]["error"], "http_status")
                self.assertEqual(payload["metadata"]["http_status"], 500)

    async def test_all_stream_transports_bound_success_and_error_bodies(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        operations = (
            lambda: llm_transport._stream_gemini_json_response_legacy(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="gemini-stream-bounded",
            ),
            lambda: llm_transport._stream_qwen_responses_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="responses-stream-bounded",
            ),
            lambda: llm_transport._stream_qwen_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="chat-stream-bounded",
            ),
        )
        bounded_budget = _budget(
            max_sse_event_bytes=64,
            max_sse_total_bytes=64,
            stream_total_timeout_seconds=1,
        )

        for status_code in (200, 500):
            for operation in operations:
                with self.subTest(
                    status_code=status_code,
                    operation=operation.__code__.co_firstlineno,
                ):
                    response = _FakeSseResponse(
                        ["data: " + json.dumps({"value": "x" * 256}), ""],
                        status_code=status_code,
                        content_type=(
                            "text/event-stream"
                            if status_code == 200
                            else "application/json"
                        ),
                    )
                    client = _NonStreamingClient(response)
                    recorder = AsyncMock(
                        side_effect=RuntimeError("CANARY_BOUND_USAGE_FAILURE")
                    )
                    sink = usage_bridge.UsageSink(recorder=recorder)
                    with (
                        patch.object(llm_transport, "settings", fake_settings),
                        patch.object(
                            llm_transport.httpx,
                            "AsyncClient",
                            return_value=client,
                        ),
                        patch(
                            "app.domain.ai.sse_events.get_ai_runtime_budget",
                            return_value=bounded_budget,
                        ),
                        patch(
                            "app.domain.ai.upstream_response.get_ai_runtime_budget",
                            return_value=bounded_budget,
                        ),
                        patch.object(usage_bridge, "_usage_sink", sink),
                    ):
                        with self.assertRaises(AiRuntimeBudgetExceeded):
                            await operation()

                    self.assertTrue(response.closed)
                    self.assertEqual(client.stream_calls, 1)
                    recorder.assert_awaited_once()
                    self.assertEqual(recorder.await_args.args[0]["status"], "failed")

    async def test_all_stream_transports_record_non_sse_failure_once(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        operations = (
            lambda: llm_transport._stream_gemini_json_response_legacy(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="gemini-non-sse",
            ),
            lambda: llm_transport._stream_qwen_responses_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="responses-non-sse",
            ),
            lambda: llm_transport._stream_qwen_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="chat-non-sse",
            ),
        )
        for operation in operations:
            with self.subTest(operation=operation.__code__.co_firstlineno):
                response = _FakeSseResponse(
                    ['{"unexpected":true}'],
                    content_type="application/json",
                )
                client = _NonStreamingClient(response)
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    with self.assertRaises(ValueError):
                        await operation()

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["status"], "failed")

    async def test_all_stream_transports_record_usage_before_empty_answer_failure(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        cases = (
            (
                [
                    'data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15},"candidates":[]}',
                    "",
                ],
                lambda: llm_transport._stream_gemini_json_response_legacy(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="gemini-empty-answer",
                ),
            ),
            (
                [
                    'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15},"output":[]}}',
                    "",
                ],
                lambda: llm_transport._stream_qwen_responses_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="responses-empty-answer",
                ),
            ),
            (
                [
                    'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"choices":[]}',
                    "",
                ],
                lambda: llm_transport._stream_qwen_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="chat-empty-answer",
                ),
            ),
        )
        for lines, operation in cases:
            with self.subTest(operation=operation.__code__.co_firstlineno):
                response = _FakeSseResponse(lines)
                client = _NonStreamingClient(response)
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    with self.assertRaises(ValueError):
                        await operation()

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)

    def _known_usage_stream_case(self, transport_name, callback):
        answer_json = json.dumps({"assistantText": "ok"}, ensure_ascii=False)
        usage = {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
        }
        if transport_name == "gemini":
            response = _FakeSseResponse(
                [
                    "data: "
                    + json.dumps(
                        {
                            "usageMetadata": {
                                "promptTokenCount": 10,
                                "candidatesTokenCount": 5,
                                "totalTokenCount": 15,
                            },
                            "candidates": [
                                {
                                    "finishReason": "STOP",
                                    "content": {
                                        "parts": [{"text": answer_json}],
                                    }
                                }
                            ],
                        },
                        ensure_ascii=False,
                    ),
                    "",
                ]
            )
            operation = lambda: llm_transport._stream_gemini_json_response_legacy(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="gemini-known-usage",
                assistant_text_callback=callback,
            )
            return response, operation
        if transport_name == "responses":
            response = _FakeSseResponse(
                [
                    "data: "
                    + json.dumps(
                        {
                            "type": "response.completed",
                            "response": {
                                "usage": {
                                    "input_tokens": usage["prompt_tokens"],
                                    "output_tokens": usage["completion_tokens"],
                                    "total_tokens": usage["total_tokens"],
                                },
                                "output": [
                                    {
                                        "type": "message",
                                        "content": [
                                            {
                                                "type": "output_text",
                                                "text": answer_json,
                                            }
                                        ],
                                    }
                                ],
                            },
                        },
                        ensure_ascii=False,
                    ),
                    "",
                ]
            )
            operation = lambda: llm_transport._stream_qwen_responses_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="responses-known-usage",
                assistant_text_callback=callback,
            )
            return response, operation
        if transport_name == "chat":
            response = _FakeSseResponse(
                [
                    "data: "
                    + json.dumps(
                        {
                            "usage": usage,
                            "choices": [
                                {
                                    "finish_reason": "stop",
                                    "delta": {"content": answer_json},
                                },
                            ],
                        },
                        ensure_ascii=False,
                    ),
                    "",
                ]
            )
            operation = lambda: llm_transport._stream_qwen_json_response(
                system_prompt="system",
                user_parts=[{"text": "hello"}],
                error_message="failed",
                request_label="chat-known-usage",
                assistant_text_callback=callback,
            )
            return response, operation
        if transport_name == "parser":
            response = _FakeSseResponse([])

            async def payloads(_response):
                yield {
                    "usageMetadata": {
                        "promptTokenCount": 10,
                        "candidatesTokenCount": 5,
                        "totalTokenCount": 15,
                    },
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {
                                "parts": [
                                    {"thought": True, "text": "thinking"},
                                ]
                            }
                        }
                    ],
                }

            fake_httpx = SimpleNamespace(
                AsyncClient=lambda **_kwargs: _NonStreamingClient(response),
                HTTPStatusError=httpx.HTTPStatusError,
                TimeoutException=httpx.TimeoutException,
            )
            operation = lambda: thinking_transport.stream_resume_thinking_parse(
                cleaned_text="resume",
                request_id="req-known-usage",
                thought_callback=callback,
                settings=SimpleNamespace(gemini_model="gemini-test"),
                request_body={},
                build_headers=lambda: {},
                build_stream_url=lambda _model: "https://provider.example/stream",
                build_timeout=lambda: None,
                build_payload_timeout_seconds=lambda: 1,
                iter_sse_json_payloads=payloads,
                emit_thought=lambda _callback, event: callback(event),
                parse_structured_response_text=lambda _text: {},
                normalize_parse_result=lambda value: value,
                log_timing=lambda *_args, **_kwargs: None,
                httpx_module=fake_httpx,
            )
            return response, operation
        raise AssertionError(f"unknown transport: {transport_name}")

    async def test_known_final_usage_is_recorded_when_stream_consumer_fails(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        for transport_name in ("gemini", "responses", "chat", "parser"):
            with self.subTest(transport=transport_name):
                callback = AsyncMock(
                    side_effect=AiStreamConsumerError(
                        AiStreamConsumerError.public_message
                    )
                )
                response, operation = self._known_usage_stream_case(
                    transport_name,
                    callback,
                )
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                client = _NonStreamingClient(response)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    with self.assertRaises(AiStreamConsumerError):
                        await operation()

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)

    async def test_known_final_usage_is_recorded_when_stream_consumer_is_cancelled(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        for transport_name in ("gemini", "responses", "chat", "parser"):
            with self.subTest(transport=transport_name):
                callback_started = asyncio.Event()

                async def blocked_callback(_event):
                    callback_started.set()
                    await asyncio.Future()

                response, operation = self._known_usage_stream_case(
                    transport_name,
                    blocked_callback,
                )
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                client = _NonStreamingClient(response)
                with (
                    patch.object(llm_transport, "settings", fake_settings),
                    patch.object(
                        llm_transport.httpx,
                        "AsyncClient",
                        return_value=client,
                    ),
                    patch.object(usage_bridge, "_usage_sink", sink),
                ):
                    task = asyncio.create_task(operation())
                    await asyncio.wait_for(callback_started.wait(), timeout=1)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)

    async def test_final_usage_recorder_longer_than_half_second_completes_before_callback(self):
        fake_settings = SimpleNamespace(
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        callback = AsyncMock(
            side_effect=AiStreamConsumerError(AiStreamConsumerError.public_message)
        )
        response, operation = self._known_usage_stream_case("gemini", callback)
        client = _NonStreamingClient(response)
        recorder_completed = asyncio.Event()

        async def slow_recorder(_payload):
            await asyncio.sleep(0.55)
            recorder_completed.set()

        sink = usage_bridge.UsageSink(recorder=slow_recorder)
        with (
            patch.object(llm_transport, "settings", fake_settings),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
            patch.object(usage_bridge, "_usage_sink", sink),
        ):
            with self.assertRaises(AiStreamConsumerError):
                await operation()

        self.assertTrue(recorder_completed.is_set())
        callback.assert_awaited()

    async def test_cancel_during_final_usage_recording_drains_recorder_before_exit(self):
        fake_settings = SimpleNamespace(
            gemini_model="gemini-test",
            gemini_base_url="https://provider.example/v1beta",
            gemini_api_key="test-key",
            ai_timeout_seconds=300,
        )
        callback = AsyncMock()
        response, operation = self._known_usage_stream_case("gemini", callback)
        client = _NonStreamingClient(response)
        recorder_started = asyncio.Event()
        recorder_completed = asyncio.Event()
        recorder_tasks = []

        async def slow_recorder(_payload):
            recorder_tasks.append(asyncio.current_task())
            recorder_started.set()
            await asyncio.sleep(0.05)
            recorder_completed.set()

        sink = usage_bridge.UsageSink(recorder=slow_recorder)
        with (
            patch.object(llm_transport, "settings", fake_settings),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
            patch.object(usage_bridge, "_usage_sink", sink),
        ):
            task = asyncio.create_task(operation())
            await asyncio.wait_for(recorder_started.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        self.assertTrue(recorder_completed.is_set())
        self.assertEqual(len(recorder_tasks), 1)
        self.assertTrue(recorder_tasks[0].done())
        callback.assert_not_awaited()

    async def test_blocked_failed_usage_sink_cannot_delay_provider_timeout(self):
        fake_settings = SimpleNamespace(
            ai_model="qwen-test",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_api_key="test-key",
            ai_timeout_seconds=300,
        )
        recorder_cancelled = asyncio.Event()

        async def blocked_recorder(_payload):
            try:
                await asyncio.Future()
            finally:
                recorder_cancelled.set()

        sink = usage_bridge.UsageSink(recorder=blocked_recorder)
        budget = AiRuntimeBudget(stream_total_timeout_seconds=0.05)
        loop = asyncio.get_running_loop()
        started_at = loop.time()
        with (
            patch.object(llm_transport, "settings", fake_settings),
            patch.object(
                llm_transport.httpx,
                "AsyncClient",
                return_value=_TimeoutStreamClient(),
            ),
            patch.object(usage_bridge, "_usage_sink", sink),
            patch(
                "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                return_value=budget,
            ),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await llm_transport._stream_qwen_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="blocked-failed-usage",
                )

        self.assertLess(loop.time() - started_at, 0.2)
        self.assertTrue(recorder_cancelled.is_set())

    async def test_all_non_stream_transports_bound_success_and_error_bodies(self):
        gemini_route = llm_transport.AIRoute(
            provider="gemini",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="gemini-test",
            transport="gemini_generate_content",
        )
        chat_route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completion",
        )

        for status_code in (200, 500):
            operations = (
                (
                    lambda: llm_transport._call_gemini_generate_content(
                        [{"role": "user", "content": "hello"}],
                        route=gemini_route,
                        json_mode=True,
                        usage_callback=None,
                        request_label="gemini-call-bounded",
                    ),
                    None,
                ),
                (
                    lambda: llm_transport._post_gemini_chat_completion(
                        {"messages": [{"role": "user", "content": "hello"}]},
                        route=gemini_route,
                        usage_callback=None,
                        request_label="gemini-post-bounded",
                    ),
                    None,
                ),
                (
                    lambda: llm_transport._call_llm(
                        [{"role": "user", "content": "hello"}],
                        json_mode=True,
                    ),
                    chat_route,
                ),
                (
                    lambda: llm_transport._post_chat_completion(
                        {"messages": [{"role": "user", "content": "hello"}]},
                    ),
                    chat_route,
                ),
            )
            for operation, resolved_route in operations:
                with self.subTest(
                    status_code=status_code,
                    operation=operation.__code__.co_firstlineno,
                ):
                    response = httpx.Response(
                        status_code,
                        content=b"x" * 256,
                        headers={"content-type": "application/json"},
                        request=httpx.Request(
                            "POST",
                            "https://provider.example/v1/generate",
                        ),
                    )
                    client = _NonStreamingClient(response)
                    recorder = AsyncMock(
                        side_effect=RuntimeError("CANARY_BOUND_USAGE_FAILURE")
                    )
                    sink = usage_bridge.UsageSink(recorder=recorder)
                    with (
                        patch.object(
                            llm_transport.httpx,
                            "AsyncClient",
                            return_value=client,
                        ),
                        patch(
                            "app.domain.ai.upstream_response.get_ai_runtime_budget",
                            return_value=_budget(max_sse_total_bytes=64),
                        ),
                        patch.object(usage_bridge, "_usage_sink", sink),
                    ):
                        if resolved_route is None:
                            with self.assertRaises(AiRuntimeBudgetExceeded):
                                await operation()
                        else:
                            with patch.object(
                                llm_transport,
                                "_resolve_ai_route",
                                return_value=resolved_route,
                            ):
                                with self.assertRaises(AiRuntimeBudgetExceeded):
                                    await operation()
                    self.assertEqual(client.post_calls, 0)
                    self.assertEqual(client.stream_calls, 1)
                    recorder.assert_awaited_once()
                    self.assertEqual(recorder.await_args.args[0]["status"], "failed")

    async def test_usage_sink_failure_is_sanitized_terminal_error(self):
        canary = "CANARY_USAGE_DATABASE_PASSWORD"

        async def _emit_callback(_callback, _payload):
            return None

        async def _failing_recorder(_payload):
            raise RuntimeError(canary)

        sink = usage_bridge.UsageSink(
            callback_emitter=_emit_callback,
            recorder=_failing_recorder,
        )
        with (
            patch.object(usage_bridge, "_usage_sink", sink),
            self.assertLogs(usage_bridge.logger.name, level="ERROR") as captured,
        ):
            with self.assertRaises(AiUsageAccountingError):
                await usage_bridge.emit_usage_payload(
                    None,
                    {"provider": "test", "total_tokens": 1},
                )

        self.assertNotIn(canary, "\n".join(captured.output))

    async def test_usage_recorder_still_runs_when_optional_callback_fails(self):
        recorded = asyncio.Event()

        async def _failing_callback(_callback, _payload):
            raise RuntimeError("CANARY_OPTIONAL_USAGE_CALLBACK")

        async def _recorder(_payload):
            recorded.set()

        sink = usage_bridge.UsageSink(
            callback_emitter=_failing_callback,
            recorder=_recorder,
        )
        with (
            patch.object(usage_bridge, "_usage_sink", sink),
            self.assertLogs(usage_bridge.logger.name, level="ERROR") as captured,
        ):
            with self.assertRaises(AiUsageAccountingError):
                await usage_bridge.emit_usage_payload(
                    AsyncMock(),
                    {"provider": "test", "total_tokens": 1},
                )

        self.assertTrue(recorded.is_set())
        self.assertNotIn(
            "CANARY_OPTIONAL_USAGE_CALLBACK",
            "\n".join(captured.output),
        )

    def test_untrusted_usage_numbers_are_rejected_before_accounting(self):
        for invalid_value in (
            float("inf"),
            -1,
            True,
            llm_transport.AI_USAGE_TOKEN_COUNT_MAX + 1,
        ):
            with self.subTest(invalid_value=invalid_value):
                with self.assertRaises(AiUsagePayloadError):
                    llm_transport._build_usage_payload(
                        {"totalTokenCount": invalid_value},
                        provider="test",
                        model="test",
                        request_label="invalid-usage",
                    )

        with self.assertRaises(AiUsagePayloadError):
            llm_transport._build_usage_payload(
                {
                    "promptTokenCount": llm_transport.AI_USAGE_TOKEN_COUNT_MAX,
                    "candidatesTokenCount": 1,
                },
                provider="test",
                model="test",
                request_label="invalid-usage-sum",
            )

    async def test_invalid_usage_payload_is_terminal_and_never_falls_back(self):
        fallback = AsyncMock(return_value={"ok": True})
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="responses",
        )
        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport, "_should_use_qwen_thinking", return_value=True),
            patch.object(
                llm_transport,
                "_stream_qwen_responses_json_response",
                AsyncMock(
                    side_effect=AiUsagePayloadError(
                        AiUsagePayloadError.public_message
                    )
                ),
            ),
            patch.object(llm_transport, "_stream_qwen_json_response", fallback),
        ):
            with self.assertRaises(AiUsagePayloadError):
                await llm_transport._stream_gemini_json_response(
                    system_prompt="system",
                    user_parts=[{"text": "hello"}],
                    error_message="failed",
                    request_label="invalid-usage",
                )
        fallback.assert_not_awaited()

    async def test_timeout_remains_primary_when_failed_usage_recording_also_fails(self):
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completion",
        )
        client = _TimeoutStreamClient()
        recorder = AsyncMock(side_effect=RuntimeError("CANARY_USAGE_FAILURE"))
        sink = usage_bridge.UsageSink(recorder=recorder)
        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
            patch.object(usage_bridge, "_usage_sink", sink),
            self.assertLogs(llm_transport.logger.name, level="ERROR") as captured,
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await llm_transport._call_llm(
                    [{"role": "user", "content": "hello"}],
                    json_mode=True,
                )

        recorder.assert_awaited_once()
        self.assertNotIn("CANARY_USAGE_FAILURE", "\n".join(captured.output))

    def test_all_ai_provider_headers_disable_content_compression(self):
        with patch.object(
            llm_transport,
            "settings",
            SimpleNamespace(ai_api_key="test-key", gemini_api_key="test-key"),
        ):
            self.assertEqual(llm_transport._build_headers()["Accept-Encoding"], "identity")
            self.assertEqual(
                llm_transport._build_gemini_headers()["Accept-Encoding"],
                "identity",
            )
        self.assertEqual(
            thinking_transport._build_gemini_headers(
                SimpleNamespace(gemini_api_key="test-key")
            )["Accept-Encoding"],
            "identity",
        )

    async def test_server_built_bank_context_has_item_and_utf8_byte_limits(self):
        master = SimpleNamespace(
            id="experience-id",
            category=SimpleNamespace(value="work"),
            is_archived=False,
        )
        version = SimpleNamespace(
            title="中" * 1_000,
            org="中" * 1_000,
            start_date=None,
            end_date=None,
            is_current=False,
            summary="中" * 1_000,
            star={key: "中" * 1_000 for key in ("s", "t", "a", "r")},
        )
        experience_calls = []
        certification_calls = []
        skill_calls = []

        async def list_experiences(
            _session,
            _user_id,
            _category,
            _keyword,
            limit,
            offset,
            *,
            include_archived,
        ):
            experience_calls.append((limit, offset, include_archived))
            if offset:
                return []
            return [(master, version)] * limit

        async def list_certifications(*_args, **kwargs):
            certification_calls.append(kwargs)
            return []

        async def list_skills(*_args, **kwargs):
            skill_calls.append(kwargs)
            return []

        async def no_profile(*_args, **_kwargs):
            return None

        context = await assistant_context_service.build_bank_context(
            AsyncMock(),
            user_id="user-1",
            sources=assistant_context_service.BankContextSources(
                get_profile_if_exists=no_profile,
                list_experiences=list_experiences,
                list_certifications=list_certifications,
                list_user_skills=list_skills,
            ),
            fetch_batch_size=500,
        )

        projected_experience_count = sum(
            len(items) for items in context["experiences"].values()
        )
        self.assertLessEqual(
            projected_experience_count,
            assistant_context_service.MAX_BANK_EXPERIENCE_ITEMS,
        )
        self.assertLessEqual(
            len(
                json.dumps(
                    context,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ),
            assistant_context_service.MAX_BANK_CONTEXT_BYTES,
        )
        self.assertTrue(context["_meta"]["boundedSnapshot"])
        self.assertTrue(context["_meta"]["experiences"]["work"]["truncated"])
        self.assertEqual(
            context["_meta"]["experiences"]["work"]["returnedCount"],
            projected_experience_count,
        )
        self.assertEqual(
            experience_calls,
            [
                (
                    assistant_context_service.MAX_BANK_EXPERIENCE_ITEMS + 1,
                    0,
                    False,
                )
            ],
        )
        self.assertEqual(
            certification_calls,
            [{"limit": assistant_context_service.MAX_BANK_CERTIFICATION_ITEMS + 1}],
        )
        self.assertEqual(
            skill_calls,
            [{"limit": assistant_context_service.MAX_BANK_SKILL_ITEMS + 1}],
        )

    async def test_assistant_tool_call_does_not_fallback_after_terminal_runtime_error(self):
        for runtime_error in (AiRuntimeTimeoutError, AiRuntimeBudgetExceeded):
            with self.subTest(runtime_error=runtime_error.__name__):
                fallback = AsyncMock(return_value={"ok": True})
                with (
                    patch.object(
                        assistant_tool_utils,
                        "_post_chat_completion",
                        AsyncMock(side_effect=runtime_error(runtime_error.public_message)),
                    ),
                    patch.object(assistant_tool_utils, "_call_llm", fallback),
                ):
                    with self.assertRaises(runtime_error):
                        await assistant_tool_utils._call_llm_with_tools(
                            [{"role": "user", "content": "hello"}],
                            tools=[],
                            tool_executor=lambda _name, _args: {},
                        )
                fallback.assert_not_awaited()

    async def test_assistant_tool_call_count_is_bounded_before_execution(self):
        tool_calls = [
            {
                "id": f"call-{index}",
                "function": {
                    "name": "get_bank_context",
                    "arguments": "{}",
                },
            }
            for index in range(9)
        ]
        initial = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "tool_calls": tool_calls,
                    }
                }
            ]
        }
        follow_up = AsyncMock(return_value={"ok": True})
        executor_calls = []

        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(return_value=initial),
            ),
            patch.object(assistant_tool_utils, "_call_llm", follow_up),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await assistant_tool_utils._call_llm_with_tools(
                    [{"role": "user", "content": "hello"}],
                    tools=[],
                    tool_executor=lambda name, arguments: executor_calls.append(
                        (name, arguments)
                    ),
                )

        self.assertEqual(executor_calls, [])
        follow_up.assert_not_awaited()

    async def test_assistant_tool_followup_deduplicates_execution_and_bounds_bytes(self):
        initial = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "function": {
                                    "name": "get_bank_context",
                                    "arguments": "{}",
                                },
                            },
                            {
                                "id": "call-2",
                                "function": {
                                    "name": "get_bank_context",
                                    "arguments": "{}",
                                },
                            },
                        ],
                    }
                }
            ]
        }
        executor_calls = []
        follow_up = AsyncMock(return_value={"ok": True})

        def execute(name, arguments):
            executor_calls.append((name, arguments))
            return {"bank_context": "中" * 800}

        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(return_value=initial),
            ),
            patch.object(assistant_tool_utils, "_call_llm", follow_up),
            patch.object(
                assistant_tool_utils.runtime_budget,
                "get_ai_runtime_budget",
                return_value=AiRuntimeBudget(max_request_body_bytes=1_000),
            ),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await assistant_tool_utils._call_llm_with_tools(
                    [{"role": "user", "content": "hello"}],
                    tools=[],
                    tool_executor=execute,
                )

        self.assertEqual(executor_calls, [("get_bank_context", {})])
        follow_up.assert_not_awaited()

    async def test_assistant_tool_call_preserves_http_timeout_without_replay(self):
        fallback = AsyncMock(return_value={"ok": True})
        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(side_effect=HTTPException(status_code=504, detail="timeout")),
            ),
            patch.object(assistant_tool_utils, "_call_llm", fallback),
        ):
            with self.assertRaises(HTTPException) as context:
                await assistant_tool_utils._call_llm_with_tools(
                    [{"role": "user", "content": "hello"}],
                    tools=[],
                    tool_executor=lambda _name, _args: {},
                )

        self.assertEqual(context.exception.status_code, 504)
        fallback.assert_not_awaited()

    async def test_assistant_tool_followup_failure_is_not_replayed(self):
        initial = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "function": {
                                    "name": "get_context",
                                    "arguments": "{}",
                                },
                            }
                        ],
                    }
                }
            ]
        }
        follow_up = AsyncMock(
            side_effect=HTTPException(status_code=504, detail="follow-up timeout")
        )
        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(return_value=initial),
            ),
            patch.object(assistant_tool_utils, "_call_llm", follow_up),
        ):
            with self.assertRaises(HTTPException) as context:
                await assistant_tool_utils._call_llm_with_tools(
                    [{"role": "user", "content": "hello"}],
                    tools=[],
                    tool_executor=lambda _name, _args: {"ok": True},
                )

        self.assertEqual(context.exception.status_code, 504)
        self.assertEqual(follow_up.await_count, 1)

    async def test_unknown_tool_request_http_error_is_not_replayed(self):
        request = httpx.Request("POST", "https://provider.example/tools")
        response = httpx.Response(400, request=request)
        provider_error = httpx.HTTPStatusError(
            "context length exceeded",
            request=request,
            response=response,
        )
        fallback = AsyncMock(return_value={"ok": True})
        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(side_effect=provider_error),
            ),
            patch.object(assistant_tool_utils, "_call_llm", fallback),
        ):
            with self.assertRaises(httpx.HTTPStatusError):
                await assistant_tool_utils._call_llm_with_tools(
                    [{"role": "user", "content": "hello"}],
                    tools=[],
                    tool_executor=lambda _name, _args: {},
                )
        fallback.assert_not_awaited()

    def test_tool_fallback_requires_explicit_structured_unsupported_signal(self):
        self.assertTrue(
            llm_transport._provider_rejects_tool_calling(
                json.dumps(
                    {
                        "error": {
                            "code": "tool_calling_unsupported",
                            "message": "Tool calling is unsupported by this model",
                        }
                    }
                ).encode("utf-8")
            )
        )
        self.assertFalse(
            llm_transport._provider_rejects_tool_calling(
                json.dumps(
                    {
                        "error": {
                            "code": "context_length_exceeded",
                            "message": "Maximum context length exceeded",
                        }
                    }
                ).encode("utf-8")
            )
        )

    async def test_tool_transport_raises_explicit_unsupported_error_from_bounded_body(self):
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completion",
        )
        response = httpx.Response(
            400,
            content=json.dumps(
                {
                    "error": {
                        "code": "tool_calling_unsupported",
                        "message": "Tool calling is unsupported by this model",
                    }
                }
            ).encode("utf-8"),
            headers={"content-type": "application/json"},
            request=httpx.Request(
                "POST",
                "https://provider.example/v1/chat/completions",
            ),
        )
        client = _NonStreamingClient(response)
        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
        ):
            with self.assertRaises(llm_transport.ToolCallingUnsupportedError):
                await llm_transport._post_chat_completion(
                    {
                        "messages": [{"role": "user", "content": "hello"}],
                        "tools": [{"type": "function", "function": {"name": "x"}}],
                    }
                )

        self.assertEqual(client.post_calls, 0)
        self.assertEqual(client.stream_calls, 1)
        self.assertFalse(
            llm_transport._provider_rejects_tool_calling(
                json.dumps(
                    {
                        "error": {
                            "code": "model_not_found",
                            "message": "Requested model was not found",
                        }
                    }
                ).encode("utf-8")
            )
        )

    async def test_ai_fallback_logs_never_include_exception_messages(self):
        canary = "CANARY_PROVIDER_PRIVATE_DETAIL"
        with (
            patch.object(
                ai_service,
                "_has_thinking_stream_provider",
                return_value=True,
            ),
            patch.object(
                ai_service,
                "_stream_gemini_json_response",
                AsyncMock(side_effect=RuntimeError(canary)),
            ),
            patch.object(
                ai_service,
                "run_assistant_turn",
                AsyncMock(return_value={"assistantText": "fallback"}),
            ),
            self.assertLogs(ai_service.logger.name, level="WARNING") as captured,
        ):
            await ai_service.run_assistant_turn_with_thoughts(
                mode="general",
                user_message="hello",
                session_title="session",
                entry_source="direct",
                context_json={},
                history=[],
            )
        self.assertNotIn(canary, "\n".join(captured.output))

        tool_error = llm_transport.ToolCallingUnsupportedError(canary)
        with (
            patch.object(
                assistant_tool_utils,
                "_post_chat_completion",
                AsyncMock(side_effect=tool_error),
            ),
            patch.object(
                assistant_tool_utils,
                "_call_llm",
                AsyncMock(return_value={"ok": True}),
            ),
            self.assertLogs(
                assistant_tool_utils.logger.name,
                level="WARNING",
            ) as captured,
        ):
            await assistant_tool_utils._call_llm_with_tools(
                [{"role": "user", "content": "hello"}],
                tools=[],
                tool_executor=lambda _name, _args: {},
            )
        self.assertNotIn(canary, "\n".join(captured.output))

    async def test_chunked_request_body_is_rejected_before_endpoint_runs(self):
        app = FastAPI()
        router = APIRouter(route_class=BoundedAiRequestBodyRoute)
        endpoint_called = False

        @router.post("/bounded")
        async def bounded_endpoint(payload: dict):
            nonlocal endpoint_called
            endpoint_called = True
            return payload

        app.include_router(router)

        async def chunks():
            yield b'{"value":"'
            yield b"x" * 256
            yield b'"}'

        with patch(
            "app.domain.ai.runtime_budget.get_ai_runtime_budget",
            return_value=_budget(max_request_body_bytes=64),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
            ) as client:
                response = await client.post(
                    "/bounded",
                    content=chunks(),
                    headers={"content-type": "application/json"},
                )

        self.assertEqual(response.status_code, 413)
        self.assertFalse(endpoint_called)

    def test_unknown_stream_error_is_sanitized_and_correlatable(self):
        event = build_public_stream_error_event(
            RuntimeError("secret=/srv/private.sql password=hunter2"),
            request_id="req-safe",
        )

        self.assertEqual(event["code"], "internal_error")
        self.assertEqual(event["requestId"], "req-safe")
        self.assertNotIn("secret", event["message"])
        self.assertNotIn("hunter2", event["message"])

        hidden_value_error = build_public_stream_error_event(
            ValueError("secret=/srv/private.sql"),
            request_id="req-hidden-value",
        )
        self.assertEqual(hidden_value_error["code"], "internal_error")
        self.assertNotIn("secret", hidden_value_error["message"])

        public_value_error = build_public_stream_error_event(
            ValueError("附件过大，请缩短后重试。"),
            request_id="req-public-value",
            preserve_value_error=True,
        )
        self.assertEqual(public_value_error["message"], "附件过大，请缩短后重试。")

        with patch.object(ai_router.logger, "error") as ai_log:
            ai_event = ai_router._stream_error_event(
                RuntimeError("secret=/srv/private.sql password=hunter2"),
                request_id="req-ai",
            )
        self.assertEqual(ai_event["code"], "internal_error")
        self.assertNotIn("hunter2", ai_event["message"])
        ai_log.assert_called_once()

        with patch.object(assistant_router.logger, "error") as assistant_log:
            assistant_event = assistant_router._assistant_stream_error_event(
                RuntimeError("sql=SELECT password FROM users")
            )
        self.assertEqual(assistant_event["code"], "internal_error")
        self.assertNotIn("password", assistant_event["message"])
        assistant_log.assert_called_once()

    def test_stream_error_logs_do_not_include_exception_messages(self):
        unknown_canary = "CANARY_INTERNAL_DATABASE_SECRET"
        with self.assertLogs(ai_router.logger.name, level="ERROR") as captured:
            try:
                raise RuntimeError(unknown_canary)
            except RuntimeError as exc:
                ai_router._stream_error_event(exc, request_id="req-unknown-log")
        self.assertNotIn(unknown_canary, "\n".join(captured.output))

        public_canary = "CANARY_PERSON_NAME.pdf"
        with self.assertLogs(assistant_router.logger.name, level="WARNING") as captured:
            assistant_router._assistant_stream_error_event(
                ValueError(public_canary),
                preserve_value_error=True,
            )
        self.assertNotIn(public_canary, "\n".join(captured.output))

    async def test_parser_upload_logs_hash_filename_and_hide_parse_error(self):
        filename_canary = "CANARY_PERSON_NAME_resume.pdf"
        upload = parser_router.UploadFile(
            filename=filename_canary,
            file=io.BytesIO(b"pdf"),
        )
        with (
            patch.object(
                parser_router.billing_service,
                "ai_billing_context",
                return_value=_AsyncContext(),
            ),
            patch.object(
                parser_router,
                "_build_parse_response",
                AsyncMock(return_value={"ok": True}),
            ),
            self.assertLogs(parser_router.logger.name, level="INFO") as captured,
        ):
            await parser_router.parse_resume_endpoint(
                file=upload,
                session=object(),
                current_user=SimpleNamespace(id="user-1"),
            )
        router_logs = "\n".join(captured.output)
        self.assertNotIn(filename_canary, router_logs)
        self.assertIn("sha256=", router_logs)

        error_canary = "CANARY_PARSER_INTERNAL_ERROR"
        with (
            patch.object(
                document_text,
                "_extract_pdf_text",
                side_effect=ValueError(error_canary),
            ),
            self.assertLogs(document_text.logger.name, level="WARNING") as captured,
        ):
            with self.assertRaises(ValueError):
                document_text.extract_resume_text(
                    b"%PDF-1.4 invalid",
                    filename_canary,
                    "application/pdf",
                    request_id="req-parser-log",
                )
        document_logs = "\n".join(captured.output)
        self.assertNotIn(filename_canary, document_logs)
        self.assertNotIn(error_canary, document_logs)
        self.assertIn("sha256=", document_logs)

    def test_known_http_error_preserves_public_contract(self):
        event = build_public_stream_error_event(
            HTTPException(status_code=504, detail="deep report timed out"),
            request_id="req-timeout",
        )
        self.assertEqual(event["message"], "deep report timed out")
        self.assertEqual(event["statusCode"], 504)
        self.assertTrue(event["retryable"])

    def test_primary_text_models_reject_oversized_values(self):
        budget = _budget(max_text_field_chars=4)
        with patch("app.domain.ai.runtime_budget.get_ai_runtime_budget", return_value=budget):
            with self.assertRaises(ValidationError):
                ai_router.AnalyzeJDRequest(text="12345")
            with self.assertRaises(ValidationError):
                AssistantSessionStreamRequest(user_message="12345")
            with self.assertRaises(ValidationError):
                AgentJobRequest(
                    job_title="job",
                    company_name="company",
                    jd_text="12345",
                    job_url="https://example.com/jobs/1",
                )

    def test_transport_payload_builders_set_output_cap(self):
        from app.domain.ai import llm_transport
        from app.domain.parser import thinking_transport

        budget = _budget(max_output_tokens=77)
        with patch("app.domain.ai.runtime_budget.get_ai_runtime_budget", return_value=budget):
            gemini = llm_transport._build_gemini_generation_config()
            chat = llm_transport._prepare_chat_completion_payload(
                {"model": "qwen-test", "messages": [], "max_tokens": 999}
            )
            parser_gemini = thinking_transport._build_resume_thinking_request(
                "resume",
                "prompt",
            )

        self.assertEqual(gemini["maxOutputTokens"], 77)
        self.assertEqual(chat["max_tokens"], 77)
        self.assertEqual(
            parser_gemini["generationConfig"]["maxOutputTokens"],
            77,
        )

    async def test_upstream_error_logs_never_include_response_body_canary(self):
        canary = "CANARY_JD_SECRET_account-123"
        response = httpx.Response(
            500,
            content=canary.encode("utf-8"),
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", "https://provider.example/v1/chat"),
        )
        with self.assertLogs("app.domain.ai.llm_transport", level="ERROR") as captured:
            from app.domain.ai import llm_transport

            llm_transport._log_http_error(response)
        self.assertNotIn(canary, "\n".join(captured.output))

    async def test_non_streaming_success_body_is_bounded_before_json_decode(self):
        body = json.dumps(
            {"choices": [{"message": {"content": "x" * 256}}], "usage": {}}
        ).encode("utf-8")
        response = httpx.Response(
            200,
            content=body,
            headers={"content-type": "application/json"},
            request=httpx.Request("POST", "https://provider.example/v1/chat/completions"),
        )
        client = _NonStreamingClient(response)
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completions",
        )

        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
            patch(
                "app.domain.ai.upstream_response.get_ai_runtime_budget",
                return_value=_budget(max_sse_total_bytes=64),
            ),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await llm_transport._call_llm(
                    [{"role": "user", "content": "hello"}],
                    json_mode=False,
                )

        self.assertEqual(client.post_calls, 0)
        self.assertEqual(client.stream_calls, 1)

    async def test_non_streaming_error_body_is_bounded_before_diagnostics(self):
        response = httpx.Response(
            500,
            content=b"x" * 256,
            headers={"content-type": "text/plain"},
            request=httpx.Request("POST", "https://provider.example/v1/chat/completions"),
        )
        client = _NonStreamingClient(response)
        route = llm_transport.AIRoute(
            provider="dashscope",
            api_key="test-key",
            base_url="https://provider.example/v1",
            model="qwen-test",
            transport="chat_completions",
        )

        with (
            patch.object(llm_transport, "_resolve_ai_route", return_value=route),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=client),
            patch(
                "app.domain.ai.upstream_response.get_ai_runtime_budget",
                return_value=_budget(max_sse_total_bytes=64),
            ),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await llm_transport._call_llm(
                    [{"role": "user", "content": "hello"}],
                    json_mode=False,
                )

        self.assertEqual(client.post_calls, 0)
        self.assertEqual(client.stream_calls, 1)

    async def test_parser_unexpected_body_log_never_includes_response_canary(self):
        canary = "CANARY_JD_SECRET_account-123"

        class _ParserResponse:
            status_code = 200
            headers = {"content-type": "application/json"}

            def raise_for_status(self):
                return None

            async def aiter_bytes(self, chunk_size=None):
                data = canary.encode("utf-8")
                resolved_chunk_size = chunk_size or len(data)
                for index in range(0, len(data), resolved_chunk_size):
                    yield data[index : index + resolved_chunk_size]

        parser_response = _ParserResponse()

        class _StreamContext:
            async def __aenter__(self):
                return parser_response

            async def __aexit__(self, exc_type, exc, traceback):
                return False

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            def stream(self, *args, **kwargs):
                return _StreamContext()

        fake_httpx = SimpleNamespace(
            AsyncClient=lambda **_kwargs: _Client(),
            HTTPStatusError=httpx.HTTPStatusError,
            TimeoutException=httpx.TimeoutException,
        )
        with self.assertLogs(
            "app.domain.parser.parser_service",
            level="ERROR",
        ) as captured:
            with self.assertRaises(ValueError):
                await thinking_transport.stream_resume_thinking_parse(
                    cleaned_text="resume",
                    request_id="req-canary",
                    thought_callback=None,
                    settings=SimpleNamespace(gemini_model="gemini-test"),
                    request_body={},
                    build_headers=lambda: {},
                    build_stream_url=lambda _model: "https://provider.example/stream",
                    build_timeout=lambda: None,
                    build_payload_timeout_seconds=lambda: 1,
                    iter_sse_json_payloads=lambda _response: None,
                    emit_thought=AsyncMock(),
                    parse_structured_response_text=lambda _text: {},
                    normalize_parse_result=lambda value: value,
                    log_timing=lambda *_args, **_kwargs: None,
                    httpx_module=fake_httpx,
                )
        self.assertNotIn(canary, "\n".join(captured.output))

    async def test_parser_stream_records_failed_usage_for_http_and_non_sse_errors(self):
        async def run(response):
            client = _NonStreamingClient(response)
            fake_httpx = SimpleNamespace(
                AsyncClient=lambda **_kwargs: client,
                HTTPStatusError=httpx.HTTPStatusError,
                TimeoutException=httpx.TimeoutException,
            )
            await thinking_transport.stream_resume_thinking_parse(
                cleaned_text="resume",
                request_id="req-parser-failed-usage",
                thought_callback=None,
                settings=SimpleNamespace(gemini_model="gemini-test"),
                request_body={},
                build_headers=lambda: {},
                build_stream_url=lambda _model: "https://provider.example/stream",
                build_timeout=lambda: None,
                build_payload_timeout_seconds=lambda: 1,
                iter_sse_json_payloads=lambda _response: None,
                emit_thought=AsyncMock(),
                parse_structured_response_text=lambda _text: {},
                normalize_parse_result=lambda value: value,
                log_timing=lambda *_args, **_kwargs: None,
                httpx_module=fake_httpx,
            )

        cases = (
            (
                _FakeSseResponse(
                    ['{"error":"failed"}'],
                    status_code=500,
                    content_type="application/json",
                ),
                "http_status",
                500,
            ),
            (
                _FakeSseResponse(
                    ['{"unexpected":true}'],
                    content_type="application/json",
                ),
                "unexpected_content_type",
                None,
            ),
        )
        for response, expected_error, expected_status in cases:
            with self.subTest(status_code=response.status_code):
                recorder = AsyncMock()
                sink = usage_bridge.UsageSink(recorder=recorder)
                with patch.object(usage_bridge, "_usage_sink", sink):
                    with self.assertRaises(ValueError):
                        await run(response)
                recorder.assert_awaited_once()
                usage_payload = recorder.await_args.args[0]
                self.assertEqual(usage_payload["status"], "failed")
                self.assertEqual(usage_payload["metadata"]["error"], expected_error)
                if expected_status is not None:
                    self.assertEqual(
                        usage_payload["metadata"]["http_status"],
                        expected_status,
                    )

    async def test_parser_thinking_bounds_success_and_error_bodies_and_preserves_budget_error(self):
        bounded_budget = _budget(
            max_sse_event_bytes=64,
            max_sse_total_bytes=64,
            stream_total_timeout_seconds=1,
        )

        async def run(response):
            client = _NonStreamingClient(response)
            fake_httpx = SimpleNamespace(
                AsyncClient=lambda **_kwargs: client,
                HTTPStatusError=httpx.HTTPStatusError,
                TimeoutException=httpx.TimeoutException,
            )
            return await thinking_transport.stream_resume_thinking_parse(
                cleaned_text="resume",
                request_id="req-parser-bounded",
                thought_callback=None,
                settings=SimpleNamespace(gemini_model="gemini-test"),
                request_body={},
                build_headers=lambda: {},
                build_stream_url=lambda _model: "https://provider.example/stream",
                build_timeout=lambda: None,
                build_payload_timeout_seconds=lambda: 1,
                iter_sse_json_payloads=thinking_transport._iter_sse_json_payloads,
                emit_thought=AsyncMock(),
                parse_structured_response_text=lambda _text: {},
                normalize_parse_result=lambda value: value,
                log_timing=lambda *_args, **_kwargs: None,
                httpx_module=fake_httpx,
            )

        for status_code in (200, 500):
            with self.subTest(status_code=status_code):
                response = _FakeSseResponse(
                    ["data: " + json.dumps({"value": "x" * 256}), ""],
                    status_code=status_code,
                    content_type=(
                        "text/event-stream"
                        if status_code == 200
                        else "application/json"
                    ),
                )
                recorder = AsyncMock(
                    side_effect=RuntimeError("CANARY_PARSER_USAGE_FAILURE")
                )
                sink = usage_bridge.UsageSink(recorder=recorder)
                with (
                    patch.object(usage_bridge, "_usage_sink", sink),
                    patch(
                        "app.domain.ai.sse_events.get_ai_runtime_budget",
                        return_value=bounded_budget,
                    ),
                    patch(
                        "app.domain.ai.upstream_response.get_ai_runtime_budget",
                        return_value=bounded_budget,
                    ),
                ):
                    with self.assertRaises(AiRuntimeBudgetExceeded):
                        await run(response)

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["status"], "failed")

    def _blocking_parser_thinking_operation(self, client):
        fake_httpx = SimpleNamespace(
            AsyncClient=lambda **_kwargs: client,
            HTTPStatusError=httpx.HTTPStatusError,
            TimeoutException=httpx.TimeoutException,
        )
        return lambda: thinking_transport.stream_resume_thinking_parse(
            cleaned_text="resume",
            request_id="req-parser-cancel",
            thought_callback=None,
            settings=SimpleNamespace(gemini_model="gemini-test"),
            request_body={},
            build_headers=lambda: {},
            build_stream_url=lambda _model: "https://provider.example/stream",
            build_timeout=lambda: None,
            build_payload_timeout_seconds=lambda: 1,
            iter_sse_json_payloads=lambda _response: None,
            emit_thought=AsyncMock(),
            parse_structured_response_text=lambda _text: {},
            normalize_parse_result=lambda value: value,
            log_timing=lambda *_args, **_kwargs: None,
            httpx_module=fake_httpx,
        )

    async def test_parser_thinking_client_cancel_records_failed_once(self):
        client = _BlockingStreamClient()
        recorder = AsyncMock()
        sink = usage_bridge.UsageSink(recorder=recorder)
        operation = self._blocking_parser_thinking_operation(client)

        with patch.object(usage_bridge, "_usage_sink", sink):
            task = asyncio.create_task(operation())
            await asyncio.wait_for(client.started.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        recorder.assert_awaited_once()
        self.assertEqual(recorder.await_args.args[0]["status"], "failed")
        self.assertEqual(
            recorder.await_args.args[0]["metadata"]["error"],
            "cancelled",
        )

    async def test_parser_thinking_wall_clock_timeout_records_failed_once(self):
        client = _BlockingStreamClient()
        recorder = AsyncMock()
        sink = usage_bridge.UsageSink(recorder=recorder)
        operation = self._blocking_parser_thinking_operation(client)
        budget = AiRuntimeBudget(stream_total_timeout_seconds=0.02)

        with (
            patch.object(usage_bridge, "_usage_sink", sink),
            patch(
                "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                return_value=budget,
            ),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await operation()

        recorder.assert_awaited_once()
        self.assertEqual(recorder.await_args.args[0]["status"], "failed")


if __name__ == "__main__":
    unittest.main()
