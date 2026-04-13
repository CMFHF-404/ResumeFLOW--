import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.domain.ai import ai_service  # noqa: E402
from app import config as config_module  # noqa: E402


class GeminiThinkingConfigTests(unittest.TestCase):
    def test_build_generation_config_uses_default_thinking_when_budget_omitted(self) -> None:
        config = ai_service._build_gemini_generation_config()

        self.assertEqual(config["temperature"], 0.2)
        self.assertEqual(config["responseMimeType"], "application/json")
        self.assertEqual(config["thinkingConfig"], {"includeThoughts": True})

    def test_build_generation_config_disables_thinking_when_budget_is_zero(self) -> None:
        config = ai_service._build_gemini_generation_config(0)

        self.assertEqual(config["temperature"], 0.2)
        self.assertEqual(config["responseMimeType"], "application/json")
        self.assertEqual(
            config["thinkingConfig"],
            {
                "includeThoughts": True,
                "thinkingBudget": 0,
            },
        )

    def test_build_generation_config_adds_budget_fields_when_budget_is_positive(self) -> None:
        config = ai_service._build_gemini_generation_config(1024)

        self.assertEqual(
            config["thinkingConfig"],
            {
                "includeThoughts": True,
                "thinkingBudget": 1024,
            },
        )

    def test_build_generation_config_keeps_dynamic_budget_flag(self) -> None:
        config = ai_service._build_gemini_generation_config(-1)

        self.assertEqual(
            config["thinkingConfig"],
            {
                "includeThoughts": True,
                "thinkingBudget": -1,
            },
        )

    def test_load_settings_reads_thinking_budget_envs(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_AUDIENCE": "https://api.example.com",
                "AI_THINKING_BUDGET_JD_ANALYSIS": "2048",
                "AI_THINKING_BUDGET_POLISH": "256",
                "AI_THINKING_BUDGET_BOSS_GREETING": "0",
            },
            clear=True,
        ):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    settings = config_module.load_settings()
                finally:
                    config_module._settings = None

        self.assertEqual(settings.ai_thinking_budget_jd_analysis, 2048)
        self.assertEqual(settings.ai_thinking_budget_polish, 256)
        self.assertEqual(settings.ai_thinking_budget_boss_greeting, 0)


class AiServiceBudgetRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_analyze_jd_with_thoughts_uses_jd_budget(self) -> None:
        fake_settings = SimpleNamespace(
            gemini_api_key="gemini-key",
            ai_thinking_budget_jd_analysis=2048,
        )
        stream_mock = AsyncMock(return_value={})

        with patch.object(ai_service, "settings", fake_settings):
            with patch.object(ai_service, "_stream_gemini_json_response", stream_mock):
                await ai_service.analyze_jd_with_thoughts("JD text")

        self.assertEqual(stream_mock.await_args.kwargs["budget_tokens"], 2048)
        self.assertEqual(stream_mock.await_args.kwargs["request_label"], "jd_text_analysis")

    async def test_polish_experience_with_thoughts_uses_polish_budget(self) -> None:
        fake_settings = SimpleNamespace(
            gemini_api_key="gemini-key",
            ai_thinking_budget_polish=512,
        )
        stream_mock = AsyncMock(return_value={})

        with patch.object(ai_service, "settings", fake_settings):
            with patch.object(ai_service, "_stream_gemini_json_response", stream_mock):
                await ai_service.polish_experience_with_thoughts({"title": "demo"})

        self.assertEqual(stream_mock.await_args.kwargs["budget_tokens"], 512)
        self.assertEqual(stream_mock.await_args.kwargs["request_label"], "star_polish")

    async def test_boss_greeting_bypasses_thinking_when_budget_is_zero(self) -> None:
        fake_settings = SimpleNamespace(
            gemini_api_key="gemini-key",
            ai_thinking_budget_boss_greeting=0,
        )
        standard_mock = AsyncMock(return_value={"greeting": "hello"})
        stream_mock = AsyncMock()

        with patch.object(ai_service, "settings", fake_settings):
            with patch.object(ai_service, "generate_boss_greeting", standard_mock):
                with patch.object(ai_service, "_stream_gemini_json_response", stream_mock):
                    result = await ai_service.generate_boss_greeting_with_thoughts(
                        "JD text",
                        "summary",
                    )

        self.assertEqual(result, {"greeting": "hello"})
        standard_mock.assert_awaited_once()
        stream_mock.assert_not_called()


class AiServicePolishPromptTests(unittest.TestCase):
    def test_default_mode_with_jd_uses_highlight_prompt_without_rewrite(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="default", jd_text="产品经理 JD")

        self.assertIn("Do not rewrite", prompt)
        self.assertIn("no more than 5", prompt)
        self.assertIn("most JD-relevant existing phrases", prompt)

    def test_default_mode_without_jd_uses_role_based_highlight_fallback(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="default", jd_text=None)

        self.assertIn("infer the likely role focus", prompt)
        self.assertIn("general strengths for that role", prompt)
        self.assertIn("Do not rewrite", prompt)

    def test_shorten_mode_keeps_rewrite_prompt(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="shorten")

        self.assertIn("Rewrite into strong, impact-oriented STAR statements.", prompt)
        self.assertIn("Compress wording aggressively", prompt)
