import asyncio
import os
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
)
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")

from app.domain.ai import runtime_budget, usage_bridge  # noqa: E402
from app.domain.parser import thinking_transport  # noqa: E402


class _StreamClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    @asynccontextmanager
    async def stream(self, *_args, **_kwargs):
        yield SimpleNamespace(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            raise_for_status=lambda: None,
        )


class ParserUsageCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def _run_interrupted_stream(self, usage_stage, error, *, waiting=None):
        async def payloads(_response):
            if usage_stage != "missing":
                yield {
                    "usageMetadata": {"totalTokenCount": 15},
                    "candidates": (
                        [] if usage_stage == "final" else [{"content": {"parts": []}}]
                    ),
                }
            if waiting is not None:
                waiting.set()
                await asyncio.Future()
            raise error

        return await thinking_transport.stream_resume_thinking_parse(
            cleaned_text="resume",
            request_id="cleanup-regression",
            thought_callback=None,
            settings=SimpleNamespace(gemini_model="gemini-test"),
            request_body={},
            build_headers=lambda: {},
            build_stream_url=lambda _model: "https://provider.example/stream",
            build_timeout=lambda: None,
            build_payload_timeout_seconds=lambda: 10,
            iter_sse_json_payloads=payloads,
            emit_thought=AsyncMock(),
            parse_structured_response_text=lambda _text: {},
            normalize_parse_result=lambda value: value,
            log_timing=lambda *_args: None,
            httpx_module=SimpleNamespace(
                AsyncClient=lambda **_kwargs: _StreamClient(),
                HTTPStatusError=httpx.HTTPStatusError,
                TimeoutException=httpx.TimeoutException,
            ),
        )

    async def test_error_categories_preserve_usage_and_primary_exception(self):
        cases = (
            (httpx.ReadTimeout, runtime_budget.AiRuntimeTimeoutError, "timeout"),
            (TimeoutError, runtime_budget.AiRuntimeTimeoutError, "timeout"),
            (asyncio.CancelledError, asyncio.CancelledError, "cancelled"),
            (
                runtime_budget.AiRuntimeBudgetExceeded,
                runtime_budget.AiRuntimeBudgetExceeded,
                "AiRuntimeBudgetExceeded",
            ),
            (ValueError, ValueError, "ValueError"),
        )
        for usage_stage in ("missing", "partial", "final"):
            for error_type, expected_type, classification in cases:
                with self.subTest(usage_stage=usage_stage, error_type=error_type.__name__):
                    error = error_type("stream interrupted")
                    recorder = AsyncMock()
                    sink = usage_bridge.UsageSink(recorder=recorder)
                    with patch.object(usage_bridge, "_usage_sink", sink):
                        with self.assertRaises(expected_type) as raised:
                            await self._run_interrupted_stream(usage_stage, error)
                    if expected_type is error_type:
                        self.assertIs(raised.exception, error)
                    else:
                        self.assertIs(raised.exception.__cause__, error)
                    recorder.assert_awaited_once()
                    payload = recorder.await_args.args[0]
                    self.assertEqual(payload["request_label"], "resume_parse")
                    self.assertEqual(payload["provider"], "gemini")
                    if usage_stage == "missing":
                        self.assertEqual(payload["status"], "failed")
                        self.assertEqual(payload["metadata"]["error"], classification)
                        self.assertEqual(payload["total_tokens"], 0)
                    else:
                        self.assertEqual(payload["status"], "success")
                        self.assertEqual(payload["total_tokens"], 15)
                        self.assertEqual(
                            payload["metadata"].get("finalized_during_cleanup", False),
                            usage_stage == "partial",
                        )

    async def test_cleanup_recorder_failure_does_not_replace_primary_error(self):
        for usage_stage in ("missing", "partial"):
            for error_type in (ValueError, asyncio.CancelledError):
                with self.subTest(usage_stage=usage_stage, error_type=error_type.__name__):
                    error = error_type("stream interrupted")
                    recorder = AsyncMock(side_effect=RuntimeError("recording failed"))
                    sink = usage_bridge.UsageSink(recorder=recorder)
                    with patch.object(usage_bridge, "_usage_sink", sink):
                        with self.assertRaises(error_type) as raised:
                            await self._run_interrupted_stream(usage_stage, error)
                    self.assertIs(raised.exception, error)
                    recorder.assert_awaited_once()

    async def test_started_final_persistence_is_not_retried_as_cleanup(self):
        recorder = AsyncMock(side_effect=RuntimeError("recording failed"))
        with patch.object(usage_bridge, "_usage_sink", usage_bridge.UsageSink(recorder=recorder)):
            with self.assertRaises(runtime_budget.AiUsageAccountingError):
                await self._run_interrupted_stream("final", ValueError("never reached"))
        recorder.assert_awaited_once()
        payload = recorder.await_args.args[0]
        self.assertEqual(payload["total_tokens"], 15)
        self.assertNotIn("finalized_during_cleanup", payload["metadata"])

    async def test_caller_cancellation_records_partial_usage_once(self):
        waiting = asyncio.Event()
        recorder = AsyncMock()
        with patch.object(usage_bridge, "_usage_sink", usage_bridge.UsageSink(recorder=recorder)):
            task = asyncio.create_task(self._run_interrupted_stream(
                "partial", ValueError("never reached"), waiting=waiting,
            ))
            try:
                await asyncio.wait_for(waiting.wait(), timeout=1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            finally:
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        recorder.assert_awaited_once()
        payload = recorder.await_args.args[0]
        self.assertEqual(payload["total_tokens"], 15)
        self.assertTrue(payload["metadata"]["finalized_during_cleanup"])


if __name__ == "__main__":
    unittest.main()
