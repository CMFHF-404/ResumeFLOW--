import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()
sys.path.append(str(Path(__file__).parent))

from app.domain.parser import parser_service, thinking_transport  # noqa: E402
from app.domain.ai.runtime_budget import (  # noqa: E402
    AiRuntimeBudget,
    AiRuntimeBudgetExceeded,
    AiRuntimeTimeoutError,
    AiStreamConsumerError,
    AiUsageAccountingError,
)


class _FakeStreamResponse:
    def __init__(self, lines):
        self.headers = {"content-type": "text/event-stream"}
        self._lines = lines
        self.status_code = 200
        self.closed = False

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self, chunk_size=None):
        for line in self._lines:
            data = f"{line}\n".encode("utf-8")
            resolved_chunk_size = chunk_size or len(data) or 1
            for index in range(0, len(data), resolved_chunk_size):
                yield data[index : index + resolved_chunk_size]

    async def aclose(self):
        self.closed = True


class _FakeStreamContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, exc_type, exc, tb):
        await self._response.aclose()
        return False


class _FakeAsyncClient:
    def __init__(self, response, timeout):
        self.response = response
        self.timeout = timeout
        self.stream_calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, *args, **kwargs):
        self.stream_calls.append((args, kwargs))
        return _FakeStreamContext(self.response)


class ParserServiceGeminiThinkingTests(unittest.IsolatedAsyncioTestCase):
    async def test_parse_resume_with_thoughts_propagates_runtime_budget_errors(self) -> None:
        parser_service.clear_parse_cache()
        for runtime_error in (
            AiRuntimeTimeoutError,
            AiRuntimeBudgetExceeded,
            AiUsageAccountingError,
            AiStreamConsumerError,
        ):
            with self.subTest(runtime_error=runtime_error.__name__):
                with patch.object(
                    parser_service,
                    "extract_resume_text_bounded",
                    new_callable=AsyncMock,
                    return_value=(
                        "简历正文 包含足够多的候选人经历文本，涵盖工作经历、项目经历、教育背景和技能。"
                    ),
                ):
                    with patch.object(
                        parser_service,
                        "_has_thinking_stream_provider",
                        return_value=True,
                    ):
                        with patch.object(
                            parser_service,
                            "_stream_resume_thinking_parse",
                            new_callable=AsyncMock,
                            side_effect=runtime_error(runtime_error.public_message),
                        ):
                            with patch.object(
                                parser_service,
                                "_parse_resume_from_text",
                                new_callable=AsyncMock,
                            ) as standard_parse:
                                with self.assertRaises(runtime_error):
                                    await parser_service.parse_resume_with_thoughts(
                                        b"%PDF-1.4 terminal runtime error",
                                        "resume.pdf",
                                        "application/pdf",
                                        request_id=f"req-{runtime_error.code}",
                                    )

                standard_parse.assert_not_awaited()

    async def test_optional_parser_ai_fallbacks_propagate_runtime_budget_errors(self) -> None:
        for runtime_error in (
            AiRuntimeTimeoutError,
            AiRuntimeBudgetExceeded,
            AiUsageAccountingError,
            AiStreamConsumerError,
        ):
            with self.subTest(runtime_error=runtime_error.__name__, stage="merge"):
                with patch.object(
                    parser_service,
                    "_call_resume_llm",
                    new_callable=AsyncMock,
                    side_effect=runtime_error(runtime_error.public_message),
                ):
                    with self.assertRaises(runtime_error):
                        await parser_service._merge_with_llm(
                            {"work_experiences": []},
                            "req-merge-runtime",
                        )

            with self.subTest(runtime_error=runtime_error.__name__, stage="chunk"):
                with (
                    patch.object(
                        parser_service,
                        "_split_resume_text",
                        return_value=["resume chunk"],
                    ),
                    patch.object(
                        parser_service,
                        "_call_resume_llm",
                        new_callable=AsyncMock,
                        side_effect=runtime_error(runtime_error.public_message),
                    ),
                ):
                    with self.assertRaises(runtime_error):
                        await parser_service._parse_resume_chunked(
                            "resume chunk",
                            "req-chunk-runtime",
                        )

    async def test_parse_resume_reuses_cached_result_for_same_file(self) -> None:
        payload = {
            "work_experiences": [
                {"title": "Engineer", "org": "Example", "star": {"a": "Kept verbatim"}}
            ],
            "project_experiences": [],
            "education": [],
        }

        parser_service.clear_parse_cache()
        with patch.object(
            parser_service,
            "extract_resume_text_bounded",
            new_callable=AsyncMock,
            return_value="简历正文 包含足够多的候选人经历文本\nKept verbatim action details",
        ) as extract_text:
            with patch.object(
                parser_service,
                "_parse_resume_from_text",
                new_callable=AsyncMock,
                return_value=payload,
            ) as parse_from_text:
                first = await parser_service.parse_resume(
                    b"%PDF-1.4 cached",
                    "resume.pdf",
                    "application/pdf",
                    request_id="req-cache-1",
                )
                second = await parser_service.parse_resume(
                    b"%PDF-1.4 cached",
                    "resume.pdf",
                    "application/pdf",
                    request_id="req-cache-2",
                )

        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        extract_text.assert_awaited_once()
        parse_from_text.assert_awaited_once()

    async def test_parse_resume_with_thoughts_does_not_cache_standard_fallback(self) -> None:
        fallback_payload = {
            "work_experiences": [{"title": "Fallback", "org": "Example"}],
            "project_experiences": [],
            "education": [],
        }
        thinking_payload = {
            "work_experiences": [{"title": "Thinking", "org": "Example"}],
            "project_experiences": [],
            "education": [],
        }

        parser_service.clear_parse_cache()
        with patch.object(
            parser_service,
            "extract_resume_text_bounded",
            new_callable=AsyncMock,
            return_value="简历正文 包含足够多的候选人经历文本\nThinking retry details",
        ) as extract_text:
            fallback_settings = SimpleNamespace(
                ai_model="openai-standard",
                gemini_model="gemini-thinking",
                gemini_api_key=None,
            )
            with patch.object(parser_service, "settings", fallback_settings):
                with patch.object(
                    parser_service,
                    "_parse_resume_from_text",
                    new_callable=AsyncMock,
                    return_value=fallback_payload,
                ) as parse_from_text:
                    first = await parser_service.parse_resume_with_thoughts(
                        b"%PDF-1.4 thinking fallback",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-thinking-fallback",
                    )

            thinking_settings = SimpleNamespace(
                ai_model="openai-standard",
                gemini_model="gemini-thinking",
                gemini_api_key="gemini-key",
            )
            with patch.object(parser_service, "settings", thinking_settings):
                with patch.object(
                    parser_service,
                    "_stream_resume_thinking_parse",
                    new_callable=AsyncMock,
                    return_value=thinking_payload,
                ) as thinking_parse:
                    second = await parser_service.parse_resume_with_thoughts(
                        b"%PDF-1.4 thinking fallback",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-thinking-retry",
                    )

        self.assertEqual(first, fallback_payload)
        self.assertEqual(second, thinking_payload)
        self.assertEqual(extract_text.call_count, 2)
        parse_from_text.assert_awaited_once()
        thinking_parse.assert_awaited_once()

    async def test_parse_resume_with_thoughts_uses_qwen_without_gemini_key(self) -> None:
        thinking_payload = {
            "work_experiences": [{"title": "Qwen Thinking", "org": "Example"}],
            "project_experiences": [],
            "education": [],
        }
        progress_callback = AsyncMock()

        parser_service.clear_parse_cache()
        with patch.object(
            parser_service,
            "extract_resume_text_bounded",
            new_callable=AsyncMock,
            return_value="简历正文 包含足够多的候选人经历文本\nQwen thinking details",
        ):
            qwen_settings = SimpleNamespace(
                ai_route_profile="qwen_primary",
                ai_model="qwen3.7-plus",
                ai_api_key="dashscope-key",
                gemini_model="gemini-thinking",
                gemini_api_key=None,
            )
            with patch.object(parser_service, "settings", qwen_settings):
                with patch.object(
                    parser_service,
                    "_stream_resume_thinking_parse",
                    new_callable=AsyncMock,
                    return_value=thinking_payload,
                ) as thinking_parse:
                    result = await parser_service.parse_resume_with_thoughts(
                        b"%PDF-1.4 qwen thinking",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-qwen-thinking",
                        progress_callback=progress_callback,
                    )

        self.assertEqual(result, thinking_payload)
        thinking_parse.assert_awaited_once()
        progress_callback.assert_any_await(
            {"type": "progress", "node": "request_ai", "title": "调用 AI 深度解析"}
        )

    async def test_stream_resume_thinking_parse_for_qwen_preserves_summary_thought_events(self) -> None:
        structured_payload = {
            "personal_info": {},
            "work_experiences": [{"title": "Qwen Responses", "org": "Example"}],
            "project_experiences": [],
            "education": [],
            "certifications": [],
            "skills": [],
        }
        thought_callback = AsyncMock()

        async def fake_stream_thinking_json_response(**kwargs):
            await kwargs["thought_callback"](
                {"type": "thought", "summary": "正在读取简历结构"}
            )
            return structured_payload

        qwen_settings = SimpleNamespace(
            ai_route_profile="qwen_primary",
            ai_model="qwen3.7-plus",
            ai_api_key="dashscope-key",
            gemini_model="gemini-thinking",
            gemini_api_key=None,
        )
        with patch.object(parser_service, "settings", qwen_settings):
            with patch.object(
                parser_service,
                "_stream_thinking_json_response",
                new_callable=AsyncMock,
                side_effect=fake_stream_thinking_json_response,
            ) as stream_mock:
                result = await parser_service._stream_resume_thinking_parse(
                    cleaned_text="候选人简历内容",
                    request_id="req-qwen-responses",
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, structured_payload)
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在读取简历结构"}
        )
        stream_mock.assert_awaited_once()
        self.assertEqual(stream_mock.await_args.kwargs["request_label"], "resume_parse")

    def test_thinking_parse_cache_key_uses_qwen_model_when_qwen_is_primary(self) -> None:
        with patch.object(
            parser_service,
            "settings",
            SimpleNamespace(
                ai_route_profile="qwen_primary",
                ai_model="qwen3.7-plus",
                ai_api_key="dashscope-key",
                gemini_model="gemini-thinking",
            ),
        ):
            qwen_plus_key = parser_service._build_parse_cache_key(
                b"%PDF-1.4 same file",
                "resume.pdf",
                "application/pdf",
                "thinking",
            )

        with patch.object(
            parser_service,
            "settings",
            SimpleNamespace(
                ai_route_profile="qwen_primary",
                ai_model="qwen3.6-plus",
                ai_api_key="dashscope-key",
                gemini_model="gemini-thinking",
            ),
        ):
            qwen_legacy_key = parser_service._build_parse_cache_key(
                b"%PDF-1.4 same file",
                "resume.pdf",
                "application/pdf",
                "thinking",
            )

        self.assertNotEqual(qwen_plus_key, qwen_legacy_key)

    def test_standard_parse_cache_key_uses_fast_model_when_configured(self) -> None:
        with patch.object(
            parser_service,
            "settings",
            SimpleNamespace(
                ai_model="qwen3.7-plus",
                ai_fast_model="qwen-turbo",
                ai_api_key="dashscope-key",
                gemini_model="gemini-thinking",
            ),
        ):
            fast_key = parser_service._build_parse_cache_key(
                b"%PDF-1.4 same file",
                "resume.pdf",
                "application/pdf",
                "standard",
            )

        with patch.object(
            parser_service,
            "settings",
            SimpleNamespace(
                ai_model="qwen3.7-plus",
                ai_fast_model="qwen-plus",
                ai_api_key="dashscope-key",
                gemini_model="gemini-thinking",
            ),
        ):
            plus_key = parser_service._build_parse_cache_key(
                b"%PDF-1.4 same file",
                "resume.pdf",
                "application/pdf",
                "standard",
            )

        self.assertNotEqual(fast_key, plus_key)

    async def test_standard_parse_llm_call_uses_fast_model_when_configured(self) -> None:
        with patch.object(
            parser_service,
            "settings",
            SimpleNamespace(
                ai_route_profile="hybrid_gemini_aifast",
                ai_model="qwen3.7-plus",
                ai_fast_model="aifast-resume",
                ai_api_key="dashscope-key",
                ai_fast_api_key="aifast-key",
                ai_fast_base_url="https://aifast.example.com/v1",
                gemini_model="gemini-thinking",
            ),
        ):
            with patch.object(
                parser_service,
                "call_llm_json",
                new_callable=AsyncMock,
                return_value={"work_experiences": []},
            ) as llm_call:
                result = await parser_service._call_resume_llm(
                    [{"role": "user", "content": "返回 JSON"}],
                    "req-fast-model",
                    "ai_call",
                )

        self.assertEqual(result, {"work_experiences": []})
        self.assertEqual(llm_call.await_args.kwargs["model"], "aifast-resume")
        self.assertEqual(llm_call.await_args.kwargs["lane"], "resume_parse")

    async def test_parse_resume_chunked_runs_chunk_calls_concurrently(self) -> None:
        active_calls = 0
        max_active_calls = 0

        async def fake_call(messages, request_id, step, extra=None):
            nonlocal active_calls, max_active_calls
            active_calls += 1
            max_active_calls = max(max_active_calls, active_calls)
            await asyncio.sleep(0.02)
            active_calls -= 1
            return {
                "work_experiences": [
                    {
                        "title": messages[1]["content"],
                        "org": "Example",
                        "star": {"a": messages[1]["content"]},
                    }
                ],
                "project_experiences": [],
                "education": [],
            }

        with patch.object(parser_service, "_split_resume_text", return_value=["chunk-a", "chunk-b", "chunk-c"]):
            with patch.object(parser_service, "_call_resume_llm", side_effect=fake_call):
                with patch.object(parser_service, "_merge_with_llm", new_callable=AsyncMock, side_effect=lambda draft, request_id: draft):
                    result = await parser_service._parse_resume_chunked(
                        "chunk-a\nchunk-b\nchunk-c",
                        "req-concurrent",
                    )

        self.assertGreater(max_active_calls, 1)
        self.assertEqual(len(result["work_experiences"]), 3)

    async def test_parse_resume_rejects_unreadable_text_without_attachment_ai(self) -> None:
        with patch.object(
            parser_service,
            "extract_resume_text_bounded",
            new_callable=AsyncMock,
            return_value=" \n !!! ",
        ):
            with patch.object(
                parser_service,
                "_call_resume_llm",
                new_callable=AsyncMock,
            ) as llm_call:
                with self.assertRaisesRegex(ValueError, "无法读取附件中的文本内容"):
                    await parser_service.parse_resume(
                        b"%PDF-1.4",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-unreadable",
                    )

        llm_call.assert_not_called()

    async def test_parse_resume_with_thoughts_rejects_unreadable_text_without_attachment_ai(self) -> None:
        with patch.object(
            parser_service,
            "extract_resume_text_bounded",
            new_callable=AsyncMock,
            return_value=" \n !!! ",
        ):
            with patch.object(
                parser_service,
                "_call_resume_llm",
                new_callable=AsyncMock,
            ) as llm_call:
                with patch.object(
                    parser_service,
                    "_stream_resume_thinking_parse",
                    new_callable=AsyncMock,
                ) as thinking_call:
                    with self.assertRaisesRegex(ValueError, "无法读取附件中的文本内容"):
                        await parser_service.parse_resume_with_thoughts(
                            b"%PDF-1.4",
                            "resume.pdf",
                            "application/pdf",
                            request_id="req-unreadable-stream",
                        )

        llm_call.assert_not_called()
        thinking_call.assert_not_called()

    def test_normalize_date_uses_month_granularity(self) -> None:
        self.assertEqual(parser_service._normalize_date("2024.05"), "2024-05-01")
        self.assertEqual(parser_service._normalize_date("2025-03"), "2025-03-01")
        self.assertEqual(parser_service._normalize_date("2025/8/31"), "2025-08-01")
        self.assertEqual(parser_service._normalize_date("2026年4月30日"), "2026-04-01")
        self.assertEqual(parser_service._normalize_date("2026-08-22"), "2026-08-01")

    def test_build_gemini_timeout_uses_global_ai_timeout(self) -> None:
        fake_settings = SimpleNamespace(ai_timeout_seconds=300)

        with patch.object(parser_service, "settings", fake_settings):
            timeout = parser_service._build_gemini_timeout()

        self.assertEqual(timeout.connect, parser_service.GEMINI_CONNECT_TIMEOUT_SECONDS)
        self.assertEqual(timeout.write, 300)
        self.assertEqual(timeout.read, 300)
        self.assertEqual(timeout.pool, parser_service.GEMINI_POOL_TIMEOUT_SECONDS)

    async def test_stream_resume_thinking_parse_keeps_thought_events_and_returns_json(self) -> None:
        structured_payload = {
            "personal_info": {},
            "work_experiences": [],
            "project_experiences": [],
            "education": [],
            "certifications": [],
            "skills": [],
        }
        thought_event = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "正在读取简历结构", "thought": True},
                        ]
                    }
                }
            ]
        }
        answer_event = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": json.dumps(structured_payload, ensure_ascii=False)},
                        ]
                    }
                }
            ]
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(thought_event, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_settings = SimpleNamespace(
            ai_timeout_seconds=300,
            gemini_model="gemini-2.5-flash",
        )
        fake_client = _FakeAsyncClient(response=response, timeout=None)
        thought_callback = AsyncMock()

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        with patch.object(parser_service, "settings", fake_settings):
            with patch.object(parser_service.httpx, "AsyncClient", side_effect=_client_factory):
                with patch.object(
                    parser_service,
                    "_build_gemini_headers",
                    return_value={"x-goog-api-key": "gemini-key"},
                ):
                    with patch.object(
                        parser_service,
                        "_build_gemini_stream_url",
                        return_value="https://example.com/v1beta/models/demo:streamGenerateContent?alt=sse",
                    ):
                        result = await parser_service._stream_resume_thinking_parse(
                            cleaned_text="候选人简历内容",
                            request_id="req-1",
                            thought_callback=thought_callback,
                        )

        self.assertEqual(result, structured_payload)
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在读取简历结构"}
        )
        self.assertEqual(fake_client.timeout.read, 300)
        self.assertEqual(len(fake_client.stream_calls), 1)

    async def test_stream_resume_thinking_parse_records_gemini_usage(self) -> None:
        structured_payload = {
            "personal_info": {},
            "work_experiences": [],
            "project_experiences": [],
            "education": [],
            "certifications": [],
            "skills": [],
        }
        response = _FakeStreamResponse(
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
                                "content": {
                                    "parts": [
                                        {
                                            "text": json.dumps(
                                                structured_payload,
                                                ensure_ascii=False,
                                            )
                                        }
                                    ]
                                }
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_settings = SimpleNamespace(
            ai_timeout_seconds=300,
            gemini_model="gemini-2.5-flash",
        )
        fake_client = _FakeAsyncClient(response=response, timeout=None)
        usage_mock = AsyncMock()

        with (
            patch.object(parser_service, "settings", fake_settings),
            patch.object(parser_service.httpx, "AsyncClient", return_value=fake_client),
            patch.object(parser_service, "_build_gemini_headers", return_value={}),
            patch.object(
                parser_service,
                "_build_gemini_stream_url",
                return_value="https://example.com/v1beta/models/demo:streamGenerateContent?alt=sse",
            ),
            patch.object(thinking_transport, "emit_usage_payload", usage_mock),
        ):
            result = await parser_service._stream_resume_thinking_parse(
                cleaned_text="候选人简历内容",
                request_id="req-usage",
                thought_callback=None,
            )

        self.assertEqual(result, structured_payload)
        usage = usage_mock.await_args.args[1]
        self.assertEqual(usage["prompt_tokens"], 10)
        self.assertEqual(usage["completion_tokens"], 5)
        self.assertEqual(usage["total_tokens"], 15)
        self.assertEqual(usage["request_label"], "resume_parse")

    async def test_stream_resume_thinking_parse_times_out_when_no_payload_arrives(self) -> None:
        response = _FakeStreamResponse([])
        fake_settings = SimpleNamespace(
            ai_timeout_seconds=300,
            gemini_model="gemini-2.5-flash",
        )
        fake_client = _FakeAsyncClient(response=response, timeout=None)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        async def _stalled_payloads(_response):
            while True:
                await asyncio.sleep(1)
                if False:
                    yield None

        with patch.object(parser_service, "settings", fake_settings):
            with patch.object(parser_service.httpx, "AsyncClient", side_effect=_client_factory):
                with patch.object(
                    parser_service,
                    "_build_gemini_headers",
                    return_value={"x-goog-api-key": "gemini-key"},
                ):
                    with patch.object(
                        parser_service,
                        "_build_gemini_stream_url",
                        return_value="https://example.com/v1beta/models/demo:streamGenerateContent?alt=sse",
                    ):
                        with patch.object(
                            parser_service,
                            "_iter_sse_json_payloads",
                            side_effect=_stalled_payloads,
                        ):
                            with patch.object(
                                parser_service,
                                "THOUGHT_PAYLOAD_TIMEOUT_SECONDS",
                                0.01,
                            ):
                                with self.assertRaises(AiRuntimeTimeoutError):
                                    await parser_service._stream_resume_thinking_parse(
                                        cleaned_text="候选人简历内容",
                                        request_id="req-timeout",
                                        thought_callback=None,
                                    )

    async def test_stream_resume_thinking_parse_uses_one_absolute_payload_deadline(self) -> None:
        response = _FakeStreamResponse([])
        fake_settings = SimpleNamespace(
            ai_timeout_seconds=300,
            gemini_model="gemini-2.5-flash",
        )
        fake_client = _FakeAsyncClient(response=response, timeout=None)

        async def _slow_but_active_payloads(_response):
            for index in range(4):
                await asyncio.sleep(0.008)
                yield {"candidates": [{"content": {"parts": [{"thought": True, "text": str(index)}]}}]}

        with (
            patch.object(parser_service, "settings", fake_settings),
            patch.object(parser_service.httpx, "AsyncClient", return_value=fake_client),
            patch.object(parser_service, "_build_gemini_headers", return_value={}),
            patch.object(
                parser_service,
                "_build_gemini_stream_url",
                return_value="https://example.com/v1beta/models/demo:streamGenerateContent?alt=sse",
            ),
            patch.object(
                parser_service,
                "_iter_sse_json_payloads",
                side_effect=_slow_but_active_payloads,
            ),
            patch.object(
                parser_service,
                "THOUGHT_PAYLOAD_TIMEOUT_SECONDS",
                0.02,
            ),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await parser_service._stream_resume_thinking_parse(
                    cleaned_text="候选人简历内容",
                    request_id="req-total-timeout",
                    thought_callback=AsyncMock(),
                )

    async def test_stream_resume_thinking_parse_timeout_covers_blocked_callback(self) -> None:
        response = _FakeStreamResponse([])
        fake_settings = SimpleNamespace(
            ai_timeout_seconds=300,
            gemini_model="gemini-2.5-flash",
        )
        fake_client = _FakeAsyncClient(response=response, timeout=None)
        callback_cancelled = asyncio.Event()

        async def _one_thought(_response):
            yield {
                "candidates": [
                    {"content": {"parts": [{"thought": True, "text": "thinking"}]}}
                ]
            }

        async def _blocked_callback(_callback, _payload):
            try:
                await asyncio.Future()
            finally:
                callback_cancelled.set()

        with (
            patch.object(parser_service, "settings", fake_settings),
            patch.object(parser_service.httpx, "AsyncClient", return_value=fake_client),
            patch.object(parser_service, "_build_gemini_headers", return_value={}),
            patch.object(
                parser_service,
                "_build_gemini_stream_url",
                return_value="https://example.com/v1beta/models/demo:streamGenerateContent?alt=sse",
            ),
            patch.object(
                parser_service,
                "_iter_sse_json_payloads",
                side_effect=_one_thought,
            ),
            patch.object(parser_service, "_emit_thought", side_effect=_blocked_callback),
            patch(
                "app.domain.ai.runtime_budget.get_ai_runtime_budget",
                return_value=AiRuntimeBudget(stream_total_timeout_seconds=0.02),
            ),
        ):
            with self.assertRaises(AiRuntimeTimeoutError):
                await parser_service._stream_resume_thinking_parse(
                    cleaned_text="候选人简历内容",
                    request_id="req-callback-timeout",
                    thought_callback=AsyncMock(),
                )

        self.assertTrue(callback_cancelled.is_set())
        self.assertTrue(response.closed)

    async def test_terminal_chunk_failure_cancels_parallel_chunk_requests(self) -> None:
        slow_started = asyncio.Event()
        slow_cancelled = asyncio.Event()
        call_index = 0

        async def _call_chunk(*_args, **_kwargs):
            nonlocal call_index
            index = call_index
            call_index += 1
            if index == 0:
                await slow_started.wait()
                raise AiRuntimeBudgetExceeded(
                    AiRuntimeBudgetExceeded.public_message
                )
            slow_started.set()
            try:
                await asyncio.Future()
            finally:
                slow_cancelled.set()

        with (
            patch.object(parser_service, "_split_resume_text", return_value=["one", "two"]),
            patch.object(parser_service, "_call_resume_llm", side_effect=_call_chunk),
        ):
            with self.assertRaises(AiRuntimeBudgetExceeded):
                await parser_service._parse_resume_chunked(
                    "chunked resume",
                    "req-terminal-chunk",
                )

        self.assertTrue(slow_cancelled.is_set())


if __name__ == "__main__":
    unittest.main()
