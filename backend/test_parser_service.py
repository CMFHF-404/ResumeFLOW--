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
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()
sys.path.append(str(Path(__file__).parent))

from app.domain.parser import parser_service  # noqa: E402


class _FakeStreamResponse:
    def __init__(self, lines):
        self.headers = {"content-type": "text/event-stream"}
        self._lines = lines

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _FakeStreamContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, exc_type, exc, tb):
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
            "extract_resume_text",
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
        extract_text.assert_called_once()
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
            "extract_resume_text",
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
        with patch.object(parser_service, "extract_resume_text", return_value=" \n !!! "):
            with patch.object(
                parser_service,
                "_parse_resume_from_attachment",
                new_callable=AsyncMock,
            ) as attachment_parse:
                with self.assertRaisesRegex(ValueError, "无法读取附件中的文本内容"):
                    await parser_service.parse_resume(
                        b"%PDF-1.4",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-unreadable",
                    )

        attachment_parse.assert_not_called()

    async def test_parse_resume_with_thoughts_rejects_unreadable_text_without_attachment_ai(self) -> None:
        with patch.object(parser_service, "extract_resume_text", return_value=" \n !!! "):
            with patch.object(
                parser_service,
                "_parse_resume_from_attachment",
                new_callable=AsyncMock,
            ) as attachment_parse:
                with self.assertRaisesRegex(ValueError, "无法读取附件中的文本内容"):
                    await parser_service.parse_resume_with_thoughts(
                        b"%PDF-1.4",
                        "resume.pdf",
                        "application/pdf",
                        request_id="req-unreadable-stream",
                    )

        attachment_parse.assert_not_called()

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
                                with self.assertRaisesRegex(
                                    ValueError,
                                    "长时间未收到新的解析流数据",
                                ):
                                    await parser_service._stream_resume_thinking_parse(
                                        cleaned_text="候选人简历内容",
                                        request_id="req-timeout",
                                        thought_callback=None,
                                    )


if __name__ == "__main__":
    unittest.main()
