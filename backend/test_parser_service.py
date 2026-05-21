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
