import os
import subprocess
import sys
import textwrap
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def _set_required_env_defaults() -> None:
    os.environ.setdefault(
        "DATABASE_URL",
        "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
    )
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.ai import ai_service  # noqa: E402
from app.domain.ai import jd_analysis_service  # noqa: E402
from app.domain.ai import llm_transport  # noqa: E402
from app.domain.ai import sse_events  # noqa: E402
from app.domain.ai import streaming_policy  # noqa: E402
from app.domain.parser import parser_service  # noqa: E402
from app.domain.parser import thinking_transport  # noqa: E402


class _FakeStreamResponse:
    def __init__(self, lines):
        self._lines = lines

    async def aiter_lines(self):
        for line in self._lines:
            yield line


async def _collect_payloads(iterator):
    return [payload async for payload in iterator]


class StreamingPolicyTests(unittest.TestCase):
    def test_provider_capability_wrappers_preserve_shared_policy_semantics(self) -> None:
        cases = (
            (
                SimpleNamespace(
                    ai_route_profile=" QWEN_PRIMARY ",
                    ai_api_key="qwen-key",
                    ai_model=" Qwen3.7-Plus ",
                    gemini_api_key=None,
                ),
                True,
                True,
            ),
            (
                SimpleNamespace(
                    ai_route_profile="qwen_primary",
                    ai_api_key=None,
                    ai_model="qwen3.7-plus",
                    gemini_api_key=None,
                ),
                False,
                False,
            ),
            (
                SimpleNamespace(
                    ai_route_profile="gemini_primary",
                    ai_api_key="qwen-key",
                    ai_model="qwen3.7-plus",
                    gemini_api_key="gemini-key",
                ),
                False,
                True,
            ),
            (
                SimpleNamespace(
                    ai_route_profile="qwen_primary",
                    ai_api_key="qwen-key",
                    ai_model="gpt-compatible",
                    gemini_api_key=None,
                ),
                False,
                False,
            ),
        )

        for settings, expected_qwen, expected_stream in cases:
            with self.subTest(settings=settings):
                self.assertEqual(
                    streaming_policy.has_qwen_thinking_provider(settings),
                    expected_qwen,
                )
                self.assertEqual(
                    streaming_policy.has_thinking_stream_provider(settings),
                    expected_stream,
                )
                with patch.object(llm_transport, "settings", settings):
                    self.assertEqual(
                        llm_transport._should_use_qwen_thinking(),
                        expected_qwen,
                    )
                with patch.object(ai_service, "settings", settings):
                    self.assertEqual(
                        ai_service._has_thinking_stream_provider(),
                        expected_stream,
                    )
                with patch.object(jd_analysis_service, "settings", settings):
                    self.assertEqual(
                        jd_analysis_service._has_thinking_stream_provider(),
                        expected_stream,
                    )
                with patch.object(parser_service, "settings", settings):
                    self.assertEqual(
                        parser_service._has_qwen_thinking_provider(),
                        expected_qwen,
                    )
                    self.assertEqual(
                        parser_service._has_thinking_stream_provider(),
                        expected_stream,
                    )

    def test_parser_legacy_qwen_monkeypatch_still_controls_dependent_policy(self) -> None:
        settings = SimpleNamespace(
            ai_model="qwen-patched",
            gemini_model="gemini-fallback",
            gemini_api_key=None,
        )
        with patch.object(parser_service, "settings", settings):
            with patch.object(
                parser_service,
                "_has_qwen_thinking_provider",
                return_value=True,
            ):
                self.assertTrue(parser_service._has_thinking_stream_provider())
                self.assertEqual(
                    parser_service._resolve_thinking_model_name(),
                    "qwen-patched",
                )

    def test_llm_legacy_route_and_model_monkeypatches_still_control_qwen_policy(self) -> None:
        settings = SimpleNamespace(
            ai_api_key="qwen-key",
            ai_model="not-qwen",
        )
        with patch.object(llm_transport, "settings", settings):
            with patch.object(
                llm_transport,
                "_route_profile",
                return_value=streaming_policy.AI_ROUTE_PROFILE_QWEN,
            ):
                with patch.object(llm_transport, "_is_qwen_model", return_value=True):
                    self.assertTrue(llm_transport._should_use_qwen_thinking())

    def test_legacy_qwen_model_helper_reexports_focused_predicate(self) -> None:
        self.assertIs(llm_transport._is_qwen_model, streaming_policy.is_qwen_model)
        self.assertIs(
            llm_transport.AI_ROUTE_PROFILE_QWEN,
            streaming_policy.AI_ROUTE_PROFILE_QWEN,
        )

    def test_focused_leaves_import_without_loading_transport_or_parser_services(self) -> None:
        script = textwrap.dedent(
            """
            import sys

            from app.domain.ai import sse_events, streaming_policy

            assert streaming_policy.is_qwen_model("qwen-demo")
            assert callable(sse_events.iter_sse_json_payloads)
            assert "app.domain.ai.llm_transport" not in sys.modules
            assert "app.domain.ai.ai_service" not in sys.modules
            assert "app.domain.parser.parser_service" not in sys.modules
            assert "app.domain.parser.thinking_transport" not in sys.modules
            assert "httpx" not in sys.modules
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=os.environ.copy(),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


class SharedSSEEventTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_iterators_preserve_multiline_and_done_behavior(self) -> None:
        lines = [
            "event: message",
            'data: {"value":',
            "data: 1}",
            "",
            "data: [DONE]",
            "",
            'data: {"ignored": true}',
            "",
        ]
        expected = [{"value": 1}]

        ai_payloads = await _collect_payloads(
            llm_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
        )
        parser_payloads = await _collect_payloads(
            thinking_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
        )

        self.assertEqual(ai_payloads, expected)
        self.assertEqual(parser_payloads, expected)

    async def test_legacy_iterators_preserve_eof_trailing_payload_behavior(self) -> None:
        lines = ['data: {"value": 2}\r']

        ai_payloads = await _collect_payloads(
            llm_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
        )
        parser_payloads = await _collect_payloads(
            thinking_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
        )

        self.assertEqual(ai_payloads, [{"value": 2}])
        self.assertEqual(parser_payloads, [{"value": 2}])

    async def test_legacy_iterators_keep_context_specific_invalid_payload_logs(self) -> None:
        lines = ["data: not-json", ""]

        with self.assertLogs("app.domain.ai.llm_transport", level="WARNING") as ai_logs:
            ai_payloads = await _collect_payloads(
                llm_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
            )
        with self.assertLogs(
            "app.domain.parser.parser_service",
            level="WARNING",
        ) as parser_logs:
            parser_payloads = await _collect_payloads(
                thinking_transport._iter_sse_json_payloads(_FakeStreamResponse(lines))
            )

        self.assertEqual(ai_payloads, [])
        self.assertEqual(parser_payloads, [])
        self.assertIn("[AI Stream] invalid SSE payload: not-json", ai_logs.output[0])
        self.assertIn(
            "[ResumeParse] invalid Gemini SSE payload: not-json",
            parser_logs.output[0],
        )

    async def test_shared_iterator_preserves_done_at_eof_without_parsing_it(self) -> None:
        response = _FakeStreamResponse(["data: [DONE]"])
        payloads = await _collect_payloads(
            sse_events.iter_sse_json_payloads(
                response,
                logger=llm_transport.logger,
                invalid_payload_message="invalid: %s",
                invalid_trailing_payload_message="invalid trailing: %s",
            )
        )
        self.assertEqual(payloads, [])


if __name__ == "__main__":
    unittest.main()
