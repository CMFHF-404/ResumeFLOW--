import os
import unittest
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import json


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402

from app.models import ExperienceCategory, ExperienceVersion, MasterExperience, Skill, UserSkill  # noqa: E402
from app.domain.ai import ai_service, llm_transport  # noqa: E402
from app.domain.assistant import assistant_router, assistant_service  # noqa: E402


REPO_ROOT = Path(__file__).resolve().parents[1]


class _ScalarResult:
    def __init__(self, *, one_or_none=None, first=None):
        self._one_or_none = one_or_none
        self._first = first

    def one_or_none(self):
        return self._one_or_none

    def first(self):
        return self._first


class _ExecuteResult:
    def __init__(self, *, one_or_none=None, first=None, all_items=None):
        self._scalars = _ScalarResult(one_or_none=one_or_none, first=first)
        self._all_items = all_items if all_items is not None else []

    def scalars(self):
        return self._scalars

    def all(self):
        return self._all_items


class _FakeAsyncSession:
    def __init__(self, execute_results):
        self.execute = AsyncMock(side_effect=execute_results)
        self.added = []
        self.flush = AsyncMock()
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, value):
        self.added.append(value)


class AssistantStreamQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_rejects_exhausted_quota_before_streaming_response(self) -> None:
        session = object()
        current_user = SimpleNamespace(id="user-1")
        quota_error = HTTPException(
            status_code=402,
            detail={"code": "ai_token_quota_exhausted", "message": "quota exhausted"},
        )

        with patch.object(
            assistant_router,
            "_parse_stream_payload",
            AsyncMock(return_value=(SimpleNamespace(), [])),
        ):
            with patch.object(
                assistant_router.billing_service,
                "ensure_quota_available",
                AsyncMock(side_effect=quota_error),
            ) as mocked_quota_check:
                with self.assertRaises(HTTPException) as raised:
                    await assistant_router.stream_assistant_session_turn(
                        uuid.uuid4(),
                        request=object(),
                        session=session,
                        current_user=current_user,
                    )

        self.assertEqual(raised.exception.status_code, 402)
        mocked_quota_check.assert_awaited_once_with(session, "user-1")


class _AsyncBillingContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def _collect_streaming_response_lines(response) -> list[dict]:
    events: list[dict] = []
    async for chunk in response.body_iterator:
        text = chunk.decode("utf-8") if isinstance(chunk, bytes) else str(chunk)
        for line in text.splitlines():
            if line.strip():
                events.append(json.loads(line))
    return events


class AssistantStreamThinkingModeTests(unittest.IsolatedAsyncioTestCase):
    async def _run_stream_with_payload(
        self,
        payload,
        *,
        standard_side_effect=None,
        thinking_side_effect=None,
    ):
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            mode="general",
            title="AI 助理",
            entry_source="direct",
            context_json={},
        )
        session = object()
        current_user = SimpleNamespace(id="user-1")
        if standard_side_effect:
            standard_turn = AsyncMock(side_effect=standard_side_effect)
        else:
            standard_turn = AsyncMock(return_value={
                "assistantText": "标准回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            })
        if thinking_side_effect:
            thinking_turn = AsyncMock(side_effect=thinking_side_effect)
        else:
            thinking_turn = AsyncMock(return_value={
                "assistantText": "深度回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            })
        persist_turn = AsyncMock()
        self.last_persist_assistant_turn = persist_turn

        with patch.object(
            assistant_router,
            "_parse_stream_payload",
            AsyncMock(return_value=(payload, [])),
        ), patch.object(
            assistant_router.billing_service,
            "ensure_quota_available",
            AsyncMock(),
        ), patch.object(
            assistant_router.billing_service,
            "ai_billing_context",
            return_value=_AsyncBillingContext(),
        ), patch.object(
            assistant_router,
            "get_assistant_session",
            AsyncMock(return_value=assistant_session),
        ), patch.object(
            assistant_router,
            "get_session_detail",
            AsyncMock(return_value=(assistant_session, [])),
        ), patch.object(
            assistant_router,
            "_build_bank_context",
            AsyncMock(return_value={}),
        ), patch.object(
            assistant_router,
            "_hydrate_selected_experiences_for_ai",
            AsyncMock(return_value=[]),
        ), patch.object(
            assistant_router,
            "run_assistant_turn",
            standard_turn,
            create=True,
        ), patch.object(
            assistant_router,
            "run_assistant_turn_with_thoughts",
            thinking_turn,
        ), patch.object(
            assistant_router,
            "persist_assistant_turn",
            persist_turn,
        ):
            response = await assistant_router.stream_assistant_session_turn(
                uuid.uuid4(),
                request=object(),
                session=session,
                current_user=current_user,
            )
            events = await _collect_streaming_response_lines(response)
        return standard_turn, thinking_turn, events

    async def test_stream_uses_standard_assistant_turn_by_default(self) -> None:
        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=False,
        )

        standard_turn, thinking_turn, events = await self._run_stream_with_payload(payload)

        standard_turn.assert_awaited_once()
        thinking_turn.assert_not_awaited()
        self.assertEqual(events[-1]["type"], "final")
        self.assertEqual(events[-1]["result"]["assistantText"], "标准回复")

    async def test_standard_stream_emits_assistant_text_delta_before_final(self) -> None:
        async def standard_side_effect(**kwargs):
            await kwargs["assistant_text_callback"]({"type": "assistant_text_reset"})
            await kwargs["assistant_text_callback"]({"type": "assistant_delta", "delta": "标"})
            await kwargs["assistant_text_callback"]({"type": "assistant_delta", "delta": "准回复"})
            return {
                "assistantText": "标准回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=False,
        )

        standard_turn, thinking_turn, events = await self._run_stream_with_payload(
            payload,
            standard_side_effect=standard_side_effect,
        )

        standard_turn.assert_awaited_once()
        thinking_turn.assert_not_awaited()
        event_types = [event["type"] for event in events]
        self.assertLess(event_types.index("assistant_delta"), event_types.index("final"))
        self.assertEqual(
            [event for event in events if event["type"] in {"assistant_text_reset", "assistant_delta"}],
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "标"},
                {"type": "assistant_delta", "delta": "准回复"},
            ],
        )

    async def test_stream_uses_thinking_turn_when_enabled(self) -> None:
        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        standard_turn, thinking_turn, events = await self._run_stream_with_payload(payload)

        standard_turn.assert_not_awaited()
        thinking_turn.assert_awaited_once()
        self.assertEqual(events[-1]["type"], "final")
        self.assertEqual(events[-1]["result"]["assistantText"], "深度回复")

    async def test_stream_emits_assistant_text_delta_before_final(self) -> None:
        async def thinking_side_effect(**kwargs):
            await kwargs["assistant_text_callback"]({"type": "assistant_text_reset"})
            await kwargs["assistant_text_callback"]({"type": "assistant_delta", "delta": "深"})
            await kwargs["assistant_text_callback"]({"type": "assistant_delta", "delta": "度回复"})
            return {
                "assistantText": "深度回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [{"label": "继续", "prompt": "继续优化"}],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        _, _, events = await self._run_stream_with_payload(
            payload,
            thinking_side_effect=thinking_side_effect,
        )

        event_types = [event["type"] for event in events]
        self.assertLess(event_types.index("assistant_delta"), event_types.index("final"))
        self.assertEqual(
            [event for event in events if event["type"] in {"assistant_text_reset", "assistant_delta"}],
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "深"},
                {"type": "assistant_delta", "delta": "度回复"},
            ],
        )
        self.assertEqual(events[-1]["result"]["assistantText"], "深度回复")
        self.assertEqual(
            self.last_persist_assistant_turn.await_args.kwargs["assistant_text"],
            "深度回复",
        )
        self.assertEqual(
            self.last_persist_assistant_turn.await_args.kwargs["suggested_followups"],
            [{"label": "继续", "prompt": "继续优化"}],
        )

    async def test_stream_persists_visible_thinking_summary(self) -> None:
        async def thinking_side_effect(**kwargs):
            await kwargs["thought_callback"]({"type": "thought", "summary": "正在分析上下文"})
            await kwargs["thought_callback"]({"type": "thought", "summary": "匹配经历证据"})
            return {
                "assistantText": "深度回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        await self._run_stream_with_payload(
            payload,
            thinking_side_effect=thinking_side_effect,
        )

        self.assertEqual(
            self.last_persist_assistant_turn.await_args.kwargs["assistant_thinking"],
            "正在分析上下文\n匹配经历证据",
        )

    async def test_stream_discards_thinking_before_reset(self) -> None:
        async def thinking_side_effect(**kwargs):
            await kwargs["thought_callback"]({"type": "thought", "summary": "旧通道摘要"})
            await kwargs["thought_callback"]({"type": "thought_reset"})
            await kwargs["thought_callback"]({"type": "thought", "summary": "切换后摘要"})
            return {
                "assistantText": "深度回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        await self._run_stream_with_payload(
            payload,
            thinking_side_effect=thinking_side_effect,
        )

        self.assertEqual(
            self.last_persist_assistant_turn.await_args.kwargs["assistant_thinking"],
            "切换后摘要",
        )

    async def test_stream_preserves_thought_reset_event(self) -> None:
        async def thinking_side_effect(**kwargs):
            await kwargs["thought_callback"]({"type": "thought", "summary": "旧通道摘要"})
            await kwargs["thought_callback"]({"type": "thought_reset"})
            await kwargs["thought_callback"]({"type": "thought", "summary": "切换后摘要"})
            return {
                "assistantText": "深度回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        _, _, events = await self._run_stream_with_payload(
            payload,
            thinking_side_effect=thinking_side_effect,
        )

        self.assertIn({"type": "thought_reset"}, events)

    async def test_stream_does_not_persist_thought_status_as_model_thinking(self) -> None:
        async def thinking_side_effect(**kwargs):
            await kwargs["thought_callback"]({"type": "thought", "summary": "旧通道摘要"})
            await kwargs["thought_callback"]({"type": "thought_reset"})
            await kwargs["thought_callback"]({
                "type": "thought_status",
                "status": "fallback",
                "summary": "实时思考流不可用，正在切换为标准生成",
            })
            return {
                "assistantText": "标准回复",
                "draftCard": None,
                "title": "AI 助理",
                "suggestedFollowups": [],
            }

        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="优化这段经历",
            enable_thinking=True,
        )

        _, _, events = await self._run_stream_with_payload(
            payload,
            thinking_side_effect=thinking_side_effect,
        )

        self.assertIn(
            {
                "type": "thought_status",
                "status": "fallback",
                "summary": "实时思考流不可用，正在切换为标准生成",
            },
            events,
        )
        self.assertEqual(
            self.last_persist_assistant_turn.await_args.kwargs["assistant_thinking"],
            "",
        )


class AssistantStreamingJsonDeltaTests(unittest.TestCase):
    def test_gemini_text_stream_config_can_disable_thinking_budget(self) -> None:
        config = llm_transport._build_gemini_generation_config(  # type: ignore[attr-defined]
            budget_tokens=0,
            include_thoughts=False,
        )

        self.assertEqual(config["temperature"], 0.2)
        self.assertEqual(config["thinkingConfig"], {"thinkingBudget": 0})
        self.assertNotIn("includeThoughts", config["thinkingConfig"])

    def test_assistant_text_delta_tracker_decodes_partial_escaped_json_only(self) -> None:
        emitted: list[dict] = []
        tracker = llm_transport._AssistantTextDeltaTracker(emitted.append)  # type: ignore[attr-defined]

        tracker.update('{"assistantText":"你好\\n')
        tracker.update('世界\\u0021","draftCard":{"summary":"不要泄露"},"suggestedFollowups":[]}')

        self.assertEqual(
            emitted,
            [
                {"type": "assistant_text_reset"},
                {"type": "assistant_delta", "delta": "你好\n"},
                {"type": "assistant_delta", "delta": "世界!"},
            ],
        )
        self.assertNotIn(
            "draftCard",
            "".join(event.get("delta", "") for event in emitted),
        )


class AssistantDraftLinkPreservationTests(unittest.TestCase):
    def test_preserves_missing_markdown_links_in_same_star_field(self) -> None:
        from app.domain.ai.assistant_link_preservation import preserve_draft_card_star_links

        draft_card = {
            "type": "experience",
            "status": "draft_ready",
            "data": {
                "category": "project",
                "star": {
                    "s": "背景",
                    "t": "目标",
                    "a": "执行",
                    "r": "将单份简历的组装效率提升 95% 以上。（项目链接）",
                },
            },
        }

        preserved = preserve_draft_card_star_links(
            draft_card,
            [{"r": "将单份简历的组装效率提升 95% 以上。（[项目链接](https://example.com/project)）"}],
        )

        self.assertIn("[项目链接](https://example.com/project)", preserved["data"]["star"]["r"])

    def test_preserves_markdown_links_with_parentheses_in_href(self) -> None:
        from app.domain.ai.assistant_link_preservation import preserve_draft_card_star_links

        draft_card = {
            "type": "experience",
            "status": "draft_ready",
            "data": {
                "category": "project",
                "star": {
                    "s": "",
                    "t": "",
                    "a": "",
                    "r": "参考项目链接完成交付。",
                },
            },
        }

        preserved = preserve_draft_card_star_links(
            draft_card,
            [{"r": "参考[项目链接](https://example.com/report(v2).pdf)完成交付。"}],
        )

        self.assertIn(
            "[项目链接](https://example.com/report(v2).pdf)",
            preserved["data"]["star"]["r"],
        )

    def test_appends_source_link_when_anchor_is_already_linked_with_different_href(self) -> None:
        from app.domain.ai.assistant_link_preservation import preserve_draft_card_star_links

        draft_card = {
            "type": "experience",
            "status": "draft_ready",
            "data": {
                "category": "project",
                "star": {
                    "s": "",
                    "t": "",
                    "a": "",
                    "r": "查看[项目链接](https://new.example)",
                },
            },
        }

        preserved = preserve_draft_card_star_links(
            draft_card,
            [{"r": "[项目链接](https://old.example)"}],
        )

        self.assertIn("[项目链接](https://new.example)", preserved["data"]["star"]["r"])
        self.assertIn("[项目链接](https://old.example)", preserved["data"]["star"]["r"])
        self.assertNotIn("[[项目链接]", preserved["data"]["star"]["r"])

    def test_appends_source_link_when_existing_href_only_shares_prefix(self) -> None:
        from app.domain.ai.assistant_link_preservation import preserve_draft_card_star_links

        draft_card = {
            "type": "experience",
            "status": "draft_ready",
            "data": {
                "category": "project",
                "star": {
                    "s": "",
                    "t": "",
                    "a": "",
                    "r": "查看[项目链接](https://example.com/project-extra)",
                },
            },
        }

        preserved = preserve_draft_card_star_links(
            draft_card,
            [{"r": "[项目链接](https://example.com/project)"}],
        )

        self.assertIn("[项目链接](https://example.com/project-extra)", preserved["data"]["star"]["r"])
        self.assertIn("[项目链接](https://example.com/project)", preserved["data"]["star"]["r"])

    def test_preserves_missing_html_links_in_same_star_field(self) -> None:
        from app.domain.ai.assistant_link_preservation import preserve_draft_card_star_links

        draft_card = {
            "type": "experience",
            "status": "draft_ready",
            "data": {
                "category": "work",
                "star": {
                    "s": "参考案例完成竞品分析",
                    "t": "",
                    "a": "",
                    "r": "",
                },
            },
        }

        preserved = preserve_draft_card_star_links(
            draft_card,
            [{"s": '参考 <a href="https://example.com/case">案例</a> 完成竞品分析'}],
        )

        self.assertIn('href="https://example.com/case"', preserved["data"]["star"]["s"])


class AssistantFrontendSourceTests(unittest.TestCase):
    def test_editor_sidebar_ai_polish_card_can_collapse_to_match_and_suggestion(self) -> None:
        source = (REPO_ROOT / "views" / "ResumeEditor" / "components" / "EditorSidebar.tsx").read_text(encoding="utf-8")
        start = source.index("const EditingSuggestionNav")
        end = source.index("const EditorSidebar", start)
        block = source[start:end]

        self.assertIn("isPolishCardCollapsed", block)
        self.assertIn("setIsPolishCardCollapsed", block)
        self.assertIn("aria-label={isPolishCardCollapsed ? '展开 AI 润色工具栏' : '折叠 AI 润色工具栏'}", block)
        self.assertIn("title={isPolishCardCollapsed ? '展开 AI 润色工具栏' : '折叠 AI 润色工具栏'}", block)
        self.assertIn("transition-[grid-template-rows,opacity]", block)
        self.assertIn("isPolishCardCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'", block)
        self.assertIn("aria-hidden={isPolishCardCollapsed}", block)
        self.assertIn("!isPolishCardCollapsed && toolbar ? <div className=\"mt-3\">{toolbar}</div> : null", block)
        self.assertIn("isPolishCardCollapsed ? '-rotate-90' : 'rotate-0'", block)
        self.assertIn("isPolishCardCollapsed ? 'flex items-start gap-3'", block)
        self.assertIn("折叠后仅显示匹配度与润色建议", block)

    def test_resume_editor_auto_analyzes_jd_after_confirming_polish(self) -> None:
        source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        coordinator_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorExperiencePolishCoordinator.ts"
        ).read_text(encoding="utf-8")
        confirm_actions_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useFloatingExperiencePolishConfirmActions.ts"
        ).read_text(encoding="utf-8")
        jd_analyze_hook_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useJdAnalyzeWithToast.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("pendingPolishAutoAnalyzeSeq", source)
        self.assertIn("lastPolishAutoAnalyzeSeqRef", jd_analyze_hook_source)
        self.assertIn("useResumeEditorExperiencePolishCoordinator({", source)
        self.assertIn("setPendingPolishAutoAnalyzeSeq", coordinator_source)
        self.assertIn("setPendingPolishAutoAnalyzeSeq((current) => current + 1)", confirm_actions_source)
        self.assertIn("if (pendingPolishAutoAnalyzeSeq <= 0)", jd_analyze_hook_source)
        self.assertIn("lastPolishAutoAnalyzeSeqRef.current === pendingPolishAutoAnalyzeSeq", jd_analyze_hook_source)
        self.assertIn("lastPolishAutoAnalyzeSeqRef.current = pendingPolishAutoAnalyzeSeq", jd_analyze_hook_source)
        self.assertIn("void runJdAnalyzeWithToast()", jd_analyze_hook_source)

        single_start = confirm_actions_source.index("const handleConfirmFloatingExperiencePolish")
        single_end = confirm_actions_source.index("const handleConfirmBatchExperiencePolish", single_start)
        single_block = confirm_actions_source[single_start:single_end]
        self.assertIn("setPendingPolishAutoAnalyzeSeq((current) => current + 1)", single_block)

        batch_start = confirm_actions_source.index("const handleConfirmBatchExperiencePolish")
        batch_end = confirm_actions_source.index("return {", batch_start)
        batch_block = confirm_actions_source[batch_start:batch_end]
        self.assertIn("setPendingPolishAutoAnalyzeSeq((current) => current + 1)", batch_block)

    def test_personal_summary_panel_collapses_when_empty(self) -> None:
        source = (REPO_ROOT / "views" / "ResumeEditor" / "components" / "PersonalSummaryPanel.tsx").read_text(encoding="utf-8")

        self.assertIn("useState(() => !stripRichTextToText(value).trim())", source)
        self.assertIn("previousHasValueRef", source)
        self.assertIn("if (!hasValue && previousHasValueRef.current)", source)
        self.assertIn("setIsCollapsed(true)", source)
        self.assertIn("if (hasValue && !previousHasValueRef.current)", source)
        self.assertIn("setIsCollapsed(false)", source)

    def test_ai_polish_toolbar_no_jd_default_copy_separates_rewrite_from_highlight(self) -> None:
        toolbar_source = (REPO_ROOT / "components" / "AIPolishToolbar.tsx").read_text(encoding="utf-8")

        self.assertIn("default: '结构化 STAR 并转为专业书面语。'", toolbar_source)
        self.assertIn("highlight: '保留原文，仅调整重点内容的强调。'", toolbar_source)

    def test_ai_polish_toolbar_jd_default_copy_mentions_four_char_action_opening(self) -> None:
        toolbar_source = (REPO_ROOT / "components" / "AIPolishToolbar.tsx").read_text(encoding="utf-8")

        self.assertIn("default: '四字行动开头，结合 JD 重组表达。'", toolbar_source)

    def test_resume_editor_exposes_campus_recruitment_polish_mode(self) -> None:
        toolbar_source = (REPO_ROOT / "components" / "AIPolishToolbar.tsx").read_text(encoding="utf-8")
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")

        self.assertIn("campus_recruitment: '校招润色'", toolbar_source)
        self.assertIn("campus_recruitment: '校招口径 + 重点加粗，真实克制地重写经历。'", toolbar_source)
        self.assertIn("'default',\n    'campus_recruitment',\n    'highlight',\n    'custom'", editor_source)

    def test_ai_polish_toolbar_result_preview_body_is_mobile_only(self) -> None:
        toolbar_source = (REPO_ROOT / "components" / "AIPolishToolbar.tsx").read_text(encoding="utf-8")
        preview_start = toolbar_source.index("if (isPreviewing)")
        preview_end = toolbar_source.index("  return (\n    <div", preview_start)
        preview_block = toolbar_source[preview_start:preview_end]

        self.assertIn('className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:hidden"', preview_block)
        self.assertIn("md:max-h-none", preview_block)
        self.assertNotIn("md:h-full md:min-h-0 md:max-h-full", preview_block)

    def test_experience_bank_polish_toolbar_hides_match_highlight_mode(self) -> None:
        source = (REPO_ROOT / "views" / "ExperienceCard.tsx").read_text(encoding="utf-8")

        self.assertIn("const EXPERIENCE_BANK_POLISH_MODES", source)
        self.assertIn("['default', 'custom']", source)
        self.assertIn("modeOptions={EXPERIENCE_BANK_POLISH_MODES}", source)

    def test_ai_polish_toolbar_merges_smart_complete_into_assistant_launch(self) -> None:
        toolbar_source = (REPO_ROOT / "components" / "AIPolishToolbar.tsx").read_text(encoding="utf-8")
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        assistant_launch_bootstrap_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantLaunchBootstrap.ts"
        ).read_text(encoding="utf-8")
        assistant_types_source = (REPO_ROOT / "views" / "AIAssistant" / "types.ts").read_text(encoding="utf-8")
        helper_source = (REPO_ROOT / "utils" / "assistantSmartCompletePrompt.ts").read_text(encoding="utf-8")
        smart_completion_source = (
            REPO_ROOT / "views" / "ResumeEditor" / "smartCompletionUtils.ts"
        ).read_text(encoding="utf-8")
        floating_preview_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "components"
            / "FloatingPolishPreviewContent.tsx"
        ).read_text(encoding="utf-8")
        resume_assistant_launch_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorAssistantLaunch.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("const DEFAULT_MODE_OPTIONS: ToolbarMode[] = ['default', 'highlight', 'custom'];", toolbar_source)
        self.assertIn("智能补全", toolbar_source)
        self.assertNotIn("高级模式", toolbar_source)

        smart_start = editor_source.index("const SMART_RESUME_POLISH_MODES")
        smart_end = editor_source.index("const BATCH_RESUME_POLISH_MODES", smart_start)
        smart_block = editor_source[smart_start:smart_end]
        self.assertNotIn("'smart_complete'", smart_block)
        self.assertNotIn("'shorten'", smart_block)
        self.assertNotIn("'expand'", smart_block)

        batch_start = editor_source.index("const BATCH_RESUME_POLISH_MODES")
        batch_end = editor_source.index("const ResumeEditor", batch_start)
        batch_block = editor_source[batch_start:batch_end]
        self.assertNotIn("'shorten'", batch_block)
        self.assertNotIn("'expand'", batch_block)
        self.assertIn("const FLOATING_POLISH_PREVIEW_FIELDS", floating_preview_source)

        self.assertIn("initialSkillId: 'experience_completion'", resume_assistant_launch_source)
        self.assertIn("buildSmartCompleteAssistantPrompt", resume_assistant_launch_source)
        self.assertIn("initialSkillId?: AssistantSkillId | null", assistant_types_source)
        self.assertIn("skillId: pendingLaunchRequest.initialSkillId ?? null", assistant_launch_bootstrap_source)
        self.assertIn("只围绕当前这段经历内真实、可能可补充的事实追问 0-3 个问题", helper_source)
        self.assertIn("不要询问其他项目、课程项目、个人练习、专业背景或非本项目案例", helper_source)
        self.assertIn(".slice(0, 3)", smart_completion_source)

    def test_experience_bank_card_assistant_launch_uses_server_apply(self) -> None:
        source = (REPO_ROOT / "views" / "ExperienceSection" / "polishActions.ts").read_text(encoding="utf-8")
        start = source.index("const handleOpenAssistant")
        end = source.index("  const isPolishing", start)
        block = source[start:end]

        self.assertIn("entrySource: 'experience_bank'", block)
        self.assertNotIn("applyDraftHandler:", block)
        self.assertNotIn("registerPendingAssistantApply(cardId, meta)", block)
        self.assertNotIn("callbackOnly: true", block)

    def test_experience_bank_temp_card_assistant_requires_save_first(self) -> None:
        source = (REPO_ROOT / "views" / "ExperienceSection" / "polishActions.ts").read_text(encoding="utf-8")
        start = source.index("const handleOpenAssistant")
        end = source.index("  const isPolishing", start)
        block = source[start:end]

        self.assertIn("if (isTempId(cardId))", block)
        self.assertIn("toast.error('请先保存这段经历，再使用 AI 助手'", block)
        self.assertNotIn("initialSkillId: 'experience_completion'", block)
        self.assertNotIn("buildSmartCompleteAssistantPrompt", block)
        self.assertIn("return;", block)
        self.assertIn("[category, onLaunchAssistant, toast]", block)

    def test_ai_assistant_allows_experience_bank_custom_apply_handler(self) -> None:
        source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        draft_apply_actions_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantDraftApplyActions.ts"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "const applyHandler = applyHandlerMapRef.current.get(selectedSession.id);",
            draft_apply_actions_source,
        )
        self.assertNotIn(
            "selectedSession.entry_source === 'experience_bank'\n      ? undefined",
            source,
        )

    def test_ai_assistant_normalizes_latest_preview_before_draft_comparison(self) -> None:
        source = (REPO_ROOT / "views" / "AIAssistant" / "sessionUtils.ts").read_text(encoding="utf-8")
        start = source.index("const isSameDraftCard")
        end = source.index("const resolveDraftGroupId", start)
        block = source[start:end]

        self.assertIn("normalizeAssistantDraftCard(preview", block)
        self.assertNotIn("JSON.stringify(preview.data ?? null) === JSON.stringify(card.data)", block)

    def test_ai_assistant_uses_ai_generated_followup_buttons(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        selection_source = (REPO_ROOT / "views" / "AIAssistant" / "selectionUtils.ts").read_text(encoding="utf-8")
        message_derivation_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "messageDerivationUtils.ts"
        ).read_text(encoding="utf-8")
        message_sending_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantMessageSending.ts"
        ).read_text(encoding="utf-8")
        message_send_source = (REPO_ROOT / "views" / "AIAssistant" / "messageSendUtils.ts").read_text(encoding="utf-8")
        service_source = (REPO_ROOT / "services" / "aiService.ts").read_text(encoding="utf-8")
        prompt_source = (REPO_ROOT / "backend" / "app" / "domain" / "ai" / "prompts.py").read_text(encoding="utf-8")
        assistant_service_source = (REPO_ROOT / "backend" / "app" / "domain" / "assistant" / "assistant_service.py").read_text(encoding="utf-8")

        self.assertNotIn("ASSISTANT_SKILL_FOLLOWUPS", assistant_source)
        self.assertIn("normalizeAssistantSuggestedFollowups", message_derivation_source)
        self.assertIn("latestSuggestedFollowups", assistant_source)
        self.assertIn("message.content_json?.suggestedFollowups", message_derivation_source)
        self.assertIn("buildFallbackSuggestedFollowups", message_derivation_source)
        self.assertIn("回答这个问题", selection_source)
        self.assertIn("result.suggestedFollowups", message_sending_source)
        self.assertIn("...(skillId ? { skill_id: skillId } : {})", message_send_source)
        self.assertIn("export interface AssistantSuggestedFollowup", service_source)
        self.assertIn("'suggestedFollowups' (array of 0-3 objects", prompt_source)
        self.assertIn("Suggested follow-up buttons must be generated", prompt_source)
        self.assertIn('"skill_id": user_skill_id', assistant_service_source)
        self.assertIn('"suggestedFollowups": suggested_followups', assistant_service_source)

    def test_ai_assistant_surfaces_stream_error_message_to_user(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        attachment_hook_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantComposerAttachments.ts"
        ).read_text(encoding="utf-8")
        message_sending_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantMessageSending.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("MAX_ASSISTANT_ATTACHMENT_BYTES = 5 * 1024 * 1024", attachment_hook_source)
        self.assertIn("formatAssistantAttachmentTooLargeMessage", attachment_hook_source)
        self.assertIn("return `附件${label}过大，请上传不超过 5MB 的文件。`;", attachment_hook_source)
        self.assertIn("file.size <= MAX_ASSISTANT_ATTACHMENT_BYTES", attachment_hook_source)
        self.assertIn(
            "if (normalizedFiles.length === 0) {\n"
            "      if (attachmentInputRef.current) {\n"
            "        attachmentInputRef.current.value = '';\n"
            "      }\n"
            "      return;\n"
            "    }",
            attachment_hook_source,
        )
        self.assertIn("restoreComposerAttachmentsIfEmpty", assistant_source)
        self.assertIn("const resolveAssistantSendErrorMessage", message_sending_source)
        self.assertIn("error(resolveAssistantSendErrorMessage(sendError)", message_sending_source)

    def test_ai_assistant_draft_panel_stays_presentational(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        draft_panel_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "AssistantDraftPanel.tsx"
        ).read_text(encoding="utf-8")
        draft_panel_state_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantDraftPanelState.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("AssistantMobileDraftTray", assistant_source)
        self.assertIn("AssistantDesktopDraftPanel", assistant_source)
        self.assertIn("useAssistantDraftPanelState", assistant_source)
        self.assertIn("const syncVersionState", draft_panel_state_source)
        self.assertIn("draftCardCount === 1", draft_panel_state_source)
        self.assertIn("onApplyDraft(item)", draft_panel_source)
        self.assertNotIn("aiService", draft_panel_source)
        self.assertNotIn("resumeService", draft_panel_source)
        self.assertNotIn("writePendingAssistantManualSaveDraft", draft_panel_source)

    def test_ai_assistant_history_panel_stays_presentational(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        history_panel_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "AssistantHistoryPanel.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("AssistantHistoryPanel", assistant_source)
        self.assertIn("onSelectDesktopSession={handleSelectSession}", assistant_source)
        self.assertIn("onSelectMobileSession={handleSelectSession}", assistant_source)
        self.assertIn("onRenameSession={(event, session) => void handleRenameSession(event, session)}", assistant_source)
        self.assertIn("onDeleteSession={(event, sessionId) => void handleDeleteSession(event, sessionId)}", assistant_source)
        self.assertIn("AssistantHistorySessionList", history_panel_source)
        self.assertNotIn("aiService", history_panel_source)
        self.assertNotIn("loadSessionDetail", history_panel_source)
        self.assertNotIn("markSessionMutated", history_panel_source)
        self.assertNotIn("markSessionDeleted", history_panel_source)

    def test_ai_assistant_history_actions_are_in_controller_hook(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        history_actions_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantHistoryActions.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantHistoryActions({", assistant_source)
        self.assertIn("handleSelectSession", history_actions_source)
        self.assertIn("setIsMobileHistoryOpen(false)", history_actions_source)
        self.assertIn("clearPendingAssistantManualSaveDraft", history_actions_source)
        self.assertIn("deletedDraftSelectedResume", history_actions_source)
        self.assertIn("draftSelectedResumeBySessionRef.current.set(deleteConfirmId, deletedDraftSelectedResume)", history_actions_source)
        self.assertIn("sortSessionsByUpdatedAt", history_actions_source)
        self.assertIn("mergeAssistantSessions(prev, [deletedSession])", history_actions_source)
        self.assertNotIn("clearPendingAssistantManualSaveDraft", assistant_source)
        self.assertNotIn("const executeDeleteSession = useCallback", assistant_source)
        self.assertNotIn("const handleRenameSession = useCallback", assistant_source)

    def test_ai_assistant_launch_bootstrap_is_in_controller_hook(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        session_controller_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantSessionController.ts"
        ).read_text(encoding="utf-8")
        launch_bootstrap_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantLaunchBootstrap.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantLaunchBootstrap({", assistant_source)
        self.assertIn("resetForDraftLaunch,", assistant_source)
        self.assertIn("suppressAutoSelectSessionRef,", assistant_source)
        self.assertIn("draftLaunchRequestRef.current = launchRequest", session_controller_source)
        self.assertIn("selectedSessionIdRef.current = null", session_controller_source)
        self.assertIn("resetForDraftLaunch(pendingLaunchRequest, normalizedPrefillResume)", launch_bootstrap_source)
        self.assertIn("suppressAutoSelectSessionRef.current = true", launch_bootstrap_source)
        self.assertIn("createSessionRecord(pendingLaunchRequest.context", launch_bootstrap_source)
        self.assertIn("applyHandlerMapRef.current.set(created.id, pendingLaunchRequest.applyDraftHandler)", launch_bootstrap_source)
        self.assertIn("callbackOnlySessionIdsRef.current.add(created.id)", launch_bootstrap_source)
        self.assertIn("await sendMessage(", launch_bootstrap_source)
        self.assertIn("cleanupSupersededSession(created.id)", launch_bootstrap_source)
        self.assertIn("onConsumeLaunchRequest?.(pendingLaunchRequest.requestId)", launch_bootstrap_source)
        self.assertNotIn("draftLaunchRequestRef.current = launchRequest", assistant_source)
        self.assertNotIn("selectedSessionIdRef.current = null", assistant_source)
        self.assertNotIn("const bootstrap = async", assistant_source)
        self.assertNotIn("Failed to bootstrap launch request", assistant_source)

    def test_ai_assistant_resource_pickers_are_in_controller_hook(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        resource_picker_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantResourcePickers.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantResourcePickers({", assistant_source)
        self.assertNotIn("openExperiencePicker", resource_picker_source)
        self.assertNotIn("experienceService.listAll('work')", resource_picker_source)
        self.assertIn("resumeService.list()", resource_picker_source)
        self.assertIn("buildSelectedResumeFromResources", resource_picker_source)
        self.assertIn("draftLaunchRequestRef.current = {", resource_picker_source)
        self.assertIn("prefillResume: nextSelectedResume", resource_picker_source)
        self.assertNotIn("key: 'pick-experience'", assistant_source)
        self.assertNotIn("label: '选择经历'", assistant_source)
        self.assertNotIn("const openExperiencePicker = useCallback", assistant_source)
        self.assertNotIn("const openResumePicker = useCallback", assistant_source)
        self.assertNotIn("const handleConfirmSelectedResume = useCallback", assistant_source)

    def test_ai_assistant_session_loading_is_in_controller_hook(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        session_controller_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantSessionController.ts"
        ).read_text(encoding="utf-8")
        session_loading_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantSessionLoading.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantSessionController({", assistant_source)
        self.assertIn("useAssistantSessionLoading({", session_controller_source)
        self.assertIn("const [sessions, setSessions]", session_controller_source)
        self.assertIn("const [selectedSessionId, setSelectedSessionId]", session_controller_source)
        self.assertIn("const [messages, setMessages]", session_controller_source)
        self.assertIn("const commitCreatedSession = useCallback", session_controller_source)
        self.assertIn("const cleanupSupersededSession = useCallback", session_controller_source)
        self.assertIn("const createSessionRecord = useCallback", session_controller_source)
        self.assertIn("const persistSessionSnapshot = useCallback", session_controller_source)
        self.assertIn("loadSessions", session_loading_source)
        self.assertIn("loadSessionDetail", session_loading_source)
        self.assertIn("detailRequestIdRef", session_loading_source)
        self.assertIn("reconcileAssistantSessions(", session_loading_source)
        self.assertIn("messageMutationSeqRef.current > messageMutationAtStart", session_loading_source)
        self.assertIn("selectedSessionIdRef.current !== sessionId", session_loading_source)
        self.assertNotIn("useAssistantSessionLoading({", assistant_source)
        self.assertNotIn("const loadSessions = useCallback", assistant_source)
        self.assertNotIn("const loadSessionDetail = useCallback", assistant_source)
        self.assertNotIn("const commitCreatedSession = useCallback", assistant_source)
        self.assertNotIn("const cleanupSupersededSession = useCallback", assistant_source)
        self.assertNotIn("const createSessionRecord = useCallback", assistant_source)
        self.assertNotIn("const persistSessionSnapshot = useCallback", assistant_source)

    def test_ai_assistant_send_message_uses_pure_message_builders(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        message_send_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "messageSendUtils.ts"
        ).read_text(encoding="utf-8")
        message_sending_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantMessageSending.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantMessageSending({", assistant_source)
        self.assertIn("prepareAssistantSendPayload(payload)", message_sending_source)
        self.assertIn("buildOptimisticAssistantUserMessage(", message_sending_source)
        self.assertIn("buildAssistantTextMessage(", message_sending_source)
        self.assertIn("aiService.sendAssistantMessage", message_sending_source)
        self.assertIn("restoreComposerAttachmentsIfEmpty", assistant_source)
        self.assertIn("restoreComposerAttachmentsIfEmpty(attachments)", message_sending_source)
        self.assertIn("MULTI_ATTACHMENT_DEFAULT_MESSAGE", message_send_source)
        self.assertIn("SELECTED_RESUME_DEFAULT_MESSAGE", message_send_source)
        self.assertIn("local-assistant-${now}-${randomValue}", message_send_source)
        self.assertIn("selected_experiences", message_send_source)
        self.assertIn("selected_resume", message_send_source)
        self.assertNotIn("const optimisticUserMessage: AssistantMessage = {", assistant_source)
        self.assertNotIn("id: `local-assistant-${new Date().toISOString()}-${Math.random()}`", assistant_source)
        self.assertNotIn("请先阅读我上传的这些附件，并帮我整理其中的关键信息。", assistant_source)
        self.assertNotIn("const sendMessage = useCallback", assistant_source)

    def test_ai_assistant_apply_draft_uses_pure_context_helpers(self) -> None:
        assistant_source = (REPO_ROOT / "views" / "AIAssistant.tsx").read_text(encoding="utf-8")
        draft_apply_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "draftApplyUtils.ts"
        ).read_text(encoding="utf-8")
        message_derivation_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "messageDerivationUtils.ts"
        ).read_text(encoding="utf-8")
        draft_apply_actions_source = (
            REPO_ROOT
            / "views"
            / "AIAssistant"
            / "useAssistantDraftApplyActions.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useAssistantDraftApplyActions({", assistant_source)
        self.assertIn("assertResumeEditorDraftTargetMatches(", draft_apply_actions_source)
        self.assertIn("buildResumeEditorDraftJumpState({", draft_apply_actions_source)
        self.assertIn("if (pendingManualSaveDraft) {\n              writePendingAssistantManualSaveDraft(pendingManualSaveDraft);", draft_apply_actions_source)
        self.assertIn("callbackOnly ? { skipApply: true } : undefined", draft_apply_actions_source)
        self.assertIn("experienceService.clearListCache()", draft_apply_actions_source)
        self.assertIn("setAppliedMessageIds((prev) => new Set(prev).add(messageId))", draft_apply_actions_source)
        self.assertIn("markSessionMutated(selectedSession.id)", draft_apply_actions_source)
        self.assertIn("latest_preview: updatedMessage.content_json", draft_apply_actions_source)
        self.assertIn("next.delete(messageId)", draft_apply_actions_source)
        self.assertIn("readExperienceDraftTargetMasterId", draft_apply_source)
        self.assertIn("buildResumeEditorManualSaveDraft(params)", draft_apply_source)
        self.assertIn("AI 草稿目标经历与当前编辑上下文不一致", draft_apply_source)
        self.assertIn("source: 'resume_editor'", draft_apply_source)
        self.assertIn("deriveLatestSuggestedFollowups", message_derivation_source)
        self.assertIn("deriveDraftMessageItems", message_derivation_source)
        self.assertIn("isResumeEditorManualSaveDraft", message_derivation_source)
        self.assertNotIn("targetMasterId !== contextMasterId", assistant_source)
        self.assertNotIn("source: 'resume_editor',\n                sessionId: selectedSession.id", assistant_source)
        self.assertNotIn("const handleApplyDraft = useCallback", assistant_source)

    def test_resume_editor_assistant_launch_is_in_controller_hook(self) -> None:
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        assistant_launch_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorAssistantLaunch.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useResumeEditorAssistantLaunch({", editor_source)
        self.assertIn("handleOpenExperienceAssistant", assistant_launch_source)
        self.assertIn("handleOpenFloatingExperienceAssistant", assistant_launch_source)
        self.assertIn("handleLaunchResumeAssistant", assistant_launch_source)
        self.assertIn("buildSmartCompleteAssistantPrompt({", assistant_launch_source)
        self.assertIn("contextJson: {", assistant_launch_source)
        self.assertIn("masterId: draft.masterId", assistant_launch_source)
        self.assertIn("jdText: jdPolishContext", assistant_launch_source)
        self.assertIn("initialUserMessage: buildSmartCompleteAssistantPrompt({", assistant_launch_source)
        self.assertEqual(assistant_launch_source.count("callbackOnly: true"), 2)
        self.assertIn("pendingAssistantApplyRef.current.set(draft.masterId, meta.persistApplied)", assistant_launch_source)
        self.assertIn("trackedPendingAssistantApplyRef.current.delete(draft.masterId)", assistant_launch_source)
        self.assertIn("setExperiencePolishPreview(null)", assistant_launch_source)
        self.assertIn("applyFloatingPolishPreview('single', [sessionItem])", assistant_launch_source)
        self.assertIn("prefillResume: {", assistant_launch_source)
        self.assertIn("snapshot: selectedResumeSnapshot", assistant_launch_source)
        self.assertIn("...(jdPolishContext ? { jdContext: jdPolishContext } : {})", assistant_launch_source)
        self.assertIn("applyDraftHandler: handleApplyResumeAssistantDraft", assistant_launch_source)
        self.assertNotIn("const handleOpenExperienceAssistant = useCallback", editor_source)
        self.assertNotIn("const handleOpenFloatingExperienceAssistant = useCallback", editor_source)
        self.assertNotIn("const handleLaunchResumeAssistant = useCallback", editor_source)

    def test_ai_service_transport_is_isolated_from_business_flows(self) -> None:
        ai_service_source = (REPO_ROOT / "backend" / "app" / "domain" / "ai" / "ai_service.py").read_text(encoding="utf-8")
        transport_source = (
            REPO_ROOT
            / "backend"
            / "app"
            / "domain"
            / "ai"
            / "llm_transport.py"
        ).read_text(encoding="utf-8")
        assistant_tool_source = (
            REPO_ROOT
            / "backend"
            / "app"
            / "domain"
            / "ai"
            / "assistant_tool_utils.py"
        ).read_text(encoding="utf-8")

        self.assertIn("from .llm_transport import (", ai_service_source)
        self.assertIn("_call_llm", ai_service_source)
        self.assertIn("from .assistant_tool_utils import (", ai_service_source)
        self.assertNotIn("_post_chat_completion", ai_service_source)
        self.assertIn("_post_chat_completion", assistant_tool_source)
        self.assertIn("async def _call_llm_with_tools", assistant_tool_source)
        self.assertIn("_stream_gemini_json_response", ai_service_source)
        self.assertNotIn("async with httpx.AsyncClient", ai_service_source)
        self.assertNotIn("def _build_headers", ai_service_source)
        self.assertNotIn("def _build_gemini_headers", ai_service_source)
        self.assertNotIn("async def _iter_sse_json_payloads", ai_service_source)
        self.assertIn("def _build_headers", transport_source)
        self.assertIn("def _build_gemini_headers", transport_source)
        self.assertIn("def _build_ai_timeout", transport_source)
        self.assertIn("async def _iter_sse_json_payloads", transport_source)
        self.assertIn("async def _stream_gemini_json_response", transport_source)
        self.assertIn("async def _post_chat_completion", transport_source)
        self.assertIn("async def _call_llm", transport_source)
        self.assertIn("_parse_json_content_candidates(parse_candidates)", transport_source)

    def test_jd_analysis_service_is_isolated_from_ai_service_facade(self) -> None:
        ai_service_source = (REPO_ROOT / "backend" / "app" / "domain" / "ai" / "ai_service.py").read_text(encoding="utf-8")
        jd_analysis_source = (
            REPO_ROOT
            / "backend"
            / "app"
            / "domain"
            / "ai"
            / "jd_analysis_service.py"
        ).read_text(encoding="utf-8")

        self.assertIn("from .jd_analysis_service import (", ai_service_source)
        self.assertIn("analyze_jd,", ai_service_source)
        self.assertIn("analyze_jd_with_image,", ai_service_source)
        self.assertIn("analyze_jd_with_image_thoughts,", ai_service_source)
        self.assertIn("analyze_jd_with_thoughts,", ai_service_source)
        self.assertNotIn("async def analyze_jd", ai_service_source)
        self.assertNotIn("def _build_jd_analysis_user_parts", ai_service_source)
        self.assertNotIn("def _build_image_jd_user_message", ai_service_source)
        self.assertNotIn("def _build_image_jd_user_parts", ai_service_source)
        self.assertIn("async def analyze_jd(", jd_analysis_source)
        self.assertIn("async def analyze_jd_with_thoughts(", jd_analysis_source)
        self.assertIn("async def analyze_jd_with_image(", jd_analysis_source)
        self.assertIn("async def analyze_jd_with_image_thoughts(", jd_analysis_source)
        self.assertIn("def _build_jd_analysis_user_parts", jd_analysis_source)
        self.assertIn("def _build_image_jd_user_message", jd_analysis_source)
        self.assertIn("def _build_image_jd_user_parts", jd_analysis_source)

    def test_resume_editor_core_state_is_in_dedicated_hook(self) -> None:
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        core_state_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorCoreState.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useResumeEditorCoreState()", editor_source)
        self.assertIn("lineHeight, setLineHeight", core_state_source)
        self.assertIn("profile, setProfile", core_state_source)
        self.assertIn("selectedExpIds, setSelectedExpIds", core_state_source)
        self.assertIn("manualLayoutSnapshotRef", core_state_source)
        self.assertIn("currentLayout", core_state_source)
        self.assertIn("isLayoutModified", core_state_source)
        self.assertIn("useState(LINE_HEIGHT_DEFAULT)", core_state_source)
        self.assertIn("useState(FONT_SIZE_DEFAULT)", core_state_source)
        self.assertIn("resolveDefaultSectionSpacingKey('standard')", core_state_source)
        self.assertIn("buildDefaultSmartPageLayout('standard')", core_state_source)
        self.assertEqual(core_state_source.count("const latestLayoutSnapshotRef = useRef"), 1)
        self.assertEqual(core_state_source.count("const manualLayoutSnapshotRef = useRef"), 1)
        self.assertIn(
            "}), [fontSize, itemSpacingEm, lineHeight, sectionSpacingKey, topPaddingPx]);",
            core_state_source,
        )
        self.assertIn("[certifications, educations, experienceItems, skillGroups]", core_state_source)
        self.assertIn("}, [bossGreeting, bossGreetingSignature]);", core_state_source)
        self.assertNotIn("const [lineHeight, setLineHeight]", editor_source)
        self.assertNotIn("const [profile, setProfile]", editor_source)
        self.assertNotIn("const [selectedExpIds, setSelectedExpIds]", editor_source)
        self.assertNotIn("const latestLayoutSnapshotRef = useRef", editor_source)

    def test_resume_editor_manual_save_drafts_are_in_dedicated_hook(self) -> None:
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        coordinator_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorExperiencePolishCoordinator.ts"
        ).read_text(encoding="utf-8")
        manual_draft_hook_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorManualSaveDrafts.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useResumeEditorExperiencePolishCoordinator({", editor_source)
        self.assertIn("useResumeEditorManualSaveDrafts({", coordinator_source)
        self.assertIn("readPendingAssistantManualSaveDrafts({ resumeId })", manual_draft_hook_source)
        self.assertIn(".filter((draft) => draft.source === 'resume_editor')", manual_draft_hook_source)
        self.assertIn("clearPendingAssistantManualSaveDraft({", manual_draft_hook_source)
        self.assertIn("buildPendingAssistantManualSaveDraftKey(pendingManualSaveDraft)", manual_draft_hook_source)
        self.assertIn("applyAssistantExperienceDraftToEditingDraft(prev, pendingManualSaveDraft.draft)", manual_draft_hook_source)
        self.assertNotIn("readPendingAssistantManualSaveDrafts({ resumeId })", editor_source)
        self.assertNotIn("const [pendingManualSaveDraft, staleManualSaveDrafts]", editor_source)

    def test_resume_editor_transient_reset_is_in_dedicated_hook(self) -> None:
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        transient_reset_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorTransientReset.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useResumeEditorTransientReset({", editor_source)
        self.assertIn("handleCancelDelete();", transient_reset_source)
        self.assertIn("setOriginalProfile({ ...nextProfile });", transient_reset_source)
        self.assertIn("setOriginalProfileSyncMode(nextProfileSyncMode);", transient_reset_source)
        self.assertIn("setIsEditingProfile(false);", transient_reset_source)
        self.assertIn("experience.cancelEditingExperience();", transient_reset_source)
        self.assertIn("education.cancelEducationEdit();", transient_reset_source)
        self.assertIn("certification.cancelCertificationEdit();", transient_reset_source)
        self.assertIn("skill.cancelSkillEdit();", transient_reset_source)
        self.assertIn("skill.setRenamingCategoryTarget(null);", transient_reset_source)
        self.assertIn("skill.setRenamingCategoryDraft('');", transient_reset_source)
        self.assertNotIn("const resetEditorTransientState = useCallback", editor_source)

    def test_resume_editor_experience_polish_controls_are_in_dedicated_hook(self) -> None:
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        coordinator_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorExperiencePolishCoordinator.ts"
        ).read_text(encoding="utf-8")
        controls_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeEditorExperiencePolishControls.ts"
        ).read_text(encoding="utf-8")
        view_utils_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "experiencePolishViewUtils.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useResumeEditorExperiencePolishCoordinator({", editor_source)
        self.assertIn("useResumeEditorExperiencePolishControls({", coordinator_source)
        self.assertIn("useEditingExperiencePolishActions({", coordinator_source)
        self.assertIn("useFloatingExperiencePolishActions({", coordinator_source)
        self.assertIn("useFloatingExperiencePolishConfirmActions({", coordinator_source)
        self.assertIn("resolveBatchPolishOpenBlockMessage({", coordinator_source)
        self.assertIn("buildExperienceViewFromDraft", view_utils_source)
        self.assertIn("resolveSafeDateRange(", view_utils_source)
        self.assertIn("buildExperienceDate(", view_utils_source)
        self.assertIn("setExperiencePolishMode(DEFAULT_RESUME_POLISH_MODE);", controls_source)
        self.assertIn("setExperienceSmartCompletionPrompt(null);", controls_source)
        self.assertIn("editingExperiencePolishRunningRef.current = false;", controls_source)
        self.assertIn("handleExperiencePolishModeChange", controls_source)
        self.assertIn("handleFloatingPolishModeChange", controls_source)
        self.assertNotIn("const buildExperienceViewFromDraft = useCallback", editor_source)
        self.assertNotIn("const handleExperiencePolishModeChange = (mode", editor_source)
        self.assertNotIn("const handleFloatingPolishModeChange = (mode", editor_source)
        self.assertNotIn("const handleOpenBatchPolishToolbar = useCallback", editor_source)
        self.assertNotIn("const handleUndoBatchExperiencePolish = useCallback", editor_source)

    def test_experience_bank_summary_generation_is_in_dedicated_hook(self) -> None:
        profile_source = (
            REPO_ROOT
            / "views"
            / "ExperienceBank"
            / "useExperienceBankProfile.ts"
        ).read_text(encoding="utf-8")
        summary_hook_source = (
            REPO_ROOT
            / "views"
            / "ExperienceBank"
            / "useExperienceBankSummaryGeneration.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("useExperienceBankSummaryGeneration({", profile_source)
        self.assertIn("cancelSummaryGeneration({ bumpDraftVersion: true });", profile_source)
        self.assertIn("cancelSummaryGeneration();", profile_source)
        self.assertIn("aiService.generatePersonalSummaryStream", summary_hook_source)
        self.assertIn("summaryGenerationRequestIdRef", summary_hook_source)
        self.assertIn("summaryDraftVersionRef", summary_hook_source)
        self.assertIn("activeSummaryToastIdRef", summary_hook_source)
        self.assertIn("snapshotHasSummarySourceContent", summary_hook_source)
        self.assertIn("markSummaryDraftTouched();", summary_hook_source)
        self.assertNotIn("aiService.generatePersonalSummaryStream", profile_source)
        self.assertNotIn("const summaryGenerationRequestIdRef", profile_source)
        self.assertNotIn("const summaryDraftVersionRef", profile_source)
        self.assertNotIn("const activeSummaryToastIdRef", profile_source)

    def test_ai_assistant_skill_group_drafts_merge_existing_tags(self) -> None:
        service_source = (REPO_ROOT / "services" / "aiService.ts").read_text(encoding="utf-8")
        contract_source = (REPO_ROOT / "types" / "ai.ts").read_text(encoding="utf-8")
        session_source = (REPO_ROOT / "views" / "AIAssistant" / "sessionUtils.ts").read_text(encoding="utf-8")
        draft_card_source = (REPO_ROOT / "views" / "AIAssistant" / "AssistantDraftCardView.tsx").read_text(encoding="utf-8")
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        draft_apply_hook_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useResumeAssistantDraftApply.ts"
        ).read_text(encoding="utf-8")
        prompt_source = (REPO_ROOT / "backend" / "app" / "domain" / "ai" / "prompts.py").read_text(encoding="utf-8")

        self.assertIn("AssistantSkillDraftGroup", service_source)
        self.assertIn("targetUserSkillId?: string | null", contract_source)
        self.assertNotIn("proficiency?: number | null;", contract_source)
        self.assertIn("item.card.type === 'skill_group'", session_source)
        self.assertIn("skill_group:", session_source)
        self.assertIn("将合并更新技能组", draft_card_source)
        self.assertNotIn("skill.proficiency", draft_card_source)
        self.assertIn("findExistingSkillForAssistantDraft", draft_apply_hook_source)
        self.assertNotIn("payload.proficiency", editor_source + draft_apply_hook_source)
        self.assertIn("targetUserSkillId", prompt_source)
        self.assertIn("Never fabricate targetUserSkillId", prompt_source)
        self.assertIn("熟练掌握 Vibe Coding", prompt_source)
        self.assertNotIn("proficiency must be", prompt_source)

    def test_resume_editor_mobile_drawer_request_is_consumed_once(self) -> None:
        app_source = (REPO_ROOT / "App.tsx").read_text(encoding="utf-8")
        editor_source = (REPO_ROOT / "views" / "ResumeEditor" / "index.tsx").read_text(encoding="utf-8")
        drawer_hook_source = (
            REPO_ROOT
            / "views"
            / "ResumeEditor"
            / "hooks"
            / "useMobileEditorDrawer.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("onMobileDrawerOpenRequestConsumed?: () => void;", editor_source)
        self.assertIn("onMobileDrawerOpenRequestConsumed={handleConsumeEditorMobileDrawerOpenRequest}", app_source)
        self.assertIn("setEditorMobileDrawerOpenRequest(0)", app_source)
        self.assertIn("onMobileDrawerOpenRequestConsumed,", editor_source)

        effect_start = drawer_hook_source.index("if (mobileDrawerOpenRequest <= 0 || typeof window === 'undefined')")
        effect_end = drawer_hook_source.index("    }, [mobileDrawerOpenRequest", effect_start)
        effect_block = drawer_hook_source[effect_start:effect_end]

        self.assertIn("onMobileDrawerOpenRequestConsumed?.();", effect_block)
        self.assertLess(
            effect_block.index("onMobileDrawerOpenRequestConsumed?.();"),
            effect_block.index("if (window.innerWidth >= 768)"),
        )
        self.assertIn("onMobileDrawerOpenRequestConsumed", drawer_hook_source[effect_end:effect_end + 160])


class AssistantAttachmentSelectionTests(unittest.TestCase):
    def test_short_transform_reuses_latest_attachment_from_multi_attachment_history(self) -> None:
        first_attachment = {
            "name": "resume-cn.pdf",
            "kind": "document",
            "contentType": "application/pdf",
            "textExcerpt": "中文简历",
        }
        second_attachment = {
            "name": "cover-letter-cn.pdf",
            "kind": "document",
            "contentType": "application/pdf",
            "textExcerpt": "中文求职信",
        }
        history = [
            {
                "role": "user",
                "content_json": {
                    "text": "帮我看看这两份材料",
                    "attachment": first_attachment,
                    "attachments": [first_attachment, second_attachment],
                },
            }
        ]

        selected = ai_service._resolve_relevant_attachments(  # type: ignore[attr-defined]
            history,
            user_message="翻译成英文",
        )

        self.assertEqual(selected, [second_attachment])

    def test_english_short_transform_reuses_latest_attachment_from_multi_attachment_history(self) -> None:
        first_attachment = {
            "name": "resume-cn.pdf",
            "kind": "document",
            "contentType": "application/pdf",
            "textExcerpt": "中文简历",
        }
        second_attachment = {
            "name": "cover-letter-cn.pdf",
            "kind": "document",
            "contentType": "application/pdf",
            "textExcerpt": "中文求职信",
        }
        history = [
            {
                "role": "user",
                "content_json": {
                    "text": "check these two files",
                    "attachment": first_attachment,
                    "attachments": [first_attachment, second_attachment],
                },
            }
        ]

        for message in ("translate to English", "summarize", "polish it"):
            with self.subTest(message=message):
                selected = ai_service._resolve_relevant_attachments(  # type: ignore[attr-defined]
                    history,
                    user_message=message,
                )

                self.assertEqual(selected, [second_attachment])


class AssistantBankContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_bank_context_includes_latest_non_archived_library_content(self) -> None:
        latest_work_version = SimpleNamespace(
            title="  数据分析实习生  ",
            org=" 某科技公司 ",
            start_date=date(2024, 1, 1),
            end_date=date(2024, 6, 30),
            is_current=False,
            summary="<p>负责增长分析与报表搭建</p>",
            star={
                "s": "<div>用户增长停滞</div>",
                "t": "<p>定位漏斗问题</p>",
                "a": "<ul><li>搭建分群模型</li></ul>",
                "r": "注册转化提升 12%",
            },
        )
        archived_version = SimpleNamespace(
            title="旧经历",
            org="旧公司",
            start_date=None,
            end_date=None,
            is_current=False,
            summary="不会进入上下文",
            star={},
        )
        work_master = SimpleNamespace(
            id=uuid.uuid4(),
            category=ExperienceCategory.WORK,
            is_archived=False,
        )
        archived_master = SimpleNamespace(
            id=uuid.uuid4(),
            category=ExperienceCategory.PROJECT,
            is_archived=True,
        )
        certification = SimpleNamespace(
            id=uuid.uuid4(),
            name="PMP",
            issuer="PMI",
            issue_date=date(2023, 5, 1),
            expiry_date=None,
            description="<p>项目管理认证</p>",
        )
        user_skill = SimpleNamespace(id=uuid.uuid4(), proficiency=4)
        skill = SimpleNamespace(name="  <b>Python</b>  ", category="数据分析")
        profile = SimpleNamespace(
            full_name=" Alice ",
            title=" Senior Analyst ",
            summary="<p>" + ("增长复盘 " * 80) + "</p>",
            location=" Hong Kong ",
            email="alice@example.com",
            phone="12345678",
        )

        with patch.object(assistant_router, "get_profile_if_exists", AsyncMock(return_value=profile)):
            with patch.object(
                assistant_router,
                "list_experiences",
                AsyncMock(return_value=[(work_master, latest_work_version), (archived_master, archived_version)]),
            ):
                with patch.object(
                    assistant_router,
                    "list_certifications",
                    AsyncMock(return_value=[certification]),
                ):
                    with patch.object(
                        assistant_router,
                        "list_user_skills",
                        AsyncMock(return_value=[(user_skill, skill)]),
                    ):
                        result = await assistant_router._build_bank_context(  # type: ignore[attr-defined]
                            AsyncMock(),
                            user_id="user-1",
                        )

        self.assertEqual(result["profile"]["full_name"], "Alice")
        self.assertEqual(result["profile"]["title"], "Senior Analyst")
        self.assertLessEqual(len(result["profile"]["summary"]), 303)
        self.assertEqual(len(result["experiences"]["work"]), 1)
        self.assertEqual(result["experiences"]["project"], [])
        work_item = result["experiences"]["work"][0]
        self.assertEqual(work_item["masterId"], str(work_master.id))
        self.assertEqual(work_item["summary"], "负责增长分析与报表搭建")
        self.assertEqual(work_item["star"]["a"], "搭建分群模型")
        self.assertEqual(result["certifications"][0]["description"], "项目管理认证")
        self.assertEqual(result["skills"][0]["name"], "Python")
        self.assertEqual(result["skills"][0]["category"], "数据分析")

    async def test_build_bank_context_paginates_until_all_active_experiences_loaded(self) -> None:
        first_master = SimpleNamespace(
            id=uuid.uuid4(),
            category=ExperienceCategory.WORK,
            is_archived=False,
        )
        second_master = SimpleNamespace(
            id=uuid.uuid4(),
            category=ExperienceCategory.PROJECT,
            is_archived=False,
        )
        archived_master = SimpleNamespace(
            id=uuid.uuid4(),
            category=ExperienceCategory.WORK,
            is_archived=True,
        )
        version = SimpleNamespace(
            title="标题",
            org="组织",
            start_date=None,
            end_date=None,
            is_current=False,
            summary="摘要",
            star={},
        )
        profile = SimpleNamespace(
            full_name="Alice",
            title=None,
            summary=None,
            location=None,
            email=None,
            phone=None,
        )

        with patch.object(assistant_router, "BANK_CONTEXT_FETCH_BATCH_SIZE", 2):
            with patch.object(assistant_router, "get_profile_if_exists", AsyncMock(return_value=profile)):
                with patch.object(
                    assistant_router,
                    "list_experiences",
                    AsyncMock(
                        side_effect=[
                            [(first_master, version), (archived_master, version)],
                            [(second_master, version)],
                        ]
                    ),
                ) as list_experiences_mock:
                    with patch.object(
                        assistant_router,
                        "list_certifications",
                        AsyncMock(return_value=[]),
                    ):
                        with patch.object(
                            assistant_router,
                            "list_user_skills",
                            AsyncMock(return_value=[]),
                        ):
                            result = await assistant_router._build_bank_context(  # type: ignore[attr-defined]
                                AsyncMock(),
                                user_id="user-1",
                            )

        self.assertEqual(list_experiences_mock.await_count, 2)
        self.assertFalse(list_experiences_mock.await_args_list[0].kwargs["include_archived"])
        self.assertFalse(list_experiences_mock.await_args_list[1].kwargs["include_archived"])
        self.assertEqual(len(result["experiences"]["work"]), 1)
        self.assertEqual(len(result["experiences"]["project"]), 1)
        self.assertEqual(
            {item["masterId"] for item in result["experiences"]["work"] + result["experiences"]["project"]},
            {str(first_master.id), str(second_master.id)},
        )

    async def test_hydrate_selected_experiences_for_ai_reads_full_latest_star(self) -> None:
        master_id = str(uuid.uuid4())
        full_action = "完整动作" * 200
        latest_version = SimpleNamespace(
            star={
                "s": "<p>完整背景</p>",
                "a": full_action,
            },
        )

        with patch.object(
            assistant_router,
            "get_experience_detail",
            AsyncMock(return_value=(SimpleNamespace(id=master_id), latest_version, [latest_version])),
        ):
            result = await assistant_router._hydrate_selected_experiences_for_ai(  # type: ignore[attr-defined]
                AsyncMock(),
                user_id="user-1",
                selected_experiences=[
                    {
                        "masterId": master_id,
                        "category": "work",
                        "title": "产品经理",
                        "star": {"s": "完整背景", "a": "完整动作..."},
                    }
                ],
            )

        self.assertEqual(result[0]["star"]["s"], "<p>完整背景</p>")
        self.assertEqual(result[0]["star"]["a"], full_action)

    async def test_build_bank_context_keeps_profile_empty_when_user_has_no_profile(self) -> None:
        user_skill = SimpleNamespace(id=uuid.uuid4(), proficiency=3)
        skill = SimpleNamespace(name="数据分析" * 120, category=None)

        with patch.object(assistant_router, "get_profile_if_exists", AsyncMock(return_value=None)):
            with patch.object(
                assistant_router,
                "list_experiences",
                AsyncMock(return_value=[]),
            ):
                with patch.object(
                    assistant_router,
                    "list_certifications",
                    AsyncMock(return_value=[]),
                ):
                    with patch.object(
                        assistant_router,
                        "list_user_skills",
                        AsyncMock(return_value=[(user_skill, skill)]),
                    ):
                        result = await assistant_router._build_bank_context(  # type: ignore[attr-defined]
                            AsyncMock(),
                            user_id="user-1",
                        )

        self.assertEqual(result["profile"], {})
        self.assertEqual(len(result["skills"]), 1)
        self.assertLessEqual(len(result["skills"][0]["name"]), 303)

    async def test_stream_turn_rejects_invalid_attachment_before_loading_bank_context(self) -> None:
        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="",
            display_message="",
            mode=None,
            selected_experiences=[],
        )
        attachment = SimpleNamespace(
            filename="empty.pdf",
            content_type="application/pdf",
            read=AsyncMock(return_value=b""),
            seek=AsyncMock(),
        )
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            mode="general",
            title="AI 助理",
            entry_source="direct",
            context_json={},
        )
        current_user = SimpleNamespace(id="user-1")

        with patch.object(
            assistant_router,
            "_parse_stream_payload",
            AsyncMock(return_value=(payload, attachment)),
        ):
            with patch.object(
                assistant_router,
                "get_assistant_session",
                AsyncMock(return_value=assistant_session),
            ):
                with patch.object(
                    assistant_router,
                    "get_session_detail",
                    AsyncMock(return_value=(assistant_session, [])),
                ):
                    with patch.object(
                        assistant_router,
                        "_build_bank_context",
                        AsyncMock(return_value={}),
                    ) as build_bank_context_mock:
                        with patch.object(
                            assistant_router.billing_service,
                            "ensure_quota_available",
                            AsyncMock(return_value=SimpleNamespace()),
                        ):
                            response = await assistant_router.stream_assistant_session_turn(  # type: ignore[attr-defined]
                                uuid.uuid4(),
                                AsyncMock(),
                                session=AsyncMock(),
                                current_user=current_user,
                            )
                            chunks: list[str] = []
                            async for chunk in response.body_iterator:
                                chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)

        self.assertEqual(build_bank_context_mock.await_count, 0)
        parsed_events = [json.loads(chunk) for chunk in chunks]
        self.assertEqual(parsed_events[0]["type"], "progress")
        self.assertEqual(parsed_events[0]["node"], "read_attachment")
        self.assertEqual(parsed_events[1]["type"], "error")
        self.assertIn("附件为空", parsed_events[1]["message"])

    async def test_stream_turn_rejects_unparseable_attachment_before_loading_bank_context(self) -> None:
        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="",
            display_message="",
            mode=None,
            selected_experiences=[],
        )
        attachment = SimpleNamespace(
            filename="broken.pdf",
            content_type="application/pdf",
            read=AsyncMock(return_value=b"fake-pdf-content"),
            seek=AsyncMock(),
        )
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            mode="general",
            title="AI 助理",
            entry_source="direct",
            context_json={},
        )
        current_user = SimpleNamespace(id="user-1")

        with patch.object(
            assistant_router,
            "_parse_stream_payload",
            AsyncMock(return_value=(payload, attachment)),
        ):
            with patch.object(
                assistant_router,
                "get_assistant_session",
                AsyncMock(return_value=assistant_session),
            ):
                with patch.object(
                    assistant_router,
                    "get_session_detail",
                    AsyncMock(return_value=(assistant_session, [])),
                ):
                    with patch.object(
                        assistant_router,
                        "_build_bank_context",
                        AsyncMock(return_value={}),
                    ) as build_bank_context_mock:
                        with patch.object(
                            assistant_router.billing_service,
                            "ensure_quota_available",
                            AsyncMock(return_value=SimpleNamespace()),
                        ):
                            with patch.object(
                                assistant_router.jd_attachment_service,
                                "extract_jd_from_attachment",
                                AsyncMock(side_effect=ValueError("文件「broken.pdf」无法解析")),
                            ):
                                response = await assistant_router.stream_assistant_session_turn(  # type: ignore[attr-defined]
                                    uuid.uuid4(),
                                    AsyncMock(),
                                    session=AsyncMock(),
                                    current_user=current_user,
                                )
                                chunks: list[str] = []
                                async for chunk in response.body_iterator:
                                    chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)

        self.assertEqual(build_bank_context_mock.await_count, 0)
        parsed_events = [json.loads(chunk) for chunk in chunks]
        self.assertEqual(parsed_events[0]["type"], "progress")
        self.assertEqual(parsed_events[0]["node"], "read_attachment")
        self.assertEqual(parsed_events[1]["type"], "error")
        self.assertIn("无法解析", parsed_events[1]["message"])

    def test_sanitize_message_content_json_clips_selected_experiences(self) -> None:
        sanitized = assistant_router._sanitize_message_content_json(  # type: ignore[attr-defined]
            {
                "text": "历史消息",
                "attachment": {"name": "test.pdf", "text": "secret", "imageB64": "blob"},
                "selected_experiences": [
                    {
                        "masterId": "master-1",
                        "category": "work",
                        "summary": "S" * 400,
                        "star": {"s": "A" * 600},
                    },
                    {
                        "masterId": "bad-shape",
                        "category": "invalid",
                        "summary": {"oops": True},
                    },
                ],
            }
        )

        self.assertEqual(sanitized["attachment"], {"name": "test.pdf"})
        self.assertEqual(
            sanitized["selected_experiences"],
            [
                {
                    "masterId": "master-1",
                    "category": "work",
                    "isCurrent": False,
                    "summary": "S" * 300 + "...",
                    "star": {"s": "A" * 500 + "..."},
                }
            ],
        )

    def test_sanitize_message_content_json_normalizes_selected_resume(self) -> None:
        sanitized = assistant_router._sanitize_message_content_json(  # type: ignore[attr-defined]
            {
                "text": "历史消息",
                "selected_resume": {
                    "resumeId": "resume-1",
                    "resumeName": "AI产品经理简历",
                    "jdContext": "J" * 5000,
                    "contextSource": "implicit_current_resume",
                    "selection": {
                        "mode": "subset",
                        "experienceIds": ["exp-1", "bad-id" * 80, ""],
                        "moduleIds": ["exp-exp-1", "edu-edu-1", "bad-module" * 80, ""],
                    },
                "snapshot": {
                    "experiences": [
                        {
                            "id": "exp-1",
                            "title": "产品经理",
                            "org": "某公司",
                            "star": {"s": "A" * 600},
                        },
                        {"id": "", "title": "bad"},
                    ],
                    "educations": [
                        {
                            "id": "edu-1",
                            "school": "某大学",
                            "major": "计算机科学",
                            "degree": "本科",
                            "courses": "C" * 600,
                        }
                    ],
                    "certifications": [
                        {"id": "cert-1", "name": "PMP", "issue_date": "2024.08"},
                    ],
                    "skills": [
                        {"id": "skill-1", "name": "需求分析", "category": "产品"},
                        ],
                    },
                },
            }
        )

        self.assertEqual(
            sanitized["selected_resume"],
            {
                "resume_id": "resume-1",
                "resume_name": "AI产品经理简历",
                "jd_context": "J" * 4000 + "...",
                "context_source": "implicit_current_resume",
                "selection": {
                    "mode": "subset",
                    "experienceIds": ["exp-1", ("bad-id" * 80)[:120] + "..."],
                    "moduleIds": ["exp-exp-1", "edu-edu-1", ("bad-module" * 80)[:120] + "..."],
                },
                "snapshot": {
                    "experiences": [
                        {
                            "id": "exp-1",
                            "title": "产品经理",
                            "org": "某公司",
                            "star": {"s": "A" * 500 + "..."},
                        }
                    ],
                    "educations": [
                        {
                            "id": "edu-1",
                            "school": "某大学",
                            "major": "计算机科学",
                            "degree": "本科",
                            "courses": "C" * 500 + "...",
                        }
                    ],
                    "certifications": [
                        {"id": "cert-1", "name": "PMP", "issue_date": "2024.08"}
                    ],
                    "skills": [
                        {"id": "skill-1", "name": "需求分析", "category": "产品"}
                    ],
                },
            },
        )

    def test_build_assistant_payload_includes_bank_context(self) -> None:
        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我优化自我介绍",
            session_title="AI 助理",
            entry_source="direct",
            context_json={"resumeId": "resume-1"},
            bank_context={"profile": {"full_name": "Alice"}},
            selected_experiences=None,
            selected_resume=None,
            history=[],
        )

        self.assertEqual(payload["context"], {"resumeId": "resume-1"})
        self.assertEqual(payload["bank_context"], {"profile": {"full_name": "Alice"}})

    def test_assistant_stream_request_accepts_skill_id(self) -> None:
        payload = assistant_router.AssistantSessionStreamRequest(
            user_message="请模拟面试",
            display_message="请模拟面试",
            mode=None,
            skill_id="mock_interview",
            selected_experiences=[],
        )

        self.assertEqual(payload.skill_id, "mock_interview")

    def test_assistant_stream_request_rejects_unknown_skill_id(self) -> None:
        with self.assertRaises(Exception):
            assistant_router.AssistantSessionStreamRequest(
                user_message="请模拟面试",
                display_message="请模拟面试",
                mode=None,
                skill_id="unknown_skill",
                selected_experiences=[],
            )

    def test_build_assistant_payload_clips_selected_experiences(self) -> None:
        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我整理",
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
                    "summary": "S" * 400,
                    "star": {
                        "s": "A" * 600,
                        "t": "B" * 600,
                    },
                }
            ],
            selected_resume=None,
            history=[
                {
                    "role": "user",
                    "message_type": "user_text",
                    "content_json": {
                        "text": "历史消息",
                        "selected_experiences": [
                            {
                                "masterId": "history-1",
                                "category": "project",
                                "summary": {"bad": "shape"},
                                "org": ["bad"],
                            }
                        ],
                    },
                }
            ],
        )

        selected = payload["selected_experiences"][0]
        self.assertLessEqual(len(selected["summary"]), 303)
        self.assertLessEqual(len(selected["star"]["s"]), 503)
        self.assertEqual(
            payload["history"][0]["content_json"]["selected_experiences"],
            [{"masterId": "history-1", "category": "project", "isCurrent": False}],
        )

    def test_build_assistant_payload_caps_selected_experiences_count(self) -> None:
        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="帮我整理",
            session_title="AI 助理",
            entry_source="direct",
            context_json={},
            bank_context=None,
            selected_experiences=[
                {
                    "masterId": f"master-{index}",
                    "category": "work",
                    "title": f"标题 {index}",
                }
                for index in range(ai_service.MAX_SELECTED_EXPERIENCES + 5)
            ],
            selected_resume=None,
            history=[],
        )

        self.assertEqual(
            len(payload["selected_experiences"]),
            ai_service.MAX_SELECTED_EXPERIENCES,
        )
        self.assertEqual(
            payload["selected_experiences"][-1]["masterId"],
            f"master-{ai_service.MAX_SELECTED_EXPERIENCES - 1}",
        )

    def test_build_assistant_payload_includes_selected_resume(self) -> None:
        payload = ai_service._build_assistant_payload(
            mode="general",
            user_message="请帮我优化简历",
            session_title="AI 助理",
            entry_source="resume_editor",
            context_json={"resumeId": "resume-1"},
            bank_context=None,
            selected_experiences=None,
            selected_resume={
                "resumeId": "resume-1",
                "resumeName": "产品经理简历",
                "snapshot": {
                    "experiences": [
                        {"id": "exp-1", "title": "产品经理", "org": "某公司", "star": {"s": "A" * 600}}
                    ],
                    "educations": [
                        {"id": "edu-1", "school": "某大学", "major": "计算机科学", "degree": "本科"}
                    ],
                    "certifications": [],
                    "skills": [],
                },
                "selection": {"mode": "subset", "experienceIds": ["exp-1"], "moduleIds": ["exp-exp-1"]},
                "contextSource": "explicit_resume_picker",
                "jdContext": "关注 AI 产品设计与需求拆解",
            },
            history=[
                {
                    "role": "user",
                    "message_type": "user_text",
                    "content_json": {
                        "text": "历史消息",
                        "selected_resume": {
                            "resume_id": "resume-old",
                            "resume_name": "旧简历",
                            "selection": {"mode": "subset", "experienceIds": ["old-exp"], "moduleIds": ["old-module"]},
                            "context_source": "history_replay",
                            "snapshot": {"experiences": [], "educations": [], "certifications": [], "skills": []},
                        },
                    },
                }
            ],
        )

        self.assertEqual(payload["selected_resume"]["resume_id"], "resume-1")
        self.assertEqual(payload["selected_resume"]["resume_name"], "产品经理简历")
        self.assertEqual(
            payload["selected_resume"]["selection"],
            {"mode": "subset", "experienceIds": ["exp-1"], "moduleIds": ["exp-exp-1"]},
        )
        self.assertEqual(payload["selected_resume"]["context_source"], "explicit_resume_picker")
        self.assertLessEqual(
            len(payload["selected_resume"]["snapshot"]["experiences"][0]["star"]["s"]),
            503,
        )
        self.assertEqual(
            payload["selected_resume"]["snapshot"]["educations"][0]["school"],
            "某大学",
        )
        self.assertEqual(
            payload["history"][0]["content_json"]["selected_resume"]["resume_id"],
            "resume-old",
        )
        self.assertEqual(
            payload["history"][0]["content_json"]["selected_resume"]["selection"],
            {"mode": "subset", "experienceIds": ["old-exp"], "moduleIds": ["old-module"]},
        )
        self.assertEqual(
            payload["history"][0]["content_json"]["selected_resume"]["context_source"],
            "history_replay",
        )


class AssistantDraftApplyTests(unittest.IsolatedAsyncioTestCase):
    async def test_apply_direct_skill_group_merges_existing_skills_and_creates_missing(self) -> None:
        category = "产品经理核心技能"
        existing_skill = SimpleNamespace(id=uuid.uuid4(), name="Axure", category=category)
        existing_user_skill = UserSkill(
            id=uuid.uuid4(),
            user_id="user-1",
            skill_id=existing_skill.id,
            proficiency=2,
        )
        preserved_skill = SimpleNamespace(id=uuid.uuid4(), name="Figma", category=category)
        preserved_user_skill = UserSkill(
            id=uuid.uuid4(),
            user_id="user-1",
            skill_id=preserved_skill.id,
            proficiency=4,
        )
        session = _FakeAsyncSession(
            [
                _ExecuteResult(all_items=[
                    (existing_user_skill, existing_skill),
                    (preserved_user_skill, preserved_skill),
                ]),
                _ExecuteResult(one_or_none=existing_skill),
                _ExecuteResult(one_or_none=None),
            ]
        )
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "skill_group",
                "data": {
                    "category": category,
                    "skills": [
                        {"name": " Axure "},
                        {"name": "PRD 撰写"},
                        {"name": "Axure"},
                    ],
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_user_skills = [
            item for item in session.added
            if isinstance(item, UserSkill) and item.id not in {existing_user_skill.id, preserved_user_skill.id}
        ]
        self.assertEqual(existing_user_skill.proficiency, 2)
        self.assertEqual(existing_user_skill.skill_id, existing_skill.id)
        self.assertEqual(preserved_user_skill.proficiency, 4)
        self.assertEqual(preserved_user_skill.skill_id, preserved_skill.id)
        self.assertEqual(len(created_user_skills), 1)
        self.assertEqual(created_user_skills[0].user_id, "user-1")
        self.assertIsNone(created_user_skills[0].proficiency)

    async def test_apply_direct_skill_group_uses_target_user_skill_id_before_name_match(self) -> None:
        category = "AI 工具"
        old_skill = SimpleNamespace(id=uuid.uuid4(), name="Prompt Engineering", category=category)
        targeted_user_skill = UserSkill(
            id=uuid.uuid4(),
            user_id="user-1",
            skill_id=old_skill.id,
            proficiency=3,
        )
        session = _FakeAsyncSession(
            [
                _ExecuteResult(all_items=[(targeted_user_skill, old_skill)]),
                _ExecuteResult(one_or_none=None),
            ]
        )
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "skill_group",
                "data": {
                    "category": category,
                    "skills": [
                        {
                            "targetUserSkillId": str(targeted_user_skill.id),
                            "name": "Vibe Coding",
                        }
                    ],
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_skills = [item for item in session.added if isinstance(item, Skill)]
        created_user_skills = [
            item for item in session.added
            if isinstance(item, UserSkill) and item.id != targeted_user_skill.id
        ]
        self.assertEqual(len(created_skills), 1)
        self.assertEqual(created_skills[0].name, "Vibe Coding")
        self.assertEqual(targeted_user_skill.skill_id, created_skills[0].id)
        self.assertEqual(targeted_user_skill.proficiency, 3)
        self.assertEqual(created_user_skills, [])

    async def test_apply_direct_experience_draft_updates_targeted_master(self) -> None:
        master = MasterExperience(
            id=uuid.uuid4(),
            user_id="user-1",
            category=ExperienceCategory.WORK,
            latest_version_id=uuid.uuid4(),
        )
        latest_version = ExperienceVersion(
            id=uuid.uuid4(),
            master_experience_id=master.id,
            version=2,
            title="旧标题",
            org="旧公司",
            location="深圳",
            start_date=date(2024, 1, 1),
            end_date=None,
            is_current=True,
            summary="旧摘要",
            highlights=[],
            tags=[],
            star={"s": "旧S", "t": "旧T", "a": "旧A", "r": "旧R"},
        )
        session = _FakeAsyncSession(
            [
                _ExecuteResult(one_or_none=master),
                _ExecuteResult(one_or_none=latest_version),
                _ExecuteResult(first=2),
            ]
        )
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "experience",
                "data": {
                    "category": "work",
                    "title": "新标题",
                    "org": "新公司",
                    "startDate": "",
                    "endDate": "",
                    "isCurrent": False,
                    "targetMasterId": str(master.id),
                    "star": {"a": "新A"},
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len(created_versions), 1)
        created_version = created_versions[0]
        self.assertEqual(created_version.master_experience_id, master.id)
        self.assertEqual(created_version.version, 3)
        self.assertEqual(created_version.title, "新标题")
        self.assertEqual(created_version.org, "新公司")
        self.assertEqual(created_version.start_date, date(2024, 1, 1))
        self.assertTrue(created_version.is_current)
        self.assertEqual(created_version.star["a"], "新A")
        self.assertEqual(created_version.star["s"], "旧S")

    async def test_apply_direct_experience_draft_rejects_mismatched_target_category(self) -> None:
        master = MasterExperience(
            id=uuid.uuid4(),
            user_id="user-1",
            category=ExperienceCategory.WORK,
            latest_version_id=uuid.uuid4(),
        )
        latest_version = ExperienceVersion(
            id=uuid.uuid4(),
            master_experience_id=master.id,
            version=1,
            title="旧标题",
            org="旧公司",
            location=None,
            start_date=None,
            end_date=None,
            is_current=False,
            summary=None,
            highlights=[],
            tags=[],
            star={},
        )
        session = _FakeAsyncSession(
            [
                _ExecuteResult(one_or_none=master),
                _ExecuteResult(one_or_none=latest_version),
            ]
        )
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "title": "新项目",
                    "org": "新组织",
                    "targetMasterId": str(master.id),
                    "star": {"a": "新动作"},
                },
            }
        )

        with self.assertRaises(assistant_service.InvalidMessageError):
            await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
                session,
                user_id="user-1",
                assistant_session=assistant_session,
                message=message,
            )

    async def test_apply_direct_experience_draft_creates_new_master_without_target(self) -> None:
        session = _FakeAsyncSession([_ExecuteResult(first=None)])
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "title": "新项目",
                    "org": "独立项目",
                    "startDate": "2025-01-01",
                    "endDate": "2025-03-01",
                    "isCurrent": False,
                    "star": {"s": "背景", "t": "目标", "a": "执行", "r": "结果"},
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_masters = [item for item in session.added if isinstance(item, MasterExperience)]
        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len({item.id for item in created_masters}), 1)
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_masters[0].category, ExperienceCategory.PROJECT)
        self.assertEqual(created_versions[0].version, 1)
        self.assertEqual(created_versions[0].title, "新项目")

    async def test_apply_direct_experience_draft_accepts_year_month_dates(self) -> None:
        session = _FakeAsyncSession([_ExecuteResult(first=None)])
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "title": "AI 产品开发",
                    "org": "原子简历",
                    "startDate": "2024.05",
                    "endDate": "2025-03",
                    "isCurrent": False,
                    "star": {"s": "背景", "t": "目标", "a": "执行", "r": "结果"},
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_versions[0].start_date, date(2024, 5, 1))
        self.assertEqual(created_versions[0].end_date, date(2025, 3, 1))

    async def test_apply_direct_experience_draft_coerces_day_dates_to_month_start(self) -> None:
        session = _FakeAsyncSession([_ExecuteResult(first=None)])
        assistant_session = SimpleNamespace(context_json={}, entry_source="direct")
        message = SimpleNamespace(
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "title": "RPG 游戏经历",
                    "org": "独立互动叙事 RPG 游戏",
                    "startDate": "2025-08-01",
                    "endDate": "2026-04-30",
                    "isCurrent": False,
                    "star": {"s": "背景", "t": "目标", "a": "执行", "r": "结果"},
                },
            }
        )

        await assistant_service._apply_direct_draft_card(  # type: ignore[attr-defined]
            session,
            user_id="user-1",
            assistant_session=assistant_session,
            message=message,
        )

        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_versions[0].start_date, date(2025, 8, 1))
        self.assertEqual(created_versions[0].end_date, date(2026, 4, 1))

    async def test_mark_message_applied_rejects_mismatched_target_in_resume_editor(self) -> None:
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="resume_editor",
            context_json={"masterId": "master-1"},
            latest_preview={},
        )
        message = SimpleNamespace(
            id=uuid.uuid4(),
            message_type="draft_card",
            content_json={
                "type": "experience",
                "data": {
                    "category": "work",
                    "title": "新标题",
                    "targetMasterId": "master-2",
                },
            },
        )
        session = _FakeAsyncSession([_ExecuteResult(one_or_none=message)])

        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            with self.assertRaises(assistant_service.InvalidMessageError):
                await assistant_service.mark_message_applied(
                    session,
                    user_id="user-1",
                    session_id=assistant_session.id,
                    message_id=message.id,
                )

    async def test_mark_message_applied_allows_resume_level_resume_editor_session(self) -> None:
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="resume_editor",
            context_json={"resumeId": "resume-1"},
            latest_preview={},
        )
        message = SimpleNamespace(
            id=uuid.uuid4(),
            message_type="draft_card",
            content_json={
                "type": "experience",
                "data": {
                    "category": "work",
                    "title": "新标题",
                },
            },
        )
        session = _FakeAsyncSession([_ExecuteResult(one_or_none=message)])

        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            updated = await assistant_service.mark_message_applied(
                session,
                user_id="user-1",
                session_id=assistant_session.id,
                message_id=message.id,
            )

        self.assertIs(updated, message)
        self.assertIn("applied_at", message.content_json)
        session.commit.assert_awaited()

    async def test_mark_message_applied_creates_experience_from_unbound_experience_bank_session(self) -> None:
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="experience_bank",
            context_json={"origin": "experience_bank_empty_state"},
            latest_preview={},
        )
        message = SimpleNamespace(
            id=uuid.uuid4(),
            message_type="draft_card",
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "title": "新项目",
                    "org": "个人作品",
                    "startDate": "2025-01-01",
                    "endDate": "2025-03-01",
                    "isCurrent": False,
                    "star": {"s": "背景", "t": "目标", "a": "执行", "r": "结果"},
                },
            },
        )
        session = _FakeAsyncSession([
            _ExecuteResult(one_or_none=message),
            _ExecuteResult(first=None),
        ])

        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            updated = await assistant_service.mark_message_applied(
                session,
                user_id="user-1",
                session_id=assistant_session.id,
                message_id=message.id,
            )

        self.assertIs(updated, message)
        created_masters = [item for item in session.added if isinstance(item, MasterExperience)]
        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len({item.id for item in created_masters}), 1)
        self.assertEqual(created_masters[0].category, ExperienceCategory.PROJECT)
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_versions[0].title, "新项目")
        self.assertIn("applied_at", message.content_json)
        session.commit.assert_awaited()

    async def test_mark_message_applied_creates_education_from_legacy_education_card(self) -> None:
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="direct",
            context_json={},
            latest_preview={},
        )
        message = SimpleNamespace(
            id=uuid.uuid4(),
            message_type="draft_card",
            content_json={
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
                        "s": "本科",
                        "t": "GPA 3.8",
                        "a": "数据结构\n操作系统",
                        "r": "完成核心课程",
                    },
                },
            },
        )
        session = _FakeAsyncSession([
            _ExecuteResult(one_or_none=message),
            _ExecuteResult(first=None),
        ])

        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            updated = await assistant_service.mark_message_applied(
                session,
                user_id="user-1",
                session_id=assistant_session.id,
                message_id=message.id,
            )

        self.assertIs(updated, message)
        created_masters = [item for item in session.added if isinstance(item, MasterExperience)]
        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len({item.id for item in created_masters}), 1)
        self.assertEqual(created_masters[0].category, ExperienceCategory.EDUCATION)
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_versions[0].title, "计算机科学")
        self.assertEqual(created_versions[0].org, "某大学")
        self.assertEqual(created_versions[0].star["degree"], "本科")
        self.assertEqual(created_versions[0].star["gpa"], "GPA 3.8")
        self.assertEqual(created_versions[0].star["courses"], "数据结构\n操作系统")
        self.assertNotIn("s", created_versions[0].star)
        self.assertNotIn("t", created_versions[0].star)
        self.assertNotIn("a", created_versions[0].star)
        self.assertNotIn("r", created_versions[0].star)
        self.assertIn("applied_at", message.content_json)
        session.commit.assert_awaited()

    async def test_mark_message_applied_updates_bound_experience_bank_master_with_month_dates(self) -> None:
        master_id = uuid.uuid4()
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="experience_bank",
            context_json={"masterId": str(master_id), "category": "project"},
            latest_preview={},
        )
        message = SimpleNamespace(
            id=uuid.uuid4(),
            message_type="draft_card",
            content_json={
                "type": "experience",
                "data": {
                    "category": "project",
                    "targetMasterId": str(uuid.uuid4()),
                    "title": "RPG 游戏经历",
                    "org": "独立互动叙事 RPG 游戏",
                    "startDate": "2025-08-01",
                    "endDate": "2026-04-30",
                    "isCurrent": False,
                    "star": {"s": "背景", "t": "目标", "a": "执行", "r": "结果"},
                },
            },
        )
        master = MasterExperience(
            id=master_id,
            user_id="user-1",
            category=ExperienceCategory.PROJECT,
            latest_version_id=None,
        )
        session = _FakeAsyncSession([
            _ExecuteResult(one_or_none=message),
            _ExecuteResult(one_or_none=master),
            _ExecuteResult(first=1),
        ])

        with patch.object(assistant_service, "get_session", AsyncMock(return_value=assistant_session)):
            updated = await assistant_service.mark_message_applied(
                session,
                user_id="user-1",
                session_id=assistant_session.id,
                message_id=message.id,
            )

        self.assertIs(updated, message)
        created_versions = [item for item in session.added if isinstance(item, ExperienceVersion)]
        self.assertEqual(len(created_versions), 1)
        self.assertEqual(created_versions[0].master_experience_id, master_id)
        self.assertEqual(created_versions[0].start_date, date(2025, 8, 1))
        self.assertEqual(created_versions[0].end_date, date(2026, 4, 1))
        self.assertIn("applied_at", message.content_json)
        session.commit.assert_awaited()


class AssistantPersistenceTests(unittest.IsolatedAsyncioTestCase):
    def test_draft_apply_log_summary_omits_user_resume_content(self) -> None:
        summary = assistant_service._summarize_draft_content(  # type: ignore[attr-defined]
            {
                "type": "experience",
                "status": "draft_ready",
                "data": {
                    "category": "project",
                    "targetMasterId": "master-sensitive-id",
                    "title": "AI 产品开发",
                    "org": "秘密公司",
                    "startDate": "2024.05",
                    "endDate": "2025.03",
                    "isCurrent": False,
                    "star": {"s": "敏感背景", "a": "敏感行动"},
                },
            }
        )

        serialized = json.dumps(summary, ensure_ascii=False)
        for sensitive_text in (
            "master-sensitive-id",
            "AI 产品开发",
            "秘密公司",
            "2024.05",
            "2025.03",
            "敏感背景",
            "敏感行动",
        ):
            self.assertNotIn(sensitive_text, serialized)
        self.assertEqual(summary["type"], "experience")
        self.assertTrue(summary["has_data"])
        self.assertTrue(summary["has_targetMasterId"])
        self.assertTrue(summary["has_star"])

    def test_experience_bank_mismatch_log_omits_draft_target_value(self) -> None:
        sensitive_target = "AI 草稿目标里可能出现的敏感简历内容"
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            entry_source="experience_bank",
            context_json={"masterId": str(uuid.uuid4())},
        )

        with self.assertLogs("uvicorn.error", level="WARNING") as captured:
            resolved = assistant_service._resolve_bound_experience_master_id(  # type: ignore[attr-defined]
                assistant_session,
                {"targetMasterId": sensitive_target},
                allow_unbound_target=False,
            )

        logs = "\n".join(captured.output)
        self.assertEqual(resolved, assistant_session.context_json["masterId"])
        self.assertNotIn(sensitive_target, logs)
        self.assertIn("has_draft_target_master_id=True", logs)

    async def test_persist_assistant_turn_sanitizes_selected_experiences(self) -> None:
        session = _FakeAsyncSession([])
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            latest_preview={},
            updated_at=None,
        )

        created = await assistant_service.persist_assistant_turn(
            session,
            assistant_session,
            user_message="帮我优化",
            user_selected_experiences=[
                {
                    "masterId": "master-1",
                    "category": "project",
                    "summary": "S" * 400,
                    "star": {"t": "T" * 600},
                },
                {
                    "masterId": "drop-me",
                    "category": "unsupported",
                },
            ],
            assistant_text="好的",
            draft_card=None,
        )

        self.assertEqual(len(created), 2)
        self.assertEqual(
            created[0].content_json["selected_experiences"],
            [
                {
                    "masterId": "master-1",
                    "category": "project",
                    "isCurrent": False,
                    "summary": "S" * 300 + "...",
                    "star": {"t": "T" * 500 + "..."},
                }
            ],
        )

    async def test_persist_assistant_turn_falls_back_to_user_message_when_display_message_blank(self) -> None:
        session = _FakeAsyncSession([])
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            latest_preview={},
            updated_at=None,
        )

        created = await assistant_service.persist_assistant_turn(
            session,
            assistant_session,
            user_message="请模拟面试",
            display_message="",
            assistant_text="好的",
            draft_card=None,
        )

        self.assertEqual(created[0].content_json["text"], "请模拟面试")

    async def test_persist_assistant_turn_caps_selected_experiences_count(self) -> None:
        session = _FakeAsyncSession([])
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            latest_preview={},
            updated_at=None,
        )

        created = await assistant_service.persist_assistant_turn(
            session,
            assistant_session,
            user_message="帮我优化",
            user_selected_experiences=[
                {
                    "masterId": f"master-{index}",
                    "category": "project",
                    "title": f"项目 {index}",
                }
                for index in range(ai_service.MAX_SELECTED_EXPERIENCES + 3)
            ],
            assistant_text="好的",
            draft_card=None,
        )

        self.assertEqual(
            len(created[0].content_json["selected_experiences"]),
            ai_service.MAX_SELECTED_EXPERIENCES,
        )
        self.assertEqual(
            created[0].content_json["selected_experiences"][-1]["masterId"],
            f"master-{ai_service.MAX_SELECTED_EXPERIENCES - 1}",
        )

    async def test_persist_assistant_turn_sanitizes_selected_resume(self) -> None:
        session = _FakeAsyncSession([])
        assistant_session = SimpleNamespace(
            id=uuid.uuid4(),
            latest_preview={},
            updated_at=None,
        )

        created = await assistant_service.persist_assistant_turn(
            session,
            assistant_session,
            user_message="帮我优化",
            user_selected_resume={
                "resumeId": "resume-1",
                "resumeName": "AI产品经理简历",
                "jdContext": "J" * 5000,
                "contextSource": "explicit_resume_picker",
                "snapshot": {
                    "experiences": [
                        {"id": "exp-1", "title": "产品经理", "org": "某公司", "star": {"a": "A" * 600}},
                    ],
                    "educations": [
                        {"id": "edu-1", "school": "某大学", "major": "计算机科学", "degree": "本科"}
                    ],
                    "certifications": [],
                    "skills": [{"id": "skill-1", "name": "需求分析", "category": "产品"}],
                },
                "selection": {"mode": "subset", "experienceIds": ["exp-1"], "moduleIds": ["exp-exp-1"]},
            },
            assistant_text="好的",
            draft_card=None,
        )

        self.assertEqual(
            created[0].content_json["selected_resume"],
            {
                "resume_id": "resume-1",
                "resume_name": "AI产品经理简历",
                "jd_context": "J" * 4000 + "...",
                "context_source": "explicit_resume_picker",
                "selection": {
                    "mode": "subset",
                    "experienceIds": ["exp-1"],
                    "moduleIds": ["exp-exp-1"],
                },
                "snapshot": {
                    "experiences": [
                        {
                            "id": "exp-1",
                            "title": "产品经理",
                            "org": "某公司",
                            "star": {"a": "A" * 500 + "..."},
                        }
                    ],
                    "educations": [
                        {"id": "edu-1", "school": "某大学", "major": "计算机科学", "degree": "本科"}
                    ],
                    "certifications": [],
                    "skills": [{"id": "skill-1", "name": "需求分析", "category": "产品"}],
                },
            },
        )


class AssistantStarNormalizationTests(unittest.TestCase):
    def test_merge_star_payload_strips_action_numbering_before_persist(self) -> None:
        merged = assistant_service._merge_star_payload(
            {
                "a": "1. 搭建智能润色链路 2. 重构登录转化流程 3. 基于埋点持续迭代",
            },
            ExperienceCategory.PROJECT,
        )

        self.assertEqual(
            merged["a"],
            "搭建智能润色链路\n重构登录转化流程\n基于埋点持续迭代",
        )

    def test_merge_star_payload_keeps_version_prefixed_action_text(self) -> None:
        merged = assistant_service._merge_star_payload(
            {
                "a": "2.0 版本重构登录转化流程",
            },
            ExperienceCategory.PROJECT,
        )

        self.assertEqual(merged["a"], "2.0 版本重构登录转化流程")

    def test_merge_star_payload_keeps_education_courses_text(self) -> None:
        merged = assistant_service._merge_star_payload(
            {
                "a": "高等数学\n数据结构",
            },
            ExperienceCategory.EDUCATION,
        )

        self.assertEqual(merged["courses"], "高等数学\n数据结构")

    def test_merge_star_payload_maps_education_draft_fields_for_persisted_versions(self) -> None:
        merged = assistant_service._merge_star_payload(
            {
                "s": "本科",
                "t": "3.46/4.0",
                "a": "测试课程（90）",
                "r": "",
            },
            ExperienceCategory.EDUCATION,
        )

        self.assertEqual(merged["degree"], "本科")
        self.assertEqual(merged["gpa"], "3.46/4.0")
        self.assertEqual(merged["courses"], "测试课程（90）")
        self.assertNotIn("s", merged)
        self.assertNotIn("t", merged)
        self.assertNotIn("a", merged)
        self.assertNotIn("r", merged)

    def test_merge_star_payload_preserves_legacy_education_values_when_draft_is_blank(self) -> None:
        latest_version = SimpleNamespace(
            star={
                "s": "本科",
                "t": "3.46/4.0",
                "a": "测试课程（90）",
                "r": "完成核心课程",
            }
        )

        merged = assistant_service._merge_star_payload(
            {
                "s": "",
                "t": "",
                "a": "",
                "r": "",
            },
            ExperienceCategory.EDUCATION,
            latest_version,
        )

        self.assertEqual(merged["degree"], "本科")
        self.assertEqual(merged["gpa"], "3.46/4.0")
        self.assertEqual(merged["courses"], "测试课程（90）")
        self.assertNotIn("s", merged)
        self.assertNotIn("t", merged)
        self.assertNotIn("a", merged)
        self.assertNotIn("r", merged)


if __name__ == "__main__":
    unittest.main()
