import io
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.domain.ai import ai_router
from app.domain.ai.public_errors import AiProviderPayloadError
from app.domain.parser import document_text, parser_router, parser_service
from app.domain.parser.errors import ResumeInputError, ResumeUpstreamPayloadError


class _AsyncContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, traceback):
        return False


async def _override_session():
    yield object()


async def _override_current_user():
    return SimpleNamespace(id="user-ai-public-errors")


def _provider_connect_error() -> httpx.ConnectError:
    return httpx.ConnectError(
        "provider unavailable",
        request=httpx.Request("POST", "https://provider.example/v1/generate"),
    )


class AiPublicErrorHttpTests(unittest.IsolatedAsyncioTestCase):
    def _build_app(self, router_module) -> FastAPI:
        app = FastAPI()
        app.include_router(router_module.router)
        app.dependency_overrides[router_module.get_session] = _override_session
        app.dependency_overrides[router_module.get_current_user] = (
            _override_current_user
        )
        return app

    async def test_all_non_stream_ai_endpoints_translate_only_known_upstream_errors(self):
        app = self._build_app(ai_router)
        endpoints = (
            ("/api/analyze-jd", {"text": "JD"}, "analyze_jd"),
            (
                "/api/resume-evaluation",
                {"text": "JD", "resume_text": "resume"},
                "analyze_resume_evaluation",
            ),
            ("/api/polish-text", {"content": {"s": "text"}}, "polish_experience"),
            (
                "/api/split-experience-text",
                {"raw_text": "experience", "category": "work"},
                "split_experience_text",
            ),
            ("/api/generate-tags", {"text": "skill text"}, "generate_tags"),
            (
                "/api/generate-boss-greeting",
                {"jd_text": "JD", "analysis_summary": "summary"},
                "generate_boss_greeting",
            ),
            (
                "/api/generate-personal-summary",
                {"mode": "standard"},
                "generate_personal_summary",
            ),
        )
        error_matrix = (
            (lambda: AiProviderPayloadError("provider returned invalid JSON"), 502),
            (_provider_connect_error, 503),
            (lambda: RuntimeError("consumer bug"), 500),
        )

        with (
            patch.object(
                ai_router.billing_service,
                "ai_billing_context",
                return_value=_AsyncContext(),
            ),
            patch.object(
                ai_router.billing_service,
                "ensure_current_quota",
                AsyncMock(),
            ),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as client:
                for path, payload, service_name in endpoints:
                    for error_factory, expected_status in error_matrix:
                        with self.subTest(
                            path=path,
                            service=service_name,
                            status=expected_status,
                        ):
                            with patch.object(
                                ai_router,
                                service_name,
                                AsyncMock(side_effect=error_factory()),
                            ):
                                response = await client.post(path, json=payload)
                            self.assertEqual(
                                response.status_code,
                                expected_status,
                                response.text,
                            )

    async def test_parser_endpoint_distinguishes_input_upstream_and_internal_errors(self):
        app = self._build_app(parser_router)
        error_matrix = (
            (ResumeInputError("bad user file"), 400),
            (ResumeUpstreamPayloadError("empty provider response"), 502),
            (_provider_connect_error(), 503),
            (RuntimeError("consumer bug"), 500),
        )

        with (
            patch.object(
                parser_router.billing_service,
                "ai_billing_context",
                return_value=_AsyncContext(),
            ),
            patch.object(
                parser_router.billing_service,
                "ensure_current_quota",
                AsyncMock(),
            ),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as client:
                for error, expected_status in error_matrix:
                    with self.subTest(error=type(error).__name__):
                        with patch.object(
                            parser_router,
                            "_build_parse_response",
                            AsyncMock(side_effect=error),
                        ):
                            response = await client.post(
                                "/parser/parse",
                                files={
                                    "file": (
                                        "resume.pdf",
                                        b"%PDF-1.4 valid transport shell",
                                        "application/pdf",
                                    )
                                },
                            )
                        self.assertEqual(
                            response.status_code,
                            expected_status,
                            response.text,
                        )

    def test_parser_sources_raise_typed_input_and_upstream_errors(self):
        with self.assertRaises(ResumeInputError):
            document_text.extract_resume_text(
                b"not-a-pdf",
                "resume.txt",
                "text/plain",
            )
        for provider_text in ("", "not-json"):
            with self.subTest(provider_text=provider_text):
                with self.assertRaises(ResumeUpstreamPayloadError):
                    parser_service._parse_structured_response_text(provider_text)


if __name__ == "__main__":
    unittest.main()
