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

from app.domain.parser import parser_router  # noqa: E402


class ParserRouterStreamTests(unittest.IsolatedAsyncioTestCase):
    async def _consume_stream(self, response) -> list[dict]:
        events: list[dict] = []
        async for chunk in response.body_iterator:
            text = chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            for line in text.splitlines():
                if line.strip():
                    events.append(json.loads(line))
        return events

    async def test_stream_parse_uses_standard_parser_by_default(self) -> None:
        file = SimpleNamespace(filename="resume.pdf", content_type="application/pdf")
        payload = {"work_experiences": [], "project_experiences": [], "education": []}

        with patch.object(parser_router, "extract_text", new_callable=AsyncMock, return_value=b"%PDF-1.4"):
            with patch.object(parser_router, "parse_resume", new_callable=AsyncMock, return_value=payload) as standard_parse:
                with patch.object(parser_router, "parse_resume_with_thoughts", new_callable=AsyncMock) as thinking_parse:
                    with patch.object(parser_router, "fetch_existing_experiences", new_callable=AsyncMock, return_value=[]):
                        with patch.object(
                            parser_router,
                            "apply_semantic_duplicate_flags",
                            new_callable=AsyncMock,
                            side_effect=lambda items, existing, request_id=None: items,
                        ) as semantic_dedupe:
                            response = await parser_router.parse_resume_stream_endpoint(
                                file=file,
                                session=SimpleNamespace(),
                                current_user=SimpleNamespace(id="user-1"),
                            )
                            events = await self._consume_stream(response)

        standard_parse.assert_awaited_once()
        thinking_parse.assert_not_awaited()
        semantic_dedupe.assert_awaited_once()
        self.assertEqual(events[-1]["type"], "final")

    async def test_stream_parse_uses_thinking_parser_when_enabled(self) -> None:
        file = SimpleNamespace(filename="resume.pdf", content_type="application/pdf")
        payload = {"work_experiences": [], "project_experiences": [], "education": []}

        with patch.object(parser_router, "extract_text", new_callable=AsyncMock, return_value=b"%PDF-1.4"):
            with patch.object(parser_router, "parse_resume", new_callable=AsyncMock) as standard_parse:
                with patch.object(
                    parser_router,
                    "parse_resume_with_thoughts",
                    new_callable=AsyncMock,
                    return_value=payload,
                ) as thinking_parse:
                    with patch.object(parser_router, "fetch_existing_experiences", new_callable=AsyncMock, return_value=[]):
                        with patch.object(
                            parser_router,
                            "apply_semantic_duplicate_flags",
                            new_callable=AsyncMock,
                            side_effect=lambda items, existing, request_id=None: items,
                        ) as semantic_dedupe:
                            response = await parser_router.parse_resume_stream_endpoint(
                                file=file,
                                enable_thinking=True,
                                session=SimpleNamespace(),
                                current_user=SimpleNamespace(id="user-1"),
                            )
                            events = await self._consume_stream(response)

        thinking_parse.assert_awaited_once()
        standard_parse.assert_not_awaited()
        semantic_dedupe.assert_awaited_once()
        self.assertEqual(events[-1]["type"], "final")

    async def test_non_stream_parse_applies_semantic_dedupe(self) -> None:
        file = SimpleNamespace(filename="resume.pdf", content_type="application/pdf")
        payload = {"work_experiences": [], "project_experiences": [], "education": []}

        with patch.object(parser_router, "extract_text", new_callable=AsyncMock, return_value=b"%PDF-1.4"):
            with patch.object(parser_router, "parse_resume", new_callable=AsyncMock, return_value=payload):
                with patch.object(parser_router, "fetch_existing_experiences", new_callable=AsyncMock, return_value=[]):
                    with patch.object(
                        parser_router,
                        "apply_semantic_duplicate_flags",
                        new_callable=AsyncMock,
                        side_effect=lambda items, existing, request_id=None: items,
                    ) as semantic_dedupe:
                        response = await parser_router._build_parse_response(
                            file=file,
                            session=SimpleNamespace(),
                            user_id="user-1",
                            request_id="req-non-stream",
                        )

        semantic_dedupe.assert_awaited_once()
        self.assertEqual(response.items, [])


if __name__ == "__main__":
    unittest.main()
