import json
import os
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, call, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.ai import ai_service  # noqa: E402
from app.domain.ai import assistant_tool_utils  # noqa: E402
from app.domain.ai import jd_analysis_service  # noqa: E402
from app.domain.ai import llm_transport  # noqa: E402
from app.domain.ai import prompts as ai_prompts  # noqa: E402
from app.domain.ai.assistant_action_utils import _normalize_assistant_draft_card  # noqa: E402
from app.domain.ai.response_normalizers import _normalize_jd_analysis_result  # noqa: E402
from app import config as config_module  # noqa: E402


class _FakeJsonResponse:
    def __init__(self, payload, *, headers=None, text=""):
        self._payload = payload
        self.headers = headers or {}
        self.request = None
        self.text = text
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload

    async def aread(self):
        return self.text.encode("utf-8")


class _FakePostClient:
    def __init__(self, response, timeout=None):
        self.response = response
        self.timeout = timeout
        self.posts = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        self.posts.append((args, kwargs))
        return self.response


class _FakeStreamResponse:
    def __init__(self, lines):
        self.headers = {"content-type": "text/event-stream"}
        self._lines = lines
        self.request = None
        self.status_code = 200
        self.text = ""

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return self.text.encode("utf-8")


class _FakeStreamContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeStreamClient:
    def __init__(self, response, timeout=None):
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


class AssistantToolUtilsBoundaryTests(unittest.TestCase):
    def test_ai_service_reexports_assistant_tool_helpers(self) -> None:
        payload = {
            "selected_experiences": [
                {"masterId": "exp-1", "full_text": "完整经历文本"},
            ],
            "selected_resume": {"id": "resume-1"},
            "bank_context": {"skills": ["Python"]},
        }
        executor = assistant_tool_utils._build_assistant_context_tool_executor(payload)
        tools = assistant_tool_utils._build_assistant_context_tools()

        self.assertIs(ai_service._build_assistant_context_tools, assistant_tool_utils._build_assistant_context_tools)
        self.assertIs(
            ai_service._build_assistant_context_tool_executor,
            assistant_tool_utils._build_assistant_context_tool_executor,
        )
        self.assertEqual(tools[0]["function"]["name"], "get_selected_experience_full_text")
        self.assertEqual(
            executor("get_selected_experience_full_text", {"masterId": "exp-1"}),
            {"experience": "完整经历文本"},
        )
        self.assertEqual(executor("get_selected_resume_context", {}), {"selected_resume": {"id": "resume-1"}})
        self.assertEqual(executor("get_bank_context", {}), {"bank_context": {"skills": ["Python"]}})


class AssistantDraftCardNormalizerTests(unittest.TestCase):
    def test_skill_group_draft_without_skills_is_dropped(self) -> None:
        card = {
            "type": "skill_group",
            "status": "draft_ready",
            "summary": "旧技能组草稿",
            "data": {
                "category": "核心技能",
            },
        }

        self.assertIsNone(_normalize_assistant_draft_card(card))

    def test_legacy_education_draft_is_normalized_to_experience(self) -> None:
        card = {
            "type": "education",
            "status": "draft_ready",
            "summary": "教育经历",
            "data": {
                "org": "某大学",
                "title": "计算机科学",
                "startDate": "2022-09",
                "endDate": "2026-06",
                "isCurrent": False,
                "star": {
                    "s": "本科阶段",
                    "t": "课程学习",
                    "a": "数据结构\n操作系统",
                    "r": "完成核心课程",
                },
            },
        }

        normalized = _normalize_assistant_draft_card(card)

        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["type"], "experience")
        self.assertEqual(normalized["data"]["category"], "education")
        self.assertEqual(normalized["data"]["org"], "某大学")
        self.assertEqual(sorted(normalized["data"]["star"].keys()), ["a", "r", "s", "t"])


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

    def test_build_generation_config_omits_json_mime_for_gemini3_to_preserve_thoughts(self) -> None:
        config = ai_service._build_gemini_generation_config(
            1024,
            model="gemini-3-flash-preview",
        )

        self.assertNotIn("responseMimeType", config)
        self.assertEqual(
            config["thinkingConfig"],
            {
                "includeThoughts": True,
                "thinkingBudget": 1024,
            },
        )

    def test_build_generation_config_keeps_json_mime_for_gemini25(self) -> None:
        config = ai_service._build_gemini_generation_config(
            1024,
            model="gemini-2.5-flash",
        )

        self.assertEqual(config["responseMimeType"], "application/json")

    def test_load_settings_reads_thinking_budget_envs(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "AI_RESPONSES_BASE_URL": "https://responses.example.com/compatible-mode/v1",
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
        self.assertEqual(
            settings.ai_responses_base_url,
            "https://responses.example.com/compatible-mode/v1",
        )

    def test_load_settings_defaults_jd_thinking_budget_to_fast_half_budget(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
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

    def test_load_settings_derives_qwen_responses_base_url_from_ai_base_url(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "AI_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
            clear=True,
        ):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    settings = config_module.load_settings()
                finally:
                    config_module._settings = None

        self.assertEqual(
            settings.ai_responses_base_url,
            "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
        )

    def test_load_settings_reads_fast_model_env(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "AI_MODEL": "qwen3.7-plus",
                "AI_FAST_MODEL": "qwen-turbo",
            },
            clear=True,
        ):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    settings = config_module.load_settings()
                finally:
                    config_module._settings = None

        self.assertEqual(settings.ai_model, "qwen3.7-plus")
        self.assertEqual(settings.ai_fast_model, "qwen-turbo")

    def test_load_settings_reads_semantic_dedupe_envs(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "AI_MODEL": "qwen3.7-plus",
                "AI_FAST_MODEL": "qwen-turbo",
                "AI_DEDUPE_ENABLED": "false",
                "AI_DEDUPE_MODEL": "qwen-plus",
                "AI_DEDUPE_MAX_CANDIDATES": "12",
            },
            clear=True,
        ):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    settings = config_module.load_settings()
                finally:
                    config_module._settings = None

        self.assertFalse(settings.ai_dedupe_enabled)
        self.assertEqual(settings.ai_dedupe_model, "qwen-plus")
        self.assertEqual(settings.ai_dedupe_max_candidates, 12)

    def test_load_settings_defaults_semantic_dedupe_model_to_fast_model(self) -> None:
        with patch.dict(
            os.environ,
            {
                "DATABASE_URL": "postgresql://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "AI_MODEL": "qwen3.7-plus",
                "AI_FAST_MODEL": "qwen-turbo",
            },
            clear=True,
        ):
            with patch.object(config_module, "_load_env", return_value=None):
                config_module._settings = None
                try:
                    settings = config_module.load_settings()
                finally:
                    config_module._settings = None

        self.assertTrue(settings.ai_dedupe_enabled)
        self.assertEqual(settings.ai_dedupe_model, "qwen-turbo")
        self.assertEqual(settings.ai_dedupe_max_candidates, 24)


class QwenTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_call_llm_disables_qwen_thinking_for_standard_json_requests(self) -> None:
        response = _FakeJsonResponse(
            {
                "choices": [
                    {"message": {"content": json.dumps({"ok": True})}},
                ],
            }
        )
        fake_client = _FakePostClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
        )
        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._call_llm(
                    [{"role": "user", "content": "返回 JSON"}],
                    json_mode=True,
                )

        self.assertEqual(result, {"ok": True})
        sent_payload = fake_client.posts[0][1]["json"]
        self.assertEqual(sent_payload["model"], "qwen3.7-plus")
        self.assertIs(sent_payload["enable_thinking"], False)

    async def test_call_llm_accepts_model_override_for_standard_json_requests(self) -> None:
        response = _FakeJsonResponse(
            {
                "choices": [
                    {"message": {"content": json.dumps({"ok": True})}},
                ],
            }
        )
        fake_client = _FakePostClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
        )
        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._call_llm(
                    [{"role": "user", "content": "返回 JSON"}],
                    json_mode=True,
                    model="qwen-turbo",
                )

        self.assertEqual(result, {"ok": True})
        sent_payload = fake_client.posts[0][1]["json"]
        self.assertEqual(sent_payload["model"], "qwen-turbo")
        self.assertIs(sent_payload["enable_thinking"], False)

    async def test_qwen_responses_stream_emits_reasoning_summary_and_returns_json(self) -> None:
        thought_event_a = {
            "type": "response.reasoning_summary_text.delta",
            "delta": "正在读取",
        }
        thought_event_b = {
            "type": "response.reasoning_summary_text.delta",
            "delta": "简历结构\n",
        }
        answer_event = {
            "type": "response.output_text.delta",
            "delta": json.dumps({"summary": "ok"}, ensure_ascii=False),
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(thought_event_a, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(thought_event_b, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_responses_base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_gemini_json_response(
                    system_prompt="严格输出 JSON",
                    user_parts=[{"text": "输入内容"}],
                    error_message="生成失败",
                    request_label="qwen_test",
                    budget_tokens=1024,
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, {"summary": "ok"})
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在读取简历结构"}
        )
        sent_payload = fake_client.stream_calls[0][1]["json"]
        sent_url = fake_client.stream_calls[0][0][1]
        self.assertEqual(
            sent_url,
            "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses",
        )
        self.assertEqual(sent_payload["model"], "qwen3.7-plus")
        self.assertIs(sent_payload["stream"], True)
        self.assertIs(sent_payload["enable_thinking"], True)
        self.assertNotIn("thinking_budget", sent_payload)
        self.assertEqual(sent_payload["input"][0]["role"], "system")
        self.assertEqual(sent_payload["input"][1]["role"], "user")

    async def test_qwen_responses_stream_emits_reasoning_item_summary_when_delta_is_missing(self) -> None:
        thought_event = {
            "type": "response.output_item.done",
            "item": {
                "type": "reasoning",
                "summary": [
                    {
                        "type": "summary_text",
                        "text": "正在匹配岗位要求",
                    }
                ],
            },
        }
        answer_event = {
            "type": "response.output_item.done",
            "item": {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps({"summary": "ok"}, ensure_ascii=False),
                    }
                ],
            },
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
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_responses_base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_gemini_json_response(
                    system_prompt="严格输出 JSON",
                    user_parts=[{"text": "输入内容"}],
                    error_message="生成失败",
                    request_label="qwen_response_done_test",
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, {"summary": "ok"})
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在匹配岗位要求"}
        )

    async def test_qwen_responses_stream_filters_junk_and_shortens_verbose_summary(self) -> None:
        junk_event = {
            "type": "response.reasoning_summary_text.delta",
            "delta": ": true\n",
        }
        verbose_event = {
            "type": "response.reasoning_summary_text.delta",
            "delta": "沉淀AI应用工作流，记录提示词与生成结果，具备完整的流程沉淀能力。\n",
        }
        answer_event = {
            "type": "response.output_text.delta",
            "delta": json.dumps({"summary": "ok"}, ensure_ascii=False),
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(junk_event, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(verbose_event, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_responses_base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_gemini_json_response(
                    system_prompt="严格输出 JSON",
                    user_parts=[{"text": "输入内容"}],
                    error_message="生成失败",
                    request_label="qwen_response_junk_summary_test",
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, {"summary": "ok"})
        self.assertEqual(
            thought_callback.await_args_list,
            [
                call({"type": "thought", "summary": "正在沉淀AI应用工作流"}),
            ],
        )

    async def test_qwen_responses_failure_resets_thoughts_and_falls_back_to_chat_completions(self) -> None:
        responses_failure = _FakeStreamResponse([])
        responses_failure.headers = {"content-type": "application/json"}
        chat_thought_event = {
            "choices": [
                {
                    "delta": {
                        "reasoning_content": "**读取简历结构**\n正在识别候选人的经历段落。"
                    }
                }
            ]
        }
        chat_answer_event = {
            "choices": [
                {
                    "delta": {
                        "content": json.dumps({"summary": "ok"}, ensure_ascii=False)
                    }
                }
            ]
        }
        chat_response = _FakeStreamResponse(
            [
                f"data: {json.dumps(chat_thought_event, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(chat_answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        response_client = _FakeStreamClient(response=responses_failure)
        chat_client = _FakeStreamClient(response=chat_response)
        clients = [response_client, chat_client]

        def _client_factory(*, timeout):
            client = clients.pop(0)
            client.timeout = timeout
            return client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_responses_base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                with patch.object(llm_transport.logger, "error"):
                    with patch.object(llm_transport.logger, "warning"):
                        result = await llm_transport._stream_gemini_json_response(
                            system_prompt="严格输出 JSON",
                            user_parts=[{"text": "输入内容"}],
                            error_message="生成失败",
                            request_label="qwen_response_fallback_test",
                            budget_tokens=1024,
                            thought_callback=thought_callback,
                        )

        self.assertEqual(result, {"summary": "ok"})
        self.assertEqual(
            thought_callback.await_args_list,
            [
                call({"type": "thought_reset"}),
                call({"type": "thought", "summary": "读取简历结构"}),
            ],
        )
        self.assertTrue(response_client.stream_calls[0][0][1].endswith("/responses"))
        self.assertTrue(chat_client.stream_calls[0][0][1].endswith("/chat/completions"))
        chat_payload = chat_client.stream_calls[0][1]["json"]
        self.assertEqual(chat_payload["thinking_budget"], 1024)

    async def test_qwen_stream_buffers_fragmented_reasoning_before_emitting_summary(self) -> None:
        thought_event_a = {
            "choices": [
                {"delta": {"reasoning_content": "**读取"}},
            ]
        }
        thought_event_b = {
            "choices": [
                {"delta": {"reasoning_content": "简历结构**\n正在识别经历段落。"}},
            ]
        }
        answer_event = {
            "choices": [
                {
                    "delta": {
                        "content": json.dumps({"summary": "ok"}, ensure_ascii=False)
                    }
                }
            ]
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(thought_event_a, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(thought_event_b, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_qwen_json_response(
                    system_prompt="严格输出 JSON",
                    user_parts=[{"text": "输入内容"}],
                    error_message="生成失败",
                    request_label="qwen_fragmented_test",
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, {"summary": "ok"})
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "读取简历结构"}
        )

    async def test_qwen_stream_emits_latest_reasoning_node_title(self) -> None:
        thought_event_a = {
            "choices": [
                {"delta": {"reasoning_content": "**读取简历结构**\n正在识别经历。"}},
            ]
        }
        thought_event_b = {
            "choices": [
                {"delta": {"reasoning_content": "**匹配岗位要求**\n正在比较 JD。"}},
            ]
        }
        answer_event = {
            "choices": [
                {
                    "delta": {
                        "content": json.dumps({"summary": "ok"}, ensure_ascii=False)
                    }
                }
            ]
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(thought_event_a, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(thought_event_b, ensure_ascii=False)}",
                "",
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )
        thought_callback = AsyncMock()

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_qwen_json_response(
                    system_prompt="严格输出 JSON",
                    user_parts=[{"text": "输入内容"}],
                    error_message="生成失败",
                    request_label="qwen_multi_node_test",
                    thought_callback=thought_callback,
                )

        self.assertEqual(result, {"summary": "ok"})
        self.assertEqual(
            thought_callback.await_args_list,
            [
                call({"type": "thought", "summary": "读取简历结构"}),
                call({"type": "thought", "summary": "匹配岗位要求"}),
            ],
        )

    async def test_qwen_responses_stream_converts_inline_image_parts_to_responses_image_input(self) -> None:
        answer_event = {
            "type": "response.output_text.delta",
            "delta": json.dumps({"score": 88}, ensure_ascii=False),
        }
        response = _FakeStreamResponse(
            [
                f"data: {json.dumps(answer_event, ensure_ascii=False)}",
                "",
                "data: [DONE]",
                "",
            ]
        )
        fake_client = _FakeStreamClient(response=response)

        def _client_factory(*, timeout):
            fake_client.timeout = timeout
            return fake_client

        fake_settings = SimpleNamespace(
            ai_api_key="dashscope-key",
            ai_base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ai_responses_base_url="https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
            ai_model="qwen3.7-plus",
            ai_timeout_seconds=300,
            gemini_api_key=None,
            gemini_base_url="",
            gemini_model="",
        )

        with patch.object(llm_transport, "settings", fake_settings):
            with patch.object(llm_transport.httpx, "AsyncClient", side_effect=_client_factory):
                result = await llm_transport._stream_gemini_json_response(
                    system_prompt="分析图片并输出 JSON",
                    user_parts=[
                        {"inlineData": {"mimeType": "image/png", "data": "abc123"}},
                        {"text": "补充说明"},
                    ],
                    error_message="生成失败",
                    request_label="qwen_image_test",
                    thought_callback=None,
                )

        self.assertEqual(result, {"score": 88})
        user_message = fake_client.stream_calls[0][1]["json"]["input"][1]
        self.assertEqual(user_message["role"], "user")
        self.assertEqual(user_message["content"][0]["type"], "input_image")
        self.assertEqual(
            user_message["content"][0]["image_url"],
            "data:image/png;base64,abc123",
        )
        self.assertEqual(user_message["content"][1], {"type": "input_text", "text": "补充说明"})


class AiServiceBudgetRoutingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        if hasattr(ai_service, "clear_split_experience_text_cache"):
            ai_service.clear_split_experience_text_cache()

    def tearDown(self) -> None:
        if hasattr(ai_service, "clear_split_experience_text_cache"):
            ai_service.clear_split_experience_text_cache()

    async def test_analyze_jd_with_thoughts_uses_jd_budget(self) -> None:
        fake_settings = SimpleNamespace(
            gemini_api_key="gemini-key",
            ai_thinking_budget_jd_analysis=2048,
        )
        stream_mock = AsyncMock(return_value={})

        with patch.object(jd_analysis_service, "settings", fake_settings):
            with patch.object(jd_analysis_service, "_stream_gemini_json_response", stream_mock):
                await jd_analysis_service.analyze_jd_with_thoughts("JD text")

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

    async def test_split_experience_text_uses_split_only_prompt(self) -> None:
        call_mock = AsyncMock(
            return_value={
                "s": "原文 **情境**",
                "t": "原文 [任务](https://example.com)",
                "a": "原文行动",
                "r": 123,
                "extra": "ignored",
            }
        )

        with patch.object(ai_service, "_call_llm", call_mock):
            result = await ai_service.split_experience_text("原文 **情境** [任务](https://example.com)", "work")

        system_prompt = call_mock.await_args.args[0][0]["content"]
        user_payload = json.loads(call_mock.await_args.args[0][1]["content"])
        self.assertIn("split only", system_prompt.lower())
        self.assertIn("Do not rewrite", system_prompt)
        self.assertNotIn(ai_prompts.STAR_GENERAL_REWRITE_NO_JD, system_prompt)
        self.assertEqual(user_payload["raw_text"], "原文 **情境** [任务](https://example.com)")
        self.assertEqual(result, {
            "s": "原文 **情境**",
            "t": "原文 [任务](https://example.com)",
            "a": "原文行动",
            "r": "",
        })

    async def test_split_experience_text_returns_empty_result_without_ai_for_blank_text(self) -> None:
        call_mock = AsyncMock()

        with patch.object(ai_service, "_call_llm", call_mock):
            result = await ai_service.split_experience_text(" \n\t ", "work")

        self.assertEqual(result, {"s": "", "t": "", "a": "", "r": ""})
        call_mock.assert_not_awaited()

    async def test_split_experience_text_removes_standalone_hint_separators(self) -> None:
        call_mock = AsyncMock(
            return_value={
                "s": "针对门店库存管理混乱的业务痛点。\n---",
                "t": "---\n独立负责风控模块从 0 到 1 设计落地。",
                "a": "参与技术评审并梳理多级码关联架构。\n---\n输出中保真原型与 PRD 文档。",
                "r": "成功投入生产，提供核心数据支撑。",
            }
        )

        with patch.object(ai_service, "_call_llm", call_mock):
            result = await ai_service.split_experience_text(
                "针对门店库存管理混乱的业务痛点。\n---\n独立负责风控模块从 0 到 1 设计落地。",
                "work",
            )

        self.assertEqual(result["s"], "针对门店库存管理混乱的业务痛点。")
        self.assertEqual(result["t"], "独立负责风控模块从 0 到 1 设计落地。")
        self.assertEqual(result["a"], "参与技术评审并梳理多级码关联架构。\n输出中保真原型与 PRD 文档。")
        self.assertNotIn("---", "\n".join(result.values()))

    async def test_split_experience_text_compacts_separators_and_blank_lines(self) -> None:
        call_mock = AsyncMock(
            return_value={
                "s": "\n\n针对门店库存管理混乱的业务痛点。\n\n----\n",
                "t": "\n---\n\n独立负责风控模块从 0 到 1 设计落地。\n\n",
                "a": "\n参与技术评审并梳理多级码关联架构。\n\n---\n\n输出中保真原型与 PRD 文档。\n",
                "r": "\n--\n该模块最终按时交付并投入生产。\n\n",
            }
        )

        with patch.object(ai_service, "_call_llm", call_mock):
            result = await ai_service.split_experience_text(
                "针对门店库存管理混乱的业务痛点。\n---\n独立负责风控模块从 0 到 1 设计落地。",
                "work",
            )

        self.assertEqual(result["s"], "针对门店库存管理混乱的业务痛点。")
        self.assertEqual(result["t"], "独立负责风控模块从 0 到 1 设计落地。")
        self.assertEqual(
            result["a"],
            "参与技术评审并梳理多级码关联架构。\n输出中保真原型与 PRD 文档。",
        )
        self.assertEqual(result["r"], "该模块最终按时交付并投入生产。")
        self.assertNotIn("---", "\n".join(result.values()))
        self.assertNotIn("\n\n", "\n".join(result.values()))

    async def test_split_experience_text_reuses_cached_result_for_same_payload(self) -> None:
        call_mock = AsyncMock(
            return_value={
                "s": "情境",
                "t": "任务",
                "a": "行动",
                "r": "结果",
            }
        )

        with patch.object(ai_service, "_call_llm", call_mock):
            first = await ai_service.split_experience_text("原始文本", "project", "原子简历", "独立开发")
            second = await ai_service.split_experience_text("原始文本", "project", "原子简历", "独立开发")

        self.assertEqual(first, second)
        call_mock.assert_awaited_once()

    async def test_split_experience_text_cache_is_scoped_by_model(self) -> None:
        call_mock = AsyncMock(
            side_effect=[
                {"s": "模型一", "t": "", "a": "", "r": ""},
                {"s": "模型二", "t": "", "a": "", "r": ""},
            ]
        )

        with patch.object(ai_service, "_call_llm", call_mock):
            with patch.object(ai_service, "settings", SimpleNamespace(ai_model="model-one")):
                first = await ai_service.split_experience_text("原始文本", "work")
            with patch.object(ai_service, "settings", SimpleNamespace(ai_model="model-two")):
                second = await ai_service.split_experience_text("原始文本", "work")

        self.assertEqual(first["s"], "模型一")
        self.assertEqual(second["s"], "模型二")
        self.assertEqual(call_mock.await_count, 2)

    async def test_split_experience_text_coalesces_concurrent_same_payload_requests(self) -> None:
        async def delayed_result(_messages, json_mode=True):
            await asyncio.sleep(0.01)
            return {"s": "情境", "t": "", "a": "行动", "r": ""}

        call_mock = AsyncMock(side_effect=delayed_result)

        with patch.object(ai_service, "_call_llm", call_mock):
            first, second = await asyncio.gather(
                ai_service.split_experience_text("同一段原始文本", "work", "机构", "岗位"),
                ai_service.split_experience_text("同一段原始文本", "work", "机构", "岗位"),
            )

        self.assertEqual(first, second)
        call_mock.assert_awaited_once()

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
    def test_normalize_jd_analysis_result_keeps_capability_analysis(self) -> None:
        result = _normalize_jd_analysis_result(
            {
                "matchPercentage": 78,
                "capability_analysis": {
                    "roleFamily": "AI 产品经理",
                    "overallEvidenceCompleteness": 52,
                    "scoreConfidence": "medium",
                    "scoreWarnings": ["产品证据不足"],
                    "coreCapabilities": [],
                    "experienceDiagnoses": [],
                },
            }
        )

        self.assertIn("capabilityAnalysis", result)
        self.assertNotIn("capability_analysis", result)
        self.assertEqual(result["capabilityAnalysis"]["overallEvidenceCompleteness"], 52)

    def test_default_mode_with_jd_uses_resume_ready_rewrite_prompt(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="default", jd_text="产品经理 JD")

        self.assertIn("Rewrite the provided STAR content into resume-ready statements", prompt)
        self.assertIn("stronger than light highlighting", prompt)
        self.assertIn("no more than 5", prompt)
        self.assertNotIn("ask_before_rewrite", prompt)

    def test_smart_complete_mode_can_ask_for_evidence_before_rewrite(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="smart_complete", jd_text="产品经理 JD")

        self.assertIn("Resume Evidence Coach", prompt)
        self.assertIn("recommendedRewriteMode", prompt)
        self.assertIn("evidenceDiagnosis", prompt)
        self.assertIn("followUpQuestions", prompt)
        self.assertIn("0-3 focused Chinese questions", prompt)
        self.assertIn("current STAR experience only", prompt)
        self.assertIn("Do not ask about other projects", prompt)
        self.assertIn("Do not create questions to fill a quota", prompt)
        self.assertIn("empty followUpQuestions array is valid", prompt)

    def test_smart_complete_result_filters_off_scope_and_padded_questions(self) -> None:
        result = ai_service._normalize_polish_result(
            {
                "recommendedRewriteMode": "ask_before_rewrite",
                "evidenceDiagnosis": "当前经历可继续补充阈值设计。",
                "followUpQuestions": [
                    "简单阈值还是简单的统计模型？",
                    "你是否接触过公司内部的其他AI相关项目？",
                    "在你的专业背景中，是否有过任何涉及模型微调的课程项目或个人练习？",
                    "针对该JD提到的AI产品功能设计，你是否能提供非本项目案例？",
                    "处理溯源数据时，是否有用机器学习进行销量预测或异常检测的构想？",
                    "处理溯源数据时，是否有用机器学习进行销量预测或异常检测的构想？",
                    "你是否定义过输出反馈的验收方式？",
                ],
            },
            mode="smart_complete",
        )

        self.assertEqual(
            result["followUpQuestions"],
            [
                "简单阈值还是简单的统计模型？",
                "处理溯源数据时，是否有用机器学习进行销量预测或异常检测的构想？",
                "你是否定义过输出反馈的验收方式？",
            ],
        )

    def test_jd_analysis_prompt_requires_capability_analysis(self) -> None:
        self.assertIn("core capabilities behind the JD", ai_prompts.JD_ANALYSIS)
        self.assertIn("capabilityAnalysis", ai_prompts.JD_ANALYSIS)
        self.assertIn("resumeEvidenceLevel", ai_prompts.JD_ANALYSIS)

    def test_default_mode_without_jd_rewrites_star_without_bold_highlights(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="default", jd_text=None)

        self.assertIn("convert casual or oral wording into professional resume language", prompt)
        self.assertIn("structure the content clearly across S/T/A/R", prompt)
        self.assertIn("Do not add Markdown bold", prompt)
        self.assertNotIn("Only adjust Markdown bold", prompt)

    def test_shorten_mode_keeps_rewrite_prompt(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="shorten")

        self.assertIn("Rewrite into strong, impact-oriented STAR statements.", prompt)
        self.assertIn("Compress wording aggressively", prompt)

    def test_match_highlight_mode_keeps_conservative_jd_highlight_prompt(self) -> None:
        prompt = ai_service._build_polish_prompt(None, mode="highlight", jd_text="产品经理 JD")

        self.assertIn("Prefer targeted edits", prompt)
        self.assertIn("Highlight caps are strict", prompt)
        self.assertIn("Do not invent", prompt)


class AiServiceAssistantSkillTests(unittest.TestCase):
    def test_get_assistant_prompt_for_mock_interview_does_not_default_to_draft_card(self) -> None:
        prompt = ai_service._get_assistant_prompt("general", skill_id="mock_interview")

        self.assertIn("模拟面试教练", prompt)
        self.assertIn("draftCard must be null", prompt)
        self.assertIn("面试官追问", prompt)

    def test_get_assistant_prompt_for_star_guidance_allows_draft_only_when_ready(self) -> None:
        prompt = ai_service._get_assistant_prompt("general", skill_id="star_guidance")

        self.assertIn("STAR 引导助手", prompt)
        self.assertIn("ask exactly one focused follow-up question", prompt)
        self.assertIn("return a draftCard only when", prompt)

    def test_experience_completion_prompt_matches_smart_complete_constraints(self) -> None:
        prompt = ai_service._get_assistant_prompt("experience", skill_id="experience_completion")

        self.assertIn("Current assistant skill: 智能补全", prompt)
        self.assertIn("selected current STAR experience", prompt)
        self.assertIn("ask 0-3 focused Chinese", prompt)
        self.assertIn("current experience only", prompt)
        self.assertIn("Do not ask about other projects", prompt)
        self.assertIn("Do not create questions to fill a quota", prompt)
        self.assertIn("state that gap instead of asking for unrelated evidence", prompt)

    def test_assistant_result_normalizes_ai_generated_followups(self) -> None:
        result = ai_service._normalize_assistant_result(
            {
                "assistantText": "还需要确认异常识别规则。",
                "title": "智能补全",
                "draftCard": None,
                "suggestedFollowups": [
                    {
                        "label": "补充规则",
                        "prompt": "请继续追问当前经历里的异常识别规则。",
                        "skillId": "experience_completion",
                    },
                    {
                        "label": "其他项目",
                        "prompt": "请补充你在其他项目中的AI产品设计案例。",
                        "skillId": "experience_completion",
                    },
                    {
                        "label": "生成成稿",
                        "prompt": "请根据当前已确认事实生成经历卡片。",
                        "skill_id": "star_guidance",
                    },
                    {
                        "label": "无效",
                        "prompt": "不会保留",
                        "skillId": "unknown",
                    },
                    {
                        "label": "重复",
                        "prompt": "请根据当前已确认事实生成经历卡片。",
                        "skillId": "star_guidance",
                    },
                ],
            },
            skill_id="experience_completion",
        )

        self.assertEqual(
            result["suggestedFollowups"],
            [
                {
                    "label": "补充规则",
                    "prompt": "请继续追问当前经历里的异常识别规则。",
                    "skillId": "experience_completion",
                },
                {
                    "label": "生成成稿",
                    "prompt": "请根据当前已确认事实生成经历卡片。",
                    "skillId": "star_guidance",
                },
            ],
        )

    def test_get_assistant_prompt_does_not_force_card_for_polish_turns(self) -> None:
        prompt = ai_service._get_assistant_prompt("general")

        self.assertIn("Do not return a draftCard merely because facts are sufficient", prompt)
        self.assertIn("For polish, adjustment, critique, interview, or planning turns", prompt)

    def test_assistant_prompts_keep_task_field_method_focused(self) -> None:
        self.assertIn("Task (T) must focus on the concrete challenge and needed approach", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("Do not write dates or time ranges into Task (T)", ai_service.EXPERIENCE_ASSISTANT_PROMPT)

    def test_build_assistant_payload_keeps_selected_experience_full_text_for_tools(self) -> None:
        long_action = "执行动作" * 160

        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我补全经历",
            session_title="AI 助理",
            entry_source="direct",
            context_json={},
            bank_context=None,
            selected_experiences=[
                {
                    "masterId": "master-1",
                    "category": "work",
                    "org": "某公司",
                    "title": "产品经理",
                    "summary": "摘要",
                    "star": {"a": long_action},
                }
            ],
            selected_resume=None,
            history=[],
            skill_id="experience_completion",
        )

        selected = payload["selected_experiences"][0]
        self.assertEqual(payload["skill_id"], "experience_completion")
        self.assertLess(len(selected["star"]["a"]), len(long_action))
        self.assertEqual(selected["full_text"]["star"]["a"], long_action)

    def test_build_assistant_payload_can_omit_full_text_for_gemini_streaming(self) -> None:
        long_action = "执行动作" * 160

        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我补全经历",
            session_title="AI 助理",
            entry_source="direct",
            context_json={},
            bank_context=None,
            selected_experiences=[
                {
                    "masterId": "master-1",
                    "category": "work",
                    "org": "某公司",
                    "title": "产品经理",
                    "summary": "摘要",
                    "star": {"a": long_action},
                }
            ],
            selected_resume=None,
            history=[],
            include_selected_experience_full_text=False,
            preserve_selected_experience_star_text=True,
        )

        selected = payload["selected_experiences"][0]
        self.assertNotIn("full_text", selected)
        self.assertEqual(selected["star"]["a"], long_action)

    def test_build_assistant_payload_keeps_user_message_last(self) -> None:
        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我补全经历",
            session_title="AI 助理",
            entry_source="direct",
            context_json={},
            bank_context={"profile": {}},
            selected_experiences=[
                {
                    "masterId": "master-1",
                    "category": "work",
                    "org": "某公司",
                    "title": "产品经理",
                }
            ],
            selected_resume=None,
            history=[],
        )

        self.assertEqual(list(payload.keys())[-1], "user_message")

    def test_personal_summary_prompt_requires_company_value_evidence(self) -> None:
        self.assertIn("company or role can use", ai_service.PERSONAL_SUMMARY_GENERATION)
        self.assertIn("Do not use unsupported personality praise", ai_service.PERSONAL_SUMMARY_GENERATION)
        self.assertIn("1-2 concrete evidence points", ai_service.PERSONAL_SUMMARY_GENERATION)


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
        self.assertIn("For education cards, map data.org to school", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("Keep course grades or scores on the same line as the course name", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("When category is 'work' or 'project', star.a must be concise action points", ai_service.EXPERIENCE_ASSISTANT_PROMPT)
        self.assertIn("When category is 'education', map org to school", ai_service.EXPERIENCE_ASSISTANT_PROMPT)
        self.assertIn("Keep course grades or scores on the same line as the course name", ai_service.EXPERIENCE_ASSISTANT_PROMPT)

    def test_star_guidance_prompt_allows_education_drafts_without_work_style_results(self) -> None:
        prompt = ai_service.ASSISTANT_SKILL_PROMPTS["star_guidance"]["prompt"]

        self.assertIn("material covers school, major, degree, GPA or grades, or coursework", prompt)
        self.assertNotIn("cover S/T/A/R with concrete actions and results", prompt)

    def test_education_prompt_requires_empty_result_field(self) -> None:
        self.assertIn("Set data.star.r to an empty string for education cards.", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertIn("Set star.r to an empty string for education cards.", ai_service.EXPERIENCE_ASSISTANT_PROMPT)
        self.assertNotIn("saveable education-specific result text", ai_service.GENERAL_ASSISTANT_PROMPT)
        self.assertNotIn("saveable education-specific result text", ai_service.EXPERIENCE_ASSISTANT_PROMPT)

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

    def test_normalize_assistant_result_drops_mock_interview_draft_card(self) -> None:
        result = ai_service._normalize_assistant_result(
            {
                "assistantText": "这里是模拟面试追问。",
                "title": "模拟面试",
                "draftCard": {
                    "type": "experience",
                    "status": "draft_ready",
                    "summary": "不应返回",
                    "data": {"category": "project", "star": {"a": "行动"}},
                },
            },
            skill_id="mock_interview",
        )

        self.assertEqual(result["assistantText"], "这里是模拟面试追问。")
        self.assertIsNone(result["draftCard"])

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

    def test_normalize_assistant_result_keeps_education_course_grade_text(self) -> None:
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
                        "startDate": "2022-09",
                        "endDate": "2026-06",
                        "isCurrent": False,
                        "star": {
                            "s": "本科",
                            "t": "GPA 3.8",
                            "a": "测试课程（90）\n另一门课（A）",
                            "r": "",
                        },
                    },
                },
            }
        )

        self.assertEqual(result["draftCard"]["data"]["star"]["a"], "测试课程（90）\n另一门课（A）")


class AiServiceAssistantStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_assistant_turn_with_thoughts_emits_initial_thought_before_streaming(self) -> None:
        long_action = "执行动作" * 160
        fake_settings = SimpleNamespace(
            gemini_api_key="gemini-key",
            ai_thinking_budget_polish=1024,
        )
        stream_mock = AsyncMock(
            return_value={
                "assistantText": "已整理好。",
                "draftCard": None,
                "title": "AI 助理",
            }
        )
        thought_callback = AsyncMock()

        with patch.object(ai_service, "settings", fake_settings):
            with patch.object(ai_service, "_stream_gemini_json_response", stream_mock):
                result = await ai_service.run_assistant_turn_with_thoughts(
                    mode="general",
                    user_message="帮我补全经历",
                    session_title="AI 助理",
                    entry_source="direct",
                    context_json={},
                    bank_context=None,
                    selected_experiences=[
                        {
                            "masterId": "master-1",
                            "category": "work",
                            "org": "某公司",
                            "title": "产品经理",
                            "star": {"a": long_action},
                        }
                    ],
                    selected_resume=None,
                    history=[],
                    attachments=None,
                    thought_callback=thought_callback,
                )

        self.assertEqual(result["assistantText"], "已整理好。")
        thought_callback.assert_awaited_once_with(
            {"type": "thought", "summary": "正在分析上下文并组织回复"}
        )
        stream_mock.assert_awaited_once()
        payload = json.loads(stream_mock.await_args.kwargs["user_parts"][-1]["text"])
        selected = payload["selected_experiences"][0]
        self.assertNotIn("full_text", selected)
        self.assertEqual(selected["star"]["a"], long_action)
