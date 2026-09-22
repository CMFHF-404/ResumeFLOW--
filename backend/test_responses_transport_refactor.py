import asyncio
import json
import os
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx


os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
)
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")

from app.domain.ai import llm_transport, usage_bridge  # noqa: E402
from app.domain.ai.runtime_budget import (  # noqa: E402
    AiStreamConsumerError,
    AiUsageAccountingError,
)


class _Response:
    def __init__(self, body, *, sse):
        self.body = body
        self.headers = {
            "content-type": "text/event-stream" if sse else "application/json"
        }
        self.status_code = 200
        self.request = httpx.Request("POST", "https://provider.example/v1/responses")
        self.closed = False

    def raise_for_status(self):
        return None

    async def aiter_bytes(self, chunk_size=None):
        step = chunk_size or len(self.body) or 1
        for offset in range(0, len(self.body), step):
            yield self.body[offset : offset + step]

    async def aclose(self):
        self.closed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        await self.aclose()
        return False


class _Client:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def stream(self, *_args, **_kwargs):
        return self.response


def _payload(*, status="completed", total_tokens=15, reasoning=False):
    output = []
    if reasoning:
        output.append(
            {
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "正在核对岗位要求"}],
            }
        )
    output.append(
        {
            "type": "message",
            "content": [
                {"type": "output_text", "text": '{"assistantText":"hello"}'}
            ],
        }
    )
    return {
        "object": "response",
        "status": status,
        "output": output,
        "usage": {
            "input_tokens": 10,
            "output_tokens": total_tokens - 10,
            "total_tokens": total_tokens,
        },
    }


def _response(*payloads, sse=True):
    if sse:
        body = "".join(
            "data: "
            + json.dumps(
                {"type": f"response.{payload['status']}", "response": payload}
            )
            + "\n\n"
            for payload in payloads
        ).encode()
    else:
        body = json.dumps(payloads[0]).encode()
    return _Response(body, sse=sse)


class ResponsesTransportRefactorTests(unittest.IsolatedAsyncioTestCase):
    @contextmanager
    def transport(self, response, recorder):
        settings = SimpleNamespace(
            ai_route_profile="openai_primary",
            ai_api_key="test-key",
            ai_base_url="https://provider.example/v1",
            ai_responses_base_url="https://provider.example/v1",
            ai_model="gpt-4.1",
            ai_timeout_seconds=300,
        )
        with (
            patch.object(llm_transport, "settings", settings),
            patch.object(llm_transport.httpx, "AsyncClient", return_value=_Client(response)),
            patch.object(
                usage_bridge, "_usage_sink", usage_bridge.UsageSink(recorder=recorder)
            ),
        ):
            yield

    async def invoke(self, **callbacks):
        return await llm_transport._stream_qwen_responses_json_response(
            system_prompt="Return JSON",
            user_parts=[{"text": "Input"}],
            error_message="Generation failed",
            request_label="responses-refactor",
            **callbacks,
        )

    async def test_duplicate_terminal_events_record_first_usage_and_callback_last_usage(self):
        first = _payload(total_tokens=15)
        last = _payload(total_tokens=21)
        response = _response(first, first, last)
        recorder = AsyncMock()
        usage_callback = AsyncMock()
        with self.transport(response, recorder):
            result = await self.invoke(usage_callback=usage_callback)

        self.assertEqual(result, {"assistantText": "hello"})
        recorder.assert_awaited_once()
        self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)
        self.assertEqual(recorder.await_args.args[0]["status"], "success")
        usage_callback.assert_awaited_once()
        self.assertEqual(usage_callback.await_args.args[0]["total_tokens"], 21)
        self.assertTrue(response.closed)

    async def test_consumer_failure_after_known_usage_does_not_record_failure(self):
        for sse in (True, False):
            with self.subTest(sse=sse):
                response = _response(_payload(), sse=sse)
                recorder = AsyncMock()
                usage_callback = AsyncMock()
                consumer = AsyncMock(side_effect=ValueError("consumer failed"))
                with self.transport(response, recorder):
                    with self.assertRaises(AiStreamConsumerError):
                        await self.invoke(
                            assistant_text_callback=consumer,
                            usage_callback=usage_callback,
                        )

                consumer.assert_awaited_once()
                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["status"], "success")
                self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)
                usage_callback.assert_not_awaited()
                self.assertTrue(response.closed)

    async def test_cancellation_after_known_usage_does_not_record_failure(self):
        for sse in (True, False):
            with self.subTest(sse=sse):
                response = _response(_payload(), sse=sse)
                recorder = AsyncMock()
                usage_callback = AsyncMock()
                started = asyncio.Event()

                async def consumer(_event):
                    started.set()
                    await asyncio.Future()

                with self.transport(response, recorder):
                    task = asyncio.create_task(
                        self.invoke(
                            assistant_text_callback=consumer,
                            usage_callback=usage_callback,
                        )
                    )
                    try:
                        await asyncio.wait_for(started.wait(), timeout=1)
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                    finally:
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)

                recorder.assert_awaited_once()
                self.assertEqual(recorder.await_args.args[0]["status"], "success")
                self.assertEqual(recorder.await_args.args[0]["total_tokens"], 15)
                usage_callback.assert_not_awaited()
                self.assertTrue(response.closed)

    async def test_recorder_failure_is_not_retried_and_prevents_callbacks(self):
        for sse in (True, False):
            with self.subTest(sse=sse):
                response = _response(_payload(reasoning=True), sse=sse)
                recorder = AsyncMock(side_effect=RuntimeError("recorder failed"))
                thought = AsyncMock()
                assistant = AsyncMock()
                usage_callback = AsyncMock()
                with self.transport(response, recorder):
                    with self.assertRaises(AiUsageAccountingError):
                        await self.invoke(
                            thought_callback=thought,
                            assistant_text_callback=assistant,
                            usage_callback=usage_callback,
                        )

                recorder.assert_awaited_once()
                thought.assert_not_awaited()
                assistant.assert_not_awaited()
                usage_callback.assert_not_awaited()
                self.assertTrue(response.closed)

    async def test_completion_records_usage_before_content_then_emits_usage_callback(self):
        for sse in (True, False):
            with self.subTest(sse=sse):
                events = []

                async def record(_payload):
                    events.append("record")

                response = _response(_payload(reasoning=True), sse=sse)
                with self.transport(response, record):
                    result = await self.invoke(
                        thought_callback=lambda _event: events.append("thought"),
                        assistant_text_callback=lambda event: events.append(event["type"]),
                        usage_callback=lambda _event: events.append("usage"),
                    )

                self.assertEqual(result, {"assistantText": "hello"})
                self.assertEqual(
                    events,
                    ["record", "thought", "assistant_text_reset", "assistant_delta", "usage"],
                )

    async def test_non_sse_terminal_failures_record_usage_without_content_callbacks(self):
        cases = (
            ("incomplete", llm_transport.AiProviderPayloadError),
            ("failed", llm_transport.AiProviderUnavailableError),
            ("cancelled", llm_transport.AiProviderUnavailableError),
        )
        for status, error_type in cases:
            with self.subTest(status=status):
                response = _response(_payload(status=status, reasoning=True), sse=False)
                recorder = AsyncMock()
                thought = AsyncMock()
                assistant = AsyncMock()
                usage_callback = AsyncMock()
                with self.transport(response, recorder):
                    with self.assertRaises(error_type):
                        await self.invoke(
                            thought_callback=thought,
                            assistant_text_callback=assistant,
                            usage_callback=usage_callback,
                        )

                recorder.assert_awaited_once()
                recorded = recorder.await_args.args[0]
                self.assertEqual(recorded["status"], status)
                self.assertEqual(recorded["total_tokens"], 15)
                self.assertEqual(
                    recorded["metadata"]["terminal_event_type"], f"response.{status}"
                )
                thought.assert_not_awaited()
                assistant.assert_not_awaited()
                usage_callback.assert_not_awaited()
                self.assertTrue(response.closed)

    async def test_legacy_non_sse_parser_and_output_extractor_patches_are_used(self):
        payload = _payload()
        response = _Response(b"custom response format", sse=False)
        recorder = AsyncMock()
        with (
            self.transport(response, recorder),
            patch.object(
                llm_transport, "_parse_non_sse_responses_payload", return_value=payload
            ) as parse_payload,
            patch.object(
                llm_transport,
                "_extract_qwen_responses_output_text",
                return_value='{"patched":true}',
            ) as extract_output,
        ):
            result = await self.invoke()

        self.assertEqual(result, {"patched": True})
        parse_payload.assert_called_once_with(b"custom response format")
        extract_output.assert_called_once_with(payload)
        recorder.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
