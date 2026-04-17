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


class AiServiceAssistantNormalizationTests(unittest.TestCase):
    def test_normalize_assistant_result_strips_action_numbering_from_draft_card(self) -> None:
        result = ai_service._normalize_assistant_result(
            {
                "assistantText": " 已整理好项目经历草稿 ",
                "title": " 项目经历 ",
                "draftCard": {
                    "type": "experience",
                    "status": "draft_ready",
                    "summary": "原子简历/独立开发者",
                    "data": {
                        "category": "project",
                        "org": "原子简历",
                        "title": "独立开发者",
                        "startDate": "2026-02-01",
                        "endDate": "",
                        "isCurrent": True,
                        "star": {
                            "s": "场景",
                            "t": "任务",
                            "a": "1. **AI内核与润色算法升级**：上线 V1.2 版本。 2. 视觉与交互重构：优化登录链路。 3. 数据驱动迭代：缓解登录拦截痛点。",
                            "r": "结果",
                        },
                    },
                },
            }
        )

        self.assertEqual(result["assistantText"], "已整理好项目经历草稿")
        self.assertEqual(result["title"], "项目经历")
        self.assertEqual(
            result["draftCard"]["data"]["star"]["a"],
            "**AI内核与润色算法升级**：上线 V1.2 版本。\n视觉与交互重构：优化登录链路。\n数据驱动迭代：缓解登录拦截痛点。",
        )

    def test_assistant_prompts_require_action_lines_without_prefixes(self) -> None:
        self.assertIn("For work or project experience cards, data.star.a must contain concise action points", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("For education cards, use data.star.a for courses or core coursework text", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("When category is 'work' or 'project', star.a must be concise action points", ai_service.EXPERIENCE_ASSISTANT_PROMPT)
        self.assertIn("When category is 'education', use star.a for courses or core coursework text", ai_service.EXPERIENCE_ASSISTANT_PROMPT)

    def test_normalize_assistant_result_keeps_date_prefixed_action_text(self) -> None:
        result = ai_service._normalize_assistant_result(
            {
                "assistantText": "已整理",
                "draftCard": {
                    "type": "experience",
                    "status": "draft_ready",
                    "summary": "项目经历",
                    "data": {
                        "category": "project",
                        "org": "原子简历",
                        "title": "独立开发者",
                        "startDate": "2026-02-01",
                        "endDate": "",
                        "isCurrent": True,
                        "star": {
                            "s": "场景",
                            "t": "任务",
                            "a": "2024.05 完成灰度发布",
                            "r": "结果",
                        },
                    },
                },
            }
        )

        self.assertEqual(result["draftCard"]["data"]["star"]["a"], "2024.05 完成灰度发布")

    def test_normalize_assistant_result_keeps_education_courses_text(self) -> None:
        result = ai_service._normalize_assistant_result(
            {
                "assistantText": "已整理",
                "draftCard": {
                    "type": "experience",
                    "status": "draft_ready",
                    "summary": "教育经历",
                    "data": {
                        "category": "education",
                        "org": "某大学",
                        "title": "计算机科学",
                        "startDate": "2022-09-01",
                        "endDate": "2026-06-01",
                        "isCurrent": False,
                        "star": {
                            "s": "本科",
                            "t": "GPA 3.8",
                            "a": "高等数学\n数据结构",
                            "r": "",
                        },
                    },
                },
            }
        )

        self.assertEqual(result["draftCard"]["data"]["star"]["a"], "高等数学\n数据结构")
