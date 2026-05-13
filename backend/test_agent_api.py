import os
import json
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.models import ExperienceCategory  # noqa: E402
from app import database  # noqa: E402
from app.domain.agent import agent_router, agent_service  # noqa: E402
from app.domain.export.browser_pdf_service import (  # noqa: E402
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
)


class _ScalarResult:
    def __init__(self, *, first=None, all_values=None):
        self._first = first
        self._all_values = all_values or []

    def first(self):
        return self._first

    def all(self):
        return self._all_values


class _ExecuteResult:
    def __init__(self, *, first=None, all_values=None):
        self._scalars = _ScalarResult(first=first, all_values=all_values)

    def scalars(self):
        return self._scalars


class _FakeSession:
    def __init__(self, execute_results=None):
        self.execute = AsyncMock(side_effect=execute_results or [])
        self.commit = AsyncMock()
        self.flush = AsyncMock()
        self.refresh = AsyncMock()
        self.rollback = AsyncMock()
        self.added = []

    def add(self, item):
        self.added.append(item)


class AgentPluginConfigTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_config_returns_defaults_when_missing(self) -> None:
        session = _FakeSession([_ExecuteResult(first=None)])

        result = await agent_service.get_agent_plugin_config(session, "user-1")

        self.assertEqual(result.selected_template_id, "modern-slate")
        self.assertTrue(result.polish_before_output)
        self.assertEqual(result.polish_level, "标准")
        self.assertTrue(result.force_one_page)

    async def test_upsert_config_creates_server_side_config(self) -> None:
        session = _FakeSession([_ExecuteResult(first=None)])
        payload = agent_router.AgentPluginConfigUpdate(
            selected_template_id="accent-emerald",
            polish_before_output=False,
            polish_level="保守",
            force_one_page=False,
        )

        result = await agent_service.upsert_agent_plugin_config(session, "user-1", payload)

        self.assertEqual(result.selected_template_id, "accent-emerald")
        self.assertFalse(result.polish_before_output)
        self.assertEqual(result.polish_level, "保守")
        self.assertFalse(result.force_one_page)
        self.assertEqual(len(session.added), 1)
        session.commit.assert_awaited_once()

    async def test_resolve_generate_options_uses_server_config_but_always_enables_smart_one_page(self) -> None:
        record = SimpleNamespace(
            user_id="user-1",
            selected_template_id="avatar-split",
            polish_before_output=False,
            polish_level="增强",
            force_one_page=False,
            updated_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
        )
        session = _FakeSession([_ExecuteResult(first=record)])
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )

        result = await agent_service.resolve_agent_generate_options(session, "user-1", payload)

        self.assertEqual(result.template_id, "avatar-split")
        self.assertFalse(result.polish_before_output)
        self.assertEqual(result.polish_level, "增强")
        self.assertTrue(result.force_one_page)


class AgentApiKeyServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_key_stores_plaintext_for_reuse_until_refresh(self) -> None:
        session = _FakeSession([_ExecuteResult(all_values=[])])

        result = await agent_service.create_agent_api_key(
            session,
            user_id="user-1",
            name="Mac Agent",
        )

        self.assertTrue(result.plaintext_key.startswith("rfag_"))
        self.assertEqual(result.read.name, "Mac Agent")
        self.assertEqual(len(session.added), 1)
        stored = session.added[0]
        self.assertEqual(stored.user_id, "user-1")
        self.assertEqual(stored.key_prefix, result.read.key_prefix)
        self.assertNotEqual(stored.key_hash, result.plaintext_key)
        self.assertEqual(stored.key_plaintext, result.plaintext_key)
        self.assertEqual(result.read.key, result.plaintext_key)
        self.assertTrue(agent_service.verify_agent_api_key_hash(result.plaintext_key, stored.key_hash))
        session.commit.assert_awaited_once()
        session.refresh.assert_awaited_once_with(stored)

    async def test_create_key_returns_existing_active_key_without_refresh(self) -> None:
        record = SimpleNamespace(
            id="key-1",
            user_id="user-1",
            name="Agent",
            key_prefix="rfag_abc",
            key_hash=agent_service.hash_agent_api_key("rfag_abc-secret"),
            key_plaintext="rfag_abc-secret",
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=None,
        )
        session = _FakeSession([_ExecuteResult(all_values=[record])])

        result = await agent_service.create_agent_api_key(session, "user-1", "Agent")

        self.assertEqual(result.plaintext_key, "rfag_abc-secret")
        self.assertEqual(result.read.key, "rfag_abc-secret")
        self.assertEqual(session.added, [])
        session.commit.assert_not_awaited()

    async def test_create_key_requires_refresh_for_legacy_hash_only_key(self) -> None:
        record = SimpleNamespace(
            id="key-1",
            user_id="user-1",
            name="Agent",
            key_prefix="rfag_old",
            key_hash=agent_service.hash_agent_api_key("rfag_old-secret"),
            key_plaintext=None,
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=None,
        )
        session = _FakeSession([_ExecuteResult(all_values=[record])])

        with self.assertRaises(HTTPException) as context:
            await agent_service.create_agent_api_key(session, "user-1", "Agent")

        self.assertEqual(context.exception.status_code, 409)
        self.assertIsNone(record.revoked_at)
        self.assertEqual(session.added, [])
        session.commit.assert_not_awaited()

    async def test_create_key_recovers_from_active_key_unique_conflict(self) -> None:
        winning_record = SimpleNamespace(
            id="key-1",
            user_id="user-1",
            name="Agent",
            key_prefix="rfag_win",
            key_hash=agent_service.hash_agent_api_key("rfag_win-secret"),
            key_plaintext="rfag_win-secret",
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=None,
        )
        session = _FakeSession([
            _ExecuteResult(all_values=[]),
            _ExecuteResult(all_values=[winning_record]),
        ])
        session.commit = AsyncMock(
            side_effect=IntegrityError("insert agent_api_keys", {}, Exception("duplicate active key"))
        )

        result = await agent_service.create_agent_api_key(session, "user-1", "Agent")

        self.assertEqual(result.plaintext_key, "rfag_win-secret")
        self.assertEqual(result.read.key, "rfag_win-secret")
        session.rollback.assert_awaited_once()

    async def test_create_key_refresh_revokes_existing_and_creates_new_key(self) -> None:
        record = SimpleNamespace(
            id="key-1",
            user_id="user-1",
            name="Agent",
            key_prefix="rfag_old",
            key_hash=agent_service.hash_agent_api_key("rfag_old-secret"),
            key_plaintext="rfag_old-secret",
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=None,
        )
        session = _FakeSession([_ExecuteResult(all_values=[record])])

        result = await agent_service.create_agent_api_key(session, "user-1", "Agent", rotate=True)

        self.assertIsNotNone(record.revoked_at)
        self.assertIsNone(record.key_plaintext)
        self.assertEqual(len(session.added), 2)
        self.assertIs(session.added[0], record)
        self.assertNotEqual(result.plaintext_key, "rfag_old-secret")
        self.assertEqual(session.added[1].key_plaintext, result.plaintext_key)
        session.commit.assert_awaited_once()

    async def test_list_keys_returns_current_users_stored_plaintext_key(self) -> None:
        record = SimpleNamespace(
            id="key-1",
            name="Agent",
            key_prefix="rfag_abc",
            key_plaintext="rfag_abc-secret",
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=None,
        )
        session = _FakeSession([_ExecuteResult(all_values=[record])])

        result = await agent_service.list_agent_api_keys(session, "user-1")

        self.assertEqual(result[0].key, "rfag_abc-secret")

    async def test_list_keys_never_returns_revoked_plaintext_key(self) -> None:
        revoked_record = SimpleNamespace(
            id="key-1",
            name="Agent",
            key_prefix="rfag_old",
            key_plaintext="rfag_old-secret",
            created_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
            last_used_at=None,
            revoked_at=datetime(2026, 5, 7, tzinfo=timezone.utc),
        )
        session = _FakeSession([_ExecuteResult(all_values=[revoked_record])])

        result = await agent_service.list_agent_api_keys(session, "user-1")

        self.assertIsNone(result[0].key)

    def test_agent_key_table_enforces_one_active_key_per_user(self) -> None:
        source = database.ensure_agent_api_keys_table.__code__.co_consts
        migration_sql = "\n".join(item for item in source if isinstance(item, str))

        self.assertIn("uniq_agent_api_keys_active_user", migration_sql)
        self.assertIn("WHERE revoked_at IS NULL", migration_sql)

    async def test_persist_generated_resume_does_not_copy_links_when_snapshot_empty(self) -> None:
        session = _FakeSession()
        source_resume = SimpleNamespace(config={})
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_前端实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.35,
            fontSize=11,
            listSpacingValue="0.2em",
            bulletSpacingValue="0.2em",
            topPaddingPx=15,
            sectionSpacingClass="mb-2",
            listSpacingClass="space-y-1",
            sectionOrder=[],
            selectedWorkItems=[],
            selectedProjectItems=[],
            educations=[],
        )
        resume_items = [
            SimpleNamespace(
                experience=SimpleNamespace(master_experience_id="master-hidden"),
                experience_version_id=str(agent_service.uuid.uuid4()),
                overrides_json={},
                display_order=0,
            )
        ]

        await agent_service._persist_agent_generated_resume(
            session,
            "user-1",
            source_resume=source_resume,
            resume_items=resume_items,
            snapshot=snapshot,
            payload=payload,
            analysis=analysis,
        )

        self.assertEqual(len(session.added), 1)
        self.assertEqual(session.added[0].title, "示例公司 - 前端实习 [Agent]")

    def test_skill_bundle_returns_server_side_skill_files(self) -> None:
        result = agent_service.build_agent_skill_bundle()

        self.assertEqual(result.name, "resumeflow-job-search")
        paths = {item.path for item in result.files}
        self.assertIn("SKILL.md", paths)
        self.assertIn("references/api.md", paths)
        self.assertIn("agents/openai.yaml", paths)

    def test_skill_bundle_documents_agent_options_and_account_binding(self) -> None:
        result = agent_service.build_agent_skill_bundle()
        files = {item.path: item.content for item in result.files}

        self.assertIn("/agent/v1/resume-templates", files["references/api.md"])
        self.assertIn("/agent/v1/polish-options", files["references/api.md"])
        self.assertIn("API Key 对应的 ResumeFLOW 用户账号", files["references/api.md"])
        self.assertIn("每个用户保留一个可复制的 Agent API Key", files["references/api.md"])
        self.assertIn("save the API base URL and API key locally", files["SKILL.md"])
        self.assertIn("persist the supplied API base URL and full API key", files["references/api.md"])
        self.assertIn("excluded from version control", files["references/api.md"])
        self.assertIn("获取模板选项和润色选项", files["SKILL.md"])
        self.assertIn("job-link.md", files["SKILL.md"])
        self.assertIn("[Open job posting](https://example.com/jobs/123)", files["SKILL.md"])
        self.assertIn("Do not save the recruiting page HTML", files["SKILL.md"])
        self.assertNotIn("job.html", files["SKILL.md"])

    def test_resume_template_options_match_agent_contract(self) -> None:
        result = agent_service.build_agent_resume_template_options()

        self.assertEqual(result.default_template_id, "modern-slate")
        self.assertEqual(
            [item.id for item in result.templates],
            [
                "modern-slate",
                "minimal-gray",
                "accent-emerald",
                "avatar-professional",
                "avatar-split",
                "modern-slate-avatar",
            ],
        )
        self.assertEqual(result.templates[0].name, "现代深灰")
        self.assertFalse(result.templates[0].has_avatar)
        self.assertEqual(result.templates[0].default_theme_color_preset_id, "slate")

    def test_polish_options_include_disabled_and_all_levels(self) -> None:
        result = agent_service.build_agent_polish_options()

        self.assertTrue(result.default_polish_before_output)
        self.assertEqual(result.default_polish_level, "标准")
        self.assertEqual(
            [(item.id, item.polish_before_output, item.polish_level) for item in result.options],
            [
                ("disabled", False, None),
                ("conservative", True, "保守"),
                ("standard", True, "标准"),
                ("enhanced", True, "增强"),
                ("strong-match", True, "强匹配"),
            ],
        )

    async def test_verify_key_rejects_revoked_or_wrong_key(self) -> None:
        key = "rfag_test-secret"
        revoked_record = SimpleNamespace(
            user_id="user-1",
            key_hash=agent_service.hash_agent_api_key(key),
            revoked_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
            last_used_at=None,
        )
        session = _FakeSession([_ExecuteResult(first=revoked_record)])

        with self.assertRaises(HTTPException) as revoked_error:
            await agent_service.authenticate_agent_api_key(session, key)

        self.assertEqual(revoked_error.exception.status_code, 401)

        active_record = SimpleNamespace(
            user_id="user-1",
            key_hash=agent_service.hash_agent_api_key("rfag_other-secret"),
            revoked_at=None,
            last_used_at=None,
        )
        session = _FakeSession([_ExecuteResult(first=active_record)])

        with self.assertRaises(HTTPException) as wrong_key_error:
            await agent_service.authenticate_agent_api_key(session, key)

        self.assertEqual(wrong_key_error.exception.status_code, 401)


class AgentJobEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_analyze_endpoint_returns_match_evaluation_and_folder_name(self) -> None:
        payload = agent_router.AgentJobRequest(
            job_title="前端实习生",
            company_name="字节跳动",
            jd_text="React TypeScript 实习岗位",
            job_url="https://example.com/jobs/1",
        )
        expected = agent_router.AgentJobAnalysisResponse(
            match_percentage=88,
            evaluation="岗位匹配度较高，建议投递。",
            strengths=["React 经验匹配"],
            gaps=["缺少大型团队协作描述"],
            missing_keywords=["TypeScript"],
            recommendation="generate",
            suggested_folder_name="字节跳动_前端实习生_88",
        )

        expected_build = agent_router.AgentJobAnalysisBuild(response=expected, raw_result={})
        with patch.object(
            agent_router,
            "build_agent_job_analysis_detail",
            AsyncMock(return_value=expected_build),
        ) as mocked:
            result = await agent_router.analyze_agent_job(
                payload,
                session=SimpleNamespace(),
                agent_user=SimpleNamespace(id="user-1"),
            )

        self.assertEqual(result, expected)
        mocked.assert_awaited_once()
        self.assertEqual(mocked.await_args.args[1], "user-1")
        self.assertEqual(mocked.await_args.args[2].company_name, "字节跳动")

    async def test_analyze_endpoint_returns_bad_gateway_for_invalid_ai_json(self) -> None:
        payload = agent_router.AgentJobRequest(
            job_title="前端实习生",
            company_name="字节跳动",
            jd_text="React TypeScript 实习岗位",
            job_url="https://example.com/jobs/1",
        )

        with self.assertLogs(agent_router.logger, level="WARNING") as logs:
            with patch.object(
                agent_router,
                "build_agent_job_analysis_detail",
                AsyncMock(side_effect=ValueError("Invalid JSON returned by model")),
            ):
                with self.assertRaises(HTTPException) as context:
                    await agent_router.analyze_agent_job(
                        payload,
                        session=SimpleNamespace(),
                        agent_user=SimpleNamespace(id="user-1"),
                    )

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("AI analysis returned invalid JSON", context.exception.detail)
        self.assertIn("invalid AI payload", "\n".join(logs.output))

    async def test_generate_endpoint_returns_pdf_link_and_job_metadata(self) -> None:
        payload = agent_router.AgentJobGenerateRequest(
            job_title="AI 产品实习",
            company_name="某科技",
            jd_text="AI 产品经理实习岗位",
            job_url="https://example.com/jobs/2",
            source="shixiseng",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=91,
            evaluation="强匹配。",
            strengths=["AI 项目经验"],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="某科技_AI 产品实习_91",
        )
        pdf = agent_router.AgentResumePdf(
            download_url="/exports/download/resume-pdf/export-1?token=abc",
            file_name="某科技_AI 产品实习_91.pdf",
        )

        analysis_build = agent_router.AgentJobAnalysisBuild(
            response=analysis,
            raw_result={"experienceMatches": []},
        )
        with patch.object(agent_router, "build_agent_job_analysis_detail", AsyncMock(return_value=analysis_build)):
            with patch.object(agent_router, "build_agent_resume_pdf", AsyncMock(return_value=pdf)):
                result = await agent_router.generate_agent_job_resume(
                    payload,
                    request=SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                    session=SimpleNamespace(),
                    agent_user=SimpleNamespace(id="user-1"),
                )

        self.assertEqual(result.match_percentage, 91)
        self.assertEqual(result.resume_pdf, pdf)
        self.assertEqual(result.job_link_url, "https://example.com/jobs/2")
        self.assertEqual(result.job_metadata.company_name, "某科技")
        self.assertEqual(result.job_metadata.source, "shixiseng")

    async def test_generate_endpoint_maps_pdf_render_errors(self) -> None:
        payload = agent_router.AgentJobGenerateRequest(
            job_title="AI 产品实习",
            company_name="某科技",
            jd_text="AI 产品经理实习岗位",
            job_url="https://example.com/jobs/2",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=91,
            evaluation="强匹配。",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="某科技_AI 产品实习_91",
        )
        analysis_build = agent_router.AgentJobAnalysisBuild(
            response=analysis,
            raw_result={"experienceMatches": []},
        )

        cases = [
            (BrowserPdfRenderTimeoutError("PDF render timed out"), 504, "PDF render timed out"),
            (BrowserPdfRenderError("Chromium PDF 渲染失败。"), 502, "Chromium PDF 渲染失败。"),
        ]
        for error, expected_status, expected_detail in cases:
            with self.subTest(expected_status=expected_status):
                with patch.object(
                    agent_router,
                    "build_agent_job_analysis_detail",
                    AsyncMock(return_value=analysis_build),
                ):
                    with patch.object(
                        agent_router,
                        "build_agent_resume_pdf",
                        AsyncMock(side_effect=error),
                    ):
                        with self.assertLogs(agent_router.logger, level="WARNING"):
                            with self.assertRaises(HTTPException) as context:
                                await agent_router.generate_agent_job_resume(
                                    payload,
                                    request=SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                    session=SimpleNamespace(),
                                    agent_user=SimpleNamespace(id="user-1"),
                                )

            self.assertEqual(context.exception.status_code, expected_status)
            self.assertEqual(context.exception.detail, expected_detail)

    async def test_resume_template_options_endpoint_returns_options_for_agent_user(self) -> None:
        expected = agent_router.AgentResumeTemplateOptionsResponse(
            default_template_id="modern-slate",
            templates=[
                agent_router.AgentResumeTemplateOption(
                    id="modern-slate",
                    name="现代深灰",
                    description="ATS 友好的成熟单栏模板，结构清晰稳重。",
                    has_avatar=False,
                    default_theme_color_preset_id="slate",
                )
            ],
        )

        with patch.object(agent_router, "build_agent_resume_template_options", return_value=expected):
            result = await agent_router.get_agent_resume_templates(
                agent_user=SimpleNamespace(id="user-1"),
            )

        self.assertEqual(result, expected)

    async def test_polish_options_endpoint_returns_options_for_agent_user(self) -> None:
        expected = agent_router.AgentPolishOptionsResponse(
            default_polish_before_output=True,
            default_polish_level="标准",
            options=[
                agent_router.AgentPolishOption(
                    id="disabled",
                    label="不启用",
                    polish_before_output=False,
                    polish_level=None,
                    description="不生成新的个人总结润色内容，保留原简历已有内容。",
                )
            ],
        )

        with patch.object(agent_router, "build_agent_polish_options", return_value=expected):
            result = await agent_router.get_agent_polish_options(
                agent_user=SimpleNamespace(id="user-1"),
            )

        self.assertEqual(result, expected)

    async def test_resolve_resume_uses_latest_when_resume_id_missing(self) -> None:
        latest_resume = SimpleNamespace(id="resume-latest")
        session = _FakeSession([_ExecuteResult(all_values=[latest_resume])])

        result = await agent_service.resolve_agent_resume(session, "user-1", None)

        self.assertIs(result, latest_resume)
        session.execute.assert_awaited_once()

    async def test_resume_analysis_text_serializes_agent_bank_as_plain_json(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端")
        profile = SimpleNamespace(
            full_name="张三",
            title="前端工程师",
            summary="React 开发",
            location="上海",
            email="zhang@example.com",
            phone="123",
            social_links={"GitHub": {"url": "https://github.com/example"}},
        )
        master = SimpleNamespace(id="exp-master-1", category=ExperienceCategory.WORK)
        version = SimpleNamespace(
            id="exp-version-1",
            title="前端实习",
            org="示例公司",
            start_date=None,
            end_date=None,
            is_current=True,
            summary="负责 React 页面",
            star={"r": "上线"},
            tags=["React"],
        )
        cert = SimpleNamespace(
            id="cert-1",
            name="英语六级",
            issuer="CET",
            issue_date=None,
            description="",
        )
        user_skill = SimpleNamespace(id="skill-link-1", proficiency="熟练")
        skill = SimpleNamespace(name="TypeScript", category="前端")
        bank = {
            "profile": profile,
            "experiences": [(master, version)],
            "certifications": [cert],
            "skills": [(user_skill, skill)],
        }

        with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
            result = await agent_service.build_resume_analysis_text(SimpleNamespace(), "user-1", resume)

        self.assertIn('"full_name": "张三"', result)
        self.assertIn('"title": "前端实习"', result)
        self.assertIn('"name": "英语六级"', result)
        self.assertIn('"name": "TypeScript"', result)

    async def test_agent_analysis_uses_selected_resume_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"selection": {"experienceIds": ["master-selected"]}},
        )
        payload = agent_router.AgentJobRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        selected_master = SimpleNamespace(id="master-selected", category=ExperienceCategory.WORK)
        hidden_master = SimpleNamespace(id="master-hidden", category=ExperienceCategory.WORK)
        selected_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-selected",
                id="version-selected",
                title="已选工作",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="应该参与分析",
                star={"r": "已选结果"},
                tags=["React"],
            )
        )
        hidden_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-hidden",
                id="version-hidden",
                title="隐藏工作",
                org="隐藏公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="不应参与分析",
                star={"r": "隐藏结果"},
                tags=["Python"],
            )
        )
        bank = {
            "profile": None,
            "experiences": [
                (selected_master, SimpleNamespace(id="version-selected")),
                (hidden_master, SimpleNamespace(id="version-hidden")),
            ],
            "certifications": [],
            "skills": [],
        }

        with patch.object(agent_service, "resolve_agent_resume", AsyncMock(return_value=resume)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, [selected_item, hidden_item]))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(
                        agent_service,
                        "analyze_jd",
                        AsyncMock(return_value={"matchPercentage": 88, "summary": "匹配"}),
                    ) as mocked_analyze:
                        await agent_service.build_agent_job_analysis(SimpleNamespace(), "user-1", payload)

        resume_text = mocked_analyze.await_args.kwargs["resume_text"]
        parsed = json.loads(resume_text)
        self.assertEqual([item["title"] for item in parsed["work_experiences"]], ["已选工作"])
        self.assertNotIn("隐藏工作", resume_text)

    async def test_agent_analysis_includes_selected_bank_item_without_resume_link(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"selection": {"experienceIds": ["master-linked", "master-auto-selected"]}},
        )
        payload = agent_router.AgentJobRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品实习 JD",
            job_url="https://example.com/jobs/1",
        )
        linked_master = SimpleNamespace(id="master-linked", category=ExperienceCategory.WORK)
        auto_selected_master = SimpleNamespace(id="master-auto-selected", category=ExperienceCategory.WORK)
        linked_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-linked",
                id="version-linked",
                title="已链接经历",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="已链接",
                star={"r": "已链接结果"},
                tags=[],
            )
        )
        bank = {
            "profile": None,
            "experiences": [
                (linked_master, SimpleNamespace(id="version-linked")),
                (
                    auto_selected_master,
                    SimpleNamespace(
                        id="version-auto-selected",
                        title="一键组装选中但未链接",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="应参与分析",
                        star={"r": "自动选中结果"},
                        tags=[],
                    ),
                ),
            ],
            "certifications": [],
            "skills": [],
        }

        with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, [linked_item]))):
            with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                with patch.object(
                    agent_service,
                    "analyze_jd",
                    AsyncMock(return_value={"matchPercentage": 88, "summary": "匹配"}),
                ) as mocked_analyze:
                    await agent_service.build_agent_job_analysis(SimpleNamespace(), "user-1", payload)

        parsed = json.loads(mocked_analyze.await_args.kwargs["resume_text"])
        self.assertEqual(
            [item["title"] for item in parsed["work_experiences"]],
            ["已链接经历", "一键组装选中但未链接"],
        )

    async def test_agent_analysis_uses_local_resume_profile(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "profileSyncMode": "local",
                "profile": {
                    "name": "本地姓名",
                    "email": "local@example.com",
                    "phone": "18800000000",
                    "location": "深圳",
                    "linkedin": "https://linkedin.example/local",
                },
            },
        )
        payload = agent_router.AgentJobRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        global_profile = SimpleNamespace(
            full_name="全局姓名",
            title="全局标题",
            summary="全局摘要",
            location="上海",
            email="global@example.com",
            phone="16600000000",
            social_links={},
        )
        bank = {"profile": global_profile, "experiences": [], "certifications": [], "skills": []}

        with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, []))):
            with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                with patch.object(
                    agent_service,
                    "analyze_jd",
                    AsyncMock(return_value={"matchPercentage": 88, "summary": "匹配"}),
                ) as mocked_analyze:
                    await agent_service.build_agent_job_analysis(SimpleNamespace(), "user-1", payload)

        parsed = json.loads(mocked_analyze.await_args.kwargs["resume_text"])
        self.assertEqual(parsed["profile"]["full_name"], "本地姓名")
        self.assertEqual(parsed["profile"]["email"], "local@example.com")
        self.assertNotEqual(parsed["profile"]["full_name"], "全局姓名")

    async def test_agent_analysis_preserves_empty_resume_personal_summary(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"personalSummary": ""},
        )
        payload = agent_router.AgentJobRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        global_profile = SimpleNamespace(
            full_name="全局姓名",
            title="全局标题",
            summary="全局摘要",
            location="上海",
            email="global@example.com",
            phone="16600000000",
            social_links={},
        )
        bank = {"profile": global_profile, "experiences": [], "certifications": [], "skills": []}

        with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, []))):
            with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                with patch.object(
                    agent_service,
                    "analyze_jd",
                    AsyncMock(return_value={"matchPercentage": 88, "summary": "匹配"}),
                ) as mocked_analyze:
                    await agent_service.build_agent_job_analysis(SimpleNamespace(), "user-1", payload)

        parsed = json.loads(mocked_analyze.await_args.kwargs["resume_text"])
        self.assertEqual(parsed["profile"]["summary"], "")
        self.assertNotIn("全局摘要", mocked_analyze.await_args.kwargs["resume_text"])

    async def test_agent_analysis_falls_back_to_bank_when_resume_has_no_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"selection": {"experienceIds": ["master-selected"]}},
        )
        selected_master = SimpleNamespace(id="master-selected", category=ExperienceCategory.WORK)
        hidden_master = SimpleNamespace(id="master-hidden", category=ExperienceCategory.WORK)
        selected_version = SimpleNamespace(
            id="version-selected",
            title="已选工作",
            org="示例公司",
            start_date=None,
            end_date=None,
            is_current=False,
            summary="应该参与分析",
            star={"r": "已选结果"},
            tags=["React"],
        )
        hidden_version = SimpleNamespace(
            id="version-hidden",
            title="隐藏工作",
            org="隐藏公司",
            start_date=None,
            end_date=None,
            is_current=False,
            summary="不应参与分析",
            star={"r": "隐藏结果"},
            tags=["Python"],
        )
        bank = {
            "profile": None,
            "experiences": [(selected_master, selected_version), (hidden_master, hidden_version)],
            "certifications": [],
            "skills": [],
        }

        result = await agent_service.build_resume_analysis_text(
            SimpleNamespace(),
            "user-1",
            resume,
            resume_items=[],
            bank=bank,
            category_by_master_id={},
        )

        parsed = json.loads(result)
        self.assertEqual([item["title"] for item in parsed["work_experiences"]], ["已选工作"])
        self.assertNotIn("隐藏工作", result)

    def test_default_agent_pdf_snapshot_uses_certifications_section_id(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "")

        self.assertIn("certifications", snapshot.sectionOrder)
        self.assertNotIn("certification", snapshot.sectionOrder)

    async def test_personal_summary_passes_polish_level_to_ai(self) -> None:
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="强匹配",
            force_one_page=True,
        )

        with patch.object(
            agent_service,
            "generate_personal_summary",
            AsyncMock(return_value={"summary": "定制摘要"}),
        ) as mocked:
            result = await agent_service._build_personal_summary(bank, payload, options)

        self.assertEqual(result, "定制摘要")
        self.assertEqual(mocked.await_args.kwargs["polish_level"], "强匹配")

    async def test_star_polish_maps_strong_match_level_to_ai_mode(self) -> None:
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="强匹配",
            force_one_page=True,
        )
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_前端实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.6,
            fontSize=16,
            listSpacingValue="1em",
            bulletSpacingValue="1em",
            topPaddingPx=75.59,
            sectionSpacingClass="mb-6",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[
                agent_service.ResumeExperienceViewSnapshot(
                    id="master-1",
                    title="前端项目",
                    company="示例公司",
                    date="",
                    star=agent_service.StarFields(
                        s="原背景",
                        t="原任务",
                        a="原行动",
                        r="原结果",
                    ),
                    category="work",
                )
            ],
            selectedProjectItems=[],
            educations=[],
        )

        with patch.object(
            agent_service,
            "polish_experience",
            AsyncMock(return_value={
                "s": "新背景",
                "t": "新任务",
                "a": "新行动",
                "r": "新结果",
            }),
        ) as mocked:
            await agent_service._polish_snapshot_experiences(snapshot, payload, options)

        self.assertEqual(mocked.await_args.kwargs["mode"], "strong_match")

    async def test_personal_summary_orders_selected_experiences_by_match_score(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={"selection": {"experienceIds": ["master-2", "master-3", "master-4"]}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id=f"master-{index}", category=ExperienceCategory.WORK),
                    SimpleNamespace(
                        id=f"version-{index}",
                        title=f"经历 {index}",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"r": f"结果 {index}"},
                        tags=[],
                    ),
                )
                for index in [4, 1, 3, 2]
            ],
            "certifications": [],
            "skills": [],
        }
        resume_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-3",
                title="已链接经历 3",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="",
                star={"r": "已链接结果 3"},
                tags=[],
            )
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=True,
        )

        with patch.object(
            agent_service,
            "generate_personal_summary",
            AsyncMock(return_value={"summary": "定制摘要"}),
        ) as mocked:
            result = await agent_service._build_personal_summary(
                bank,
                payload,
                options,
                resume=resume,
                resume_items=[resume_item],
                category_by_master_id={},
            )

        self.assertEqual(result, "定制摘要")
        self.assertEqual(
            [item["title"] for item in mocked.await_args.kwargs["work_experiences"]],
            ["经历 2", "已链接经历 3", "经历 4"],
        )

    async def test_personal_summary_prefers_layout_orders_over_selection_order(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={
                "selection": {"experienceIds": ["master-2", "master-3", "master-4"]},
                "layout": {
                    "orders": {
                        "workExperienceIds": ["master-4", "master-3", "master-2"],
                    }
                },
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id=f"master-{index}", category=ExperienceCategory.WORK),
                    SimpleNamespace(
                        id=f"version-{index}",
                        title=f"经历 {index}",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"r": f"结果 {index}"},
                        tags=[],
                    ),
                )
                for index in [2, 3, 4]
            ],
            "certifications": [],
            "skills": [],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=True,
        )

        with patch.object(
            agent_service,
            "generate_personal_summary",
            AsyncMock(return_value={"summary": "定制摘要"}),
        ) as mocked:
            result = await agent_service._build_personal_summary(
                bank,
                payload,
                options,
                resume=resume,
                resume_items=[],
                category_by_master_id={},
            )

        self.assertEqual(result, "定制摘要")
        self.assertEqual(
            [item["title"] for item in mocked.await_args.kwargs["work_experiences"]],
            ["经历 4", "经历 3", "经历 2"],
        )

    async def test_personal_summary_skips_ai_when_summary_hidden(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"layout": {"isSummaryVisible": False}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="强匹配",
            force_one_page=True,
        )

        with patch.object(
            agent_service,
            "generate_personal_summary",
            AsyncMock(return_value={"summary": "不应生成"}),
        ) as mocked:
            result = await agent_service._build_personal_summary(
                bank,
                payload,
                options,
                resume=resume,
            )

        self.assertEqual(result, "")
        mocked.assert_not_awaited()

    async def test_personal_summary_preserves_empty_resume_summary_override(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"personalSummary": ""},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="全局摘要",
            location="",
            email="",
            phone="",
            social_links={},
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=False,
        )

        with patch.object(
            agent_service,
            "generate_personal_summary",
            AsyncMock(return_value={"summary": "定制摘要"}),
        ) as mocked:
            result = await agent_service._build_personal_summary(
                bank,
                payload,
                options,
                resume=resume,
            )

        self.assertEqual(result, "定制摘要")
        self.assertEqual(mocked.await_args.kwargs["profile"]["summary"], "")

    async def test_agent_pdf_snapshot_keeps_resume_summary_when_polish_disabled(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"profile": {"summary": "简历级摘要"}},
        )
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="全局摘要",
            location="",
            email="",
            phone="",
            social_links={},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="标准",
            force_one_page=True,
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        personal_summary = await agent_service._build_personal_summary(bank, payload, options)
        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            personal_summary,
            options,
        )

        self.assertEqual(snapshot.profile.summary, "简历级摘要")

    async def test_agent_pdf_snapshot_uses_resume_personal_summary_when_polish_disabled(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"personalSummary": "独立个人摘要"},
        )
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="全局摘要",
            location="",
            email="",
            phone="",
            social_links={},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="标准",
            force_one_page=True,
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        personal_summary = await agent_service._build_personal_summary(bank, payload, options)
        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            personal_summary,
            options,
        )

        self.assertEqual(snapshot.profile.summary, "独立个人摘要")

    async def test_agent_generation_summary_uses_selected_resume_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "selection": {
                    "experienceIds": ["master-selected"],
                    "certificationIds": ["cert-selected"],
                    "skillIds": ["skill-link-selected"],
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        selected_master = SimpleNamespace(id="master-selected", category=ExperienceCategory.WORK)
        hidden_master = SimpleNamespace(id="master-hidden", category=ExperienceCategory.WORK)
        selected_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-selected",
                id="version-selected",
                title="已选工作",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="已选摘要",
                star={"r": "已选结果"},
                tags=["React"],
            )
        )
        hidden_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-hidden",
                id="version-hidden",
                title="隐藏工作",
                org="隐藏公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="不应进入摘要",
                star={"r": "隐藏结果"},
                tags=["Python"],
            )
        )
        selected_cert = SimpleNamespace(id="cert-selected", name="已选证书", issuer="Issuer", issue_date=None, description="")
        hidden_cert = SimpleNamespace(id="cert-hidden", name="隐藏证书", issuer="Issuer", issue_date=None, description="")
        selected_skill = (SimpleNamespace(id="skill-link-selected", proficiency="熟练"), SimpleNamespace(name="TypeScript", category="前端"))
        hidden_skill = (SimpleNamespace(id="skill-link-hidden", proficiency="熟练"), SimpleNamespace(name="Python", category="后端"))
        bank = {
            "profile": None,
            "experiences": [
                (selected_master, SimpleNamespace(id="version-selected")),
                (hidden_master, SimpleNamespace(id="version-hidden")),
            ],
            "certifications": [selected_cert, hidden_cert],
            "skills": [selected_skill, hidden_skill],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=True,
        )

        with patch.object(agent_service, "resolve_agent_generate_options", AsyncMock(return_value=options)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, [selected_item, hidden_item]))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(
                        agent_service,
                        "generate_personal_summary",
                        AsyncMock(return_value={"summary": "定制摘要"}),
                    ) as mocked_summary:
                        with patch.object(
                            agent_service,
                            "create_render_snapshot",
                            AsyncMock(return_value=(SimpleNamespace(id="snapshot-1"), "token")),
                        ):
                            with patch.object(
                                agent_service,
                                "_fit_snapshot_to_one_page",
                                AsyncMock(side_effect=lambda _session, _user_id, snapshot, _analysis_result, enabled: snapshot),
                            ):
                                with patch.object(
                                    agent_service,
                                    "_polish_snapshot_experiences",
                                    AsyncMock(side_effect=lambda snapshot, _payload, _options: snapshot),
                                ):
                                    with patch.object(
                                        agent_service,
                                        "_persist_agent_generated_resume",
                                        AsyncMock(return_value=SimpleNamespace(id="generated-resume-1", title="岗位简历")),
                                    ):
                                        await agent_service.build_agent_resume_pdf(
                                            SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                            SimpleNamespace(),
                                            "user-1",
                                            payload,
                                            analysis,
                                        )

        self.assertEqual(
            [item["title"] for item in mocked_summary.await_args.kwargs["work_experiences"]],
            ["已选工作"],
        )
        self.assertEqual(
            [item["name"] for item in mocked_summary.await_args.kwargs["certifications"]],
            ["已选证书"],
        )
        self.assertEqual(
            [item["name"] for item in mocked_summary.await_args.kwargs["skills"]],
            ["TypeScript"],
        )

    async def test_force_one_page_compacts_only_after_default_layout_overflows(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "layout": {
                    "lineHeight": 1.75,
                    "fontSize": 16,
                    "itemSpacingEm": "1.5",
                    "topPaddingPx": 42,
                    "sectionSpacingClass": "mb-8",
                    "listSpacingClass": "space-y-2",
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=True,
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "", options)

        self.assertEqual(snapshot.lineHeight, 1.75)
        self.assertEqual(snapshot.fontSize, 16)
        with patch.object(agent_service, "_render_snapshot_page_count", AsyncMock(side_effect=[2, 1])):
            fitted = await agent_service._fit_snapshot_to_one_page(
                SimpleNamespace(),
                "user-1",
                snapshot,
                None,
                enabled=True,
            )

        self.assertLess(fitted.lineHeight, 1.75)
        self.assertLess(fitted.fontSize, 16)
        self.assertEqual(fitted.sectionSpacingClass, "mb-2")
        self.assertEqual(fitted.listSpacingValue, "0.25em")

    async def test_force_one_page_expands_when_default_layout_fits(self) -> None:
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_产品实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.6,
            fontSize=16,
            listSpacingValue="1em",
            bulletSpacingValue="1em",
            topPaddingPx=75.59,
            sectionSpacingClass="mb-6",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[],
            selectedProjectItems=[],
            educations=[],
        )

        with patch.object(agent_service, "_render_snapshot_page_count", AsyncMock(side_effect=[1, 1, 1, 1, 2])):
            fitted = await agent_service._fit_snapshot_to_one_page(
                SimpleNamespace(),
                "user-1",
                snapshot,
                None,
                enabled=True,
            )

        self.assertGreater(fitted.fontSize, 16)
        self.assertGreater(fitted.lineHeight, 1.6)
        self.assertNotEqual(fitted.sectionSpacingClass, "mb-6")

    def test_expand_layout_candidates_use_discrete_section_spacing_steps(self) -> None:
        candidates = agent_service._expand_snapshot_layout_candidates(
            {
                "lineHeight": 1.6,
                "fontSize": 16,
                "itemSpacingEm": 1,
                "topPaddingPx": 75.59,
                "sectionSpacingKey": 5,
            }
        )

        self.assertEqual(
            [item["sectionSpacingKey"] for item in candidates],
            [6, 8, 10, 12],
        )

    def test_generated_resume_config_persists_final_expanded_layout_values(self) -> None:
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_产品实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.7,
            fontSize=17,
            listSpacingValue="1.5em",
            bulletSpacingValue="1.5em",
            topPaddingPx=85,
            sectionSpacingClass="mb-8",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[],
            selectedProjectItems=[],
            educations=[],
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )

        config = agent_service._build_agent_generated_resume_config({}, snapshot, payload, analysis)

        self.assertEqual(config["layout"]["sectionSpacingKey"], 8)
        self.assertEqual(config["layout"]["itemSpacingEm"], 1.5)
        self.assertEqual(config["layout"]["sectionSpacingClass"], "mb-8")

    def test_agent_auto_assembly_selection_uses_match_scores(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={
                "selection": {
                    "experienceIds": ["old-exp"],
                    "educationIds": ["edu-1"],
                    "certificationIds": ["old-cert"],
                    "skillIds": ["old-skill"],
                },
                "layout": {"density": "standard"},
            },
        )
        analysis_result = {
            "experienceMatches": [
                {"id": "exp-low", "score": 20},
                {"id": "exp-top", "score": 95},
                {"id": "exp-zero", "score": 0},
                {"id": "exp-mid", "score": 88},
                {"id": "exp-third", "score": 70},
                {"id": "exp-fourth", "score": 60},
            ],
            "certificationMatches": [
                {"id": "cert-keep", "score": 81},
                {"id": "cert-drop", "score": 80},
            ],
            "skillMatches": [
                {"id": "skill-keep", "score": 90},
                {"id": "skill-drop", "score": 35},
            ],
        }

        assembled_resume = agent_service._resume_with_agent_auto_assembly_selection(
            resume,
            analysis_result,
        )

        selection = assembled_resume.config["selection"]
        self.assertEqual(selection["experienceIds"], ["exp-top", "exp-mid", "exp-third"])
        self.assertEqual(selection["educationIds"], ["edu-1"])
        self.assertEqual(selection["certificationIds"], ["cert-keep"])
        self.assertEqual(selection["skillIds"], ["skill-keep"])
        self.assertEqual(assembled_resume.config["layout"]["density"], "compact")
        self.assertTrue(assembled_resume.config["layout"]["isSmartPageApplied"])

    async def test_agent_pdf_generation_applies_auto_assembly_selection(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={"selection": {"experienceIds": ["old-exp"]}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )
        analysis_result = {
            "experienceMatches": [
                {"id": "master-1", "score": 10},
                {"id": "master-2", "score": 95},
                {"id": "master-3", "score": 85},
                {"id": "master-4", "score": 75},
            ],
        }
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id=f"master-{index}", category=ExperienceCategory.WORK),
                    SimpleNamespace(
                        id=f"version-{index}",
                        title=f"经历 {index}",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"r": f"结果 {index}"},
                    ),
                )
                for index in [4, 1, 3, 2]
            ],
            "certifications": [],
            "skills": [],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="标准",
            force_one_page=True,
        )

        with patch.object(agent_service, "resolve_agent_generate_options", AsyncMock(return_value=options)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, []))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(agent_service, "_load_resume_item_categories", AsyncMock(return_value={})):
                        with patch.object(
                            agent_service,
                            "create_render_snapshot",
                            AsyncMock(return_value=(SimpleNamespace(id="snapshot-1"), "token")),
                        ) as mocked_snapshot:
                            with patch.object(
                                agent_service,
                                "_fit_snapshot_to_one_page",
                                AsyncMock(side_effect=lambda _session, _user_id, snapshot, _analysis_result, enabled: snapshot),
                            ):
                                with patch.object(
                                    agent_service,
                                    "_persist_agent_generated_resume",
                                    AsyncMock(return_value=SimpleNamespace(id="generated-resume-1", title="岗位简历")),
                                ):
                                    await agent_service.build_agent_resume_pdf(
                                        SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                        SimpleNamespace(),
                                        "user-1",
                                        payload,
                                        analysis,
                                        analysis_result=analysis_result,
                                    )

        snapshot = mocked_snapshot.await_args.args[2]
        self.assertEqual(
            [item.id for item in snapshot.selectedWorkItems],
            ["master-2", "master-3", "master-4"],
        )

    async def test_agent_pdf_generation_renders_and_trims_until_one_page(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )
        analysis_result = {
            "experienceMatches": [
                {"id": "master-1", "score": 95},
                {"id": "master-2", "score": 85},
                {"id": "master-3", "score": 70},
            ],
            "certificationMatches": [
                {"id": "cert-1", "score": 90},
            ],
            "skillMatches": [
                {"id": "skill-1", "score": 95},
            ],
        }
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id=f"master-{index}", category=ExperienceCategory.WORK),
                    SimpleNamespace(
                        id=f"version-{index}",
                        title=f"经历 {index}",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"r": f"结果 {index}"},
                    ),
                )
                for index in range(1, 4)
            ],
            "certifications": [
                SimpleNamespace(id="cert-1", name="证书 1", issuer="", issue_date=None),
            ],
            "skills": [
                (
                    SimpleNamespace(id="skill-1", proficiency=None),
                    SimpleNamespace(name="技能 1", category="产品"),
                ),
            ],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="标准",
            force_one_page=True,
        )
        created_snapshots = [
            (SimpleNamespace(id=f"snapshot-{index}"), f"token-{index}")
            for index in range(20)
        ]

        with patch.object(agent_service, "resolve_agent_generate_options", AsyncMock(return_value=options)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, []))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(agent_service, "_load_resume_item_categories", AsyncMock(return_value={})):
                        with patch.object(
                            agent_service,
                            "create_render_snapshot",
                            AsyncMock(side_effect=created_snapshots),
                        ) as mocked_snapshot:
                            with patch.object(
                                agent_service,
                                "render_resume_pdf",
                                AsyncMock(return_value=b"%PDF-test"),
                                create=True,
                            ) as mocked_render:
                                with patch.object(
                                    agent_service,
                                    "_pdf_page_count",
                                    side_effect=[2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1],
                                    create=True,
                                ):
                                    with patch.object(
                                        agent_service,
                                        "_persist_agent_generated_resume",
                                        AsyncMock(return_value=SimpleNamespace(id="generated-resume-1", title="岗位简历")),
                                    ):
                                        result = await agent_service.build_agent_resume_pdf(
                                            SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                            SimpleNamespace(),
                                            "user-1",
                                            payload,
                                            analysis,
                                            analysis_result=analysis_result,
                                        )

        measured_snapshots = [call.args[2] for call in mocked_snapshot.await_args_list[:-1]]
        final_snapshot = mocked_snapshot.await_args_list[-1].args[2]
        self.assertEqual(mocked_render.await_count, 11)
        self.assertEqual(len(measured_snapshots[0].selectedSkillGroups[0].skills), 1)
        self.assertEqual(measured_snapshots[2].selectedSkillGroups, [])
        self.assertEqual([item.id for item in measured_snapshots[4].sortedCertifications], [])
        self.assertEqual([item.id for item in final_snapshot.selectedWorkItems], ["master-1", "master-2"])
        self.assertIn("/exports/download/resume-pdf/snapshot-11?", result.download_url)

    async def test_agent_generation_polishes_selected_experience_content(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={"selection": {"experienceIds": ["master-1"]}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="需要PRD和UAT经验",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id="master-1", category=ExperienceCategory.WORK),
                    SimpleNamespace(
                        id="version-1",
                        title="原经历",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"s": "原背景", "t": "原任务", "a": "原行动", "r": "原结果"},
                    ),
                )
            ],
            "certifications": [],
            "skills": [],
        }
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=False,
        )

        with patch.object(agent_service, "resolve_agent_generate_options", AsyncMock(return_value=options)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, []))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(agent_service, "_load_resume_item_categories", AsyncMock(return_value={})):
                        with patch.object(
                            agent_service,
                            "generate_personal_summary",
                            AsyncMock(return_value={"summary": "定制摘要"}),
                        ):
                            with patch.object(
                                agent_service,
                                "polish_experience",
                                AsyncMock(return_value={
                                    "s": "润色背景",
                                    "t": "润色任务",
                                    "a": "润色行动",
                                    "r": "润色结果",
                                }),
                            ) as mocked_polish:
                                with patch.object(
                                    agent_service,
                                    "create_render_snapshot",
                                    AsyncMock(return_value=(SimpleNamespace(id="snapshot-1"), "token")),
                                ) as mocked_snapshot:
                                    with patch.object(
                                        agent_service,
                                        "_persist_agent_generated_resume",
                                        AsyncMock(return_value=SimpleNamespace(id="generated-resume-1", title="岗位简历")),
                                    ):
                                        await agent_service.build_agent_resume_pdf(
                                            SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                            SimpleNamespace(),
                                            "user-1",
                                            payload,
                                            analysis,
                                        )

        snapshot = mocked_snapshot.await_args.args[2]
        self.assertEqual(mocked_polish.await_args.kwargs["mode"], "default")
        self.assertEqual(mocked_polish.await_args.kwargs["jd_text"], "需要PRD和UAT经验")
        self.assertEqual(snapshot.selectedWorkItems[0].star.s, "润色背景")
        self.assertEqual(snapshot.selectedWorkItems[0].star.a, "润色行动")

    async def test_persist_generated_resume_saves_polished_star_overrides(self) -> None:
        session = _FakeSession()
        source_resume = SimpleNamespace(config={})
        version_id = uuid.uuid4()
        resume_item = SimpleNamespace(
            experience=SimpleNamespace(master_experience_id="master-1"),
            experience_version_id=version_id,
            overrides_json={"star": {"s": "原背景", "a": "原行动"}, "title": "原标题"},
            display_order=3,
        )
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_产品实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.6,
            fontSize=16,
            listSpacingValue="1em",
            bulletSpacingValue="1em",
            topPaddingPx=75.59,
            sectionSpacingClass="mb-6",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[
                agent_service.ResumeExperienceViewSnapshot(
                    id="master-1",
                    title="润色标题",
                    company="示例公司",
                    date="",
                    star=agent_service.StarFields(
                        s="润色背景",
                        t="润色任务",
                        a="润色行动",
                        r="润色结果",
                    ),
                    category="work",
                )
            ],
            selectedProjectItems=[],
            educations=[],
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )

        await agent_service._persist_agent_generated_resume(
            session,
            "user-1",
            source_resume=source_resume,
            resume_items=[resume_item],
            snapshot=snapshot,
            payload=payload,
            analysis=analysis,
            persist_snapshot_star_overrides=True,
        )

        generated_link = session.added[1]
        self.assertEqual(generated_link.experience_version_id, version_id)
        self.assertEqual(generated_link.display_order, 3)
        self.assertEqual(generated_link.overrides_json["title"], "原标题")
        self.assertEqual(
            generated_link.overrides_json["star"],
            {
                "s": "润色背景",
                "t": "润色任务",
                "a": "润色行动",
                "r": "润色结果",
            },
        )

    async def test_persist_generated_resume_saves_polished_bank_only_experience(self) -> None:
        session = _FakeSession()
        source_resume = SimpleNamespace(config={})
        version_id = uuid.uuid4()
        bank_master = SimpleNamespace(id="master-bank-only", category=ExperienceCategory.WORK)
        bank_version = SimpleNamespace(id=version_id)
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_产品实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.6,
            fontSize=16,
            listSpacingValue="1em",
            bulletSpacingValue="1em",
            topPaddingPx=75.59,
            sectionSpacingClass="mb-6",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[
                agent_service.ResumeExperienceViewSnapshot(
                    id="master-bank-only",
                    title="自动选入经历",
                    company="示例公司",
                    date="",
                    star=agent_service.StarFields(
                        s="润色背景",
                        t="润色任务",
                        a="润色行动",
                        r="润色结果",
                    ),
                    category="work",
                )
            ],
            selectedProjectItems=[],
            educations=[],
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )

        await agent_service._persist_agent_generated_resume(
            session,
            "user-1",
            source_resume=source_resume,
            resume_items=[],
            bank_experience_rows=[(bank_master, bank_version)],
            snapshot=snapshot,
            payload=payload,
            analysis=analysis,
            persist_snapshot_star_overrides=True,
        )

        generated_link = session.added[1]
        self.assertEqual(generated_link.experience_version_id, version_id)
        self.assertEqual(generated_link.display_order, 0)
        self.assertEqual(
            generated_link.overrides_json["star"],
            {
                "s": "润色背景",
                "t": "润色任务",
                "a": "润色行动",
                "r": "润色结果",
            },
        )

    async def test_persist_generated_resume_appends_bank_only_experience_after_max_display_order(self) -> None:
        session = _FakeSession()
        source_resume = SimpleNamespace(config={})
        linked_version_id = uuid.uuid4()
        bank_version_id = uuid.uuid4()
        resume_item = SimpleNamespace(
            experience=SimpleNamespace(master_experience_id="master-linked"),
            experience_version_id=linked_version_id,
            overrides_json={},
            display_order=3,
        )
        bank_master = SimpleNamespace(id="master-bank-only", category=ExperienceCategory.WORK)
        bank_version = SimpleNamespace(id=bank_version_id)
        snapshot = agent_service.ResumePdfRenderSnapshot(
            resumeName="示例公司_产品实习_90",
            profile=agent_service.ResumeEditorProfileSnapshot(name="张三"),
            lineHeight=1.6,
            fontSize=16,
            listSpacingValue="1em",
            bulletSpacingValue="1em",
            topPaddingPx=75.59,
            sectionSpacingClass="mb-6",
            listSpacingClass="space-y-2",
            sectionOrder=[],
            selectedWorkItems=[
                agent_service.ResumeExperienceViewSnapshot(
                    id="master-linked",
                    title="已有经历",
                    company="示例公司",
                    date="",
                    category="work",
                ),
                agent_service.ResumeExperienceViewSnapshot(
                    id="master-bank-only",
                    title="自动选入经历",
                    company="示例公司",
                    date="",
                    category="work",
                ),
            ],
            selectedProjectItems=[],
            educations=[],
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )

        await agent_service._persist_agent_generated_resume(
            session,
            "user-1",
            source_resume=source_resume,
            resume_items=[resume_item],
            bank_experience_rows=[(bank_master, bank_version)],
            snapshot=snapshot,
            payload=payload,
            analysis=analysis,
        )

        linked_link = session.added[1]
        bank_only_link = session.added[2]
        self.assertEqual(linked_link.display_order, 3)
        self.assertEqual(bank_only_link.display_order, 4)

    def test_agent_pdf_snapshot_uses_resume_detail_items_and_selection(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "selection": {
                    "certificationIds": ["cert-selected"],
                    "skillIds": ["skill-link-selected"],
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        selected_master = SimpleNamespace(id="master-selected", category=ExperienceCategory.WORK)
        unselected_master = SimpleNamespace(id="master-unselected", category=ExperienceCategory.WORK)
        selected_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-selected",
                title="覆盖后的标题",
                org="覆盖后的公司",
                start_date=None,
                end_date=None,
                is_current=False,
                star={"s": "覆盖后的背景", "r": "覆盖后的结果"},
            )
        )
        selected_cert = SimpleNamespace(
            id="cert-selected",
            name="已选证书",
            issuer="Issuer",
            issue_date=None,
            description="",
        )
        unselected_cert = SimpleNamespace(
            id="cert-unselected",
            name="未选证书",
            issuer="Issuer",
            issue_date=None,
            description="",
        )
        selected_skill = (SimpleNamespace(id="skill-link-selected"), SimpleNamespace(name="TypeScript", category="前端"))
        unselected_skill = (SimpleNamespace(id="skill-link-unselected"), SimpleNamespace(name="Python", category="后端"))
        bank = {
            "profile": None,
            "experiences": [
                (selected_master, SimpleNamespace(id="version-selected")),
                (unselected_master, SimpleNamespace(id="version-unselected")),
            ],
            "certifications": [selected_cert, unselected_cert],
            "skills": [selected_skill, unselected_skill],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[selected_item],
        )

        self.assertEqual([item.id for item in snapshot.selectedWorkItems], ["master-selected"])
        self.assertEqual(snapshot.selectedWorkItems[0].title, "覆盖后的标题")
        self.assertEqual(snapshot.selectedWorkItems[0].company, "覆盖后的公司")
        self.assertEqual(snapshot.selectedCertIds, ["cert-selected"])
        self.assertEqual([item.name for item in snapshot.sortedCertifications], ["已选证书"])
        self.assertEqual(
            [skill.name for group in snapshot.selectedSkillGroups for skill in group.skills],
            ["TypeScript"],
        )

    def test_agent_pdf_snapshot_filters_selected_education_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "selection": {
                    "educationIds": ["master-edu-selected"],
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        selected_master = SimpleNamespace(id="master-edu-selected", category=ExperienceCategory.EDUCATION)
        hidden_master = SimpleNamespace(id="master-edu-hidden", category=ExperienceCategory.EDUCATION)
        selected_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-edu-selected",
                title="计算机科学",
                org="示例大学",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="主修前端方向",
                star={"degree": "本科"},
            )
        )
        hidden_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-edu-hidden",
                title="隐藏专业",
                org="隐藏大学",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="不应导出",
                star={"degree": "硕士"},
            )
        )
        bank = {
            "profile": None,
            "experiences": [
                (selected_master, SimpleNamespace(id="version-edu-selected")),
                (hidden_master, SimpleNamespace(id="version-edu-hidden")),
            ],
            "certifications": [],
            "skills": [],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[selected_item, hidden_item],
        )

        self.assertEqual(snapshot.selectedEduIds, ["master-edu-selected"])
        self.assertEqual([item.school for item in snapshot.educations], ["示例大学"])
        self.assertEqual([item.major for item in snapshot.educations], ["计算机科学"])
        self.assertEqual([item.degree for item in snapshot.educations], ["本科"])

    def test_agent_pdf_snapshot_does_not_repeat_degree_as_major(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id="edu-1", category=ExperienceCategory.EDUCATION),
                    SimpleNamespace(
                        id="version-edu-1",
                        title="本科",
                        org="示例大学",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"degree": "本科"},
                    ),
                )
            ],
            "certifications": [],
            "skills": [],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
        )

        self.assertEqual([item.major for item in snapshot.educations], [""])
        self.assertEqual([item.degree for item in snapshot.educations], ["本科"])

        linked_snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[
                SimpleNamespace(
                    experience=SimpleNamespace(
                        master_experience_id="edu-1",
                        title="本科",
                        org="示例大学",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"degree": "本科"},
                    )
                )
            ],
        )

        self.assertEqual([item.major for item in linked_snapshot.educations], [""])
        self.assertEqual([item.degree for item in linked_snapshot.educations], ["本科"])

    def test_agent_pdf_snapshot_filters_selected_experience_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "selection": {
                    "experienceIds": ["master-work-selected"],
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        selected_master = SimpleNamespace(id="master-work-selected", category=ExperienceCategory.WORK)
        hidden_master = SimpleNamespace(id="master-work-hidden", category=ExperienceCategory.WORK)
        selected_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-work-selected",
                title="已选工作",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                star={"s": "背景", "r": "结果"},
            )
        )
        hidden_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-work-hidden",
                title="隐藏工作",
                org="隐藏公司",
                start_date=None,
                end_date=None,
                is_current=False,
                star={"s": "不应导出", "r": "不应导出"},
            )
        )
        bank = {
            "profile": None,
            "experiences": [
                (selected_master, SimpleNamespace(id="version-work-selected")),
                (hidden_master, SimpleNamespace(id="version-work-hidden")),
            ],
            "certifications": [],
            "skills": [],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[selected_item, hidden_item],
        )

        self.assertEqual([item.id for item in snapshot.selectedWorkItems], ["master-work-selected"])
        self.assertEqual([item.title for item in snapshot.selectedWorkItems], ["已选工作"])

    def test_agent_pdf_snapshot_includes_selected_bank_item_without_resume_link(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="产品",
            config={
                "selection": {
                    "experienceIds": ["master-linked", "master-auto-selected"],
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="产品实习",
            company_name="示例公司",
            jd_text="产品实习 JD",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_产品实习_90",
        )
        linked_master = SimpleNamespace(id="master-linked", category=ExperienceCategory.WORK)
        auto_selected_master = SimpleNamespace(id="master-auto-selected", category=ExperienceCategory.WORK)
        linked_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="master-linked",
                title="已链接经历",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                star={"s": "已链接背景", "r": "已链接结果"},
            )
        )
        bank = {
            "profile": None,
            "experiences": [
                (linked_master, SimpleNamespace(id="version-linked")),
                (
                    auto_selected_master,
                    SimpleNamespace(
                        id="version-auto-selected",
                        title="一键组装选中但未链接",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"s": "自动选中背景", "r": "自动选中结果"},
                    ),
                ),
            ],
            "certifications": [],
            "skills": [],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[linked_item],
        )

        self.assertEqual(
            [item.id for item in snapshot.selectedWorkItems],
            ["master-linked", "master-auto-selected"],
        )
        self.assertEqual(
            [item.title for item in snapshot.selectedWorkItems],
            ["已链接经历", "一键组装选中但未链接"],
        )

    def test_agent_pdf_snapshot_falls_back_to_bank_when_resume_has_no_items(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"selection": {"experienceIds": ["master-selected"]}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        selected_master = SimpleNamespace(id="master-selected", category=ExperienceCategory.WORK)
        hidden_master = SimpleNamespace(id="master-hidden", category=ExperienceCategory.WORK)
        bank = {
            "profile": None,
            "experiences": [
                (
                    selected_master,
                    SimpleNamespace(
                        id="version-selected",
                        title="已选工作",
                        org="示例公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"r": "已选结果"},
                    ),
                ),
                (
                    hidden_master,
                    SimpleNamespace(
                        id="version-hidden",
                        title="隐藏工作",
                        org="隐藏公司",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        star={"r": "隐藏结果"},
                    ),
                ),
            ],
            "certifications": [],
            "skills": [],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
            resume_items=[],
        )

        self.assertEqual([item.id for item in snapshot.selectedWorkItems], ["master-selected"])
        self.assertEqual([item.title for item in snapshot.selectedWorkItems], ["已选工作"])

    def test_agent_pdf_snapshot_honors_hidden_summary(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"layout": {"isSummaryVisible": False}, "personalSummary": "简历级摘要"},
        )
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="全局摘要",
            location="",
            email="",
            phone="",
            social_links={},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "AI 生成摘要",
        )

        self.assertEqual(snapshot.profile.summary, "")

    def test_agent_pdf_snapshot_preserves_empty_resume_personal_summary(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={"personalSummary": ""},
        )
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="全局摘要",
            location="",
            email="",
            phone="",
            social_links={},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
        )

        self.assertEqual(snapshot.profile.summary, "")

    def test_agent_pdf_snapshot_parses_profile_linkedin_object(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="",
            location="",
            email="",
            phone="",
            social_links={"linkedin": {"url": "https://linkedin.example/me", "position": 0}},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "")

        self.assertEqual(snapshot.profile.linkedin, "https://linkedin.example/me")

    def test_agent_pdf_snapshot_uses_global_profile_avatar(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="",
            location="",
            email="",
            phone="",
            social_links={},
            extra_json={"avatar_data_url": "data:image/png;base64,avatar"},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "")

        self.assertEqual(snapshot.profile.avatarDataUrl, "data:image/png;base64,avatar")

    def test_agent_pdf_snapshot_preserves_empty_local_profile_overrides(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "profileSyncMode": "local",
                "profile": {
                    "name": "",
                    "email": "",
                    "phone": "",
                    "location": "",
                    "linkedin": "",
                    "avatarDataUrl": "",
                    "summary": "",
                },
            },
        )
        profile = SimpleNamespace(
            full_name="全局姓名",
            title="前端",
            summary="全局摘要",
            location="上海",
            email="global@example.com",
            phone="16600000000",
            social_links={"linkedin": {"url": "https://linkedin.example/global", "position": 0}},
            extra_json={"avatar_data_url": "data:image/png;base64,global-avatar"},
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "")

        self.assertEqual(snapshot.profile.name, "")
        self.assertEqual(snapshot.profile.email, "")
        self.assertEqual(snapshot.profile.phone, "")
        self.assertEqual(snapshot.profile.location, "")
        self.assertEqual(snapshot.profile.linkedin, "")
        self.assertEqual(snapshot.profile.avatarDataUrl, "")

    async def test_agent_pdf_keeps_archived_resume_item_category(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        archived_item = SimpleNamespace(
            experience=SimpleNamespace(
                master_experience_id="archived-master",
                id="archived-version",
                title="归档但仍在简历中的工作",
                org="示例公司",
                start_date=None,
                end_date=None,
                is_current=False,
                summary="应保留",
                star={"r": "应保留"},
                tags=[],
            )
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=False,
            polish_level="标准",
            force_one_page=False,
        )

        with patch.object(agent_service, "resolve_agent_generate_options", AsyncMock(return_value=options)):
            with patch.object(agent_service, "resolve_agent_resume_detail", AsyncMock(return_value=(resume, [archived_item]))):
                with patch.object(agent_service, "_load_agent_bank", AsyncMock(return_value=bank)):
                    with patch.object(
                        agent_service,
                        "_load_resume_item_categories",
                        AsyncMock(return_value={"archived-master": ExperienceCategory.WORK}),
                        create=True,
                    ):
                        with patch.object(
                            agent_service,
                            "create_render_snapshot",
                            AsyncMock(return_value=(SimpleNamespace(id="snapshot-1"), "token")),
                        ) as mocked_snapshot:
                            with patch.object(
                                agent_service,
                                "_persist_agent_generated_resume",
                                AsyncMock(return_value=SimpleNamespace(id="generated-resume-1", title="岗位简历")),
                            ):
                                await agent_service.build_agent_resume_pdf(
                                    SimpleNamespace(url=SimpleNamespace(scheme="http", netloc="testserver")),
                                    SimpleNamespace(),
                                    "user-1",
                                    payload,
                                    analysis,
                                )

        snapshot = mocked_snapshot.await_args.args[2]
        self.assertEqual([item.id for item in snapshot.selectedWorkItems], ["archived-master"])
        self.assertEqual(snapshot.selectedWorkItems[0].title, "归档但仍在简历中的工作")

    def test_agent_pdf_snapshot_applies_profile_template_preset(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        profile = SimpleNamespace(
            full_name="张三",
            title="前端",
            summary="",
            location="",
            email="",
            phone="",
            social_links={},
            extra_json={
                "resumeTemplatePresets": {
                    "modern-slate": {
                        "sectionOrder": ["summary", "skills", "work"],
                        "themeColorPresetId": "emerald",
                        "experienceListMarkerStyle": "none",
                        "skillTagSeparator": " / ",
                    }
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="modern-slate",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=False,
        )
        bank = {"profile": profile, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "", options)

        self.assertEqual(snapshot.sectionOrder, ["summary", "skills", "work"])
        self.assertEqual(snapshot.themeColorPresetId, "emerald")
        self.assertEqual(snapshot.experienceListMarkerStyle, "none")
        self.assertEqual(snapshot.skillTagSeparator, " / ")

    def test_agent_pdf_snapshot_uses_template_default_theme_color(self) -> None:
        resume = SimpleNamespace(id="resume-1", title="主简历", target_role="前端", config={})
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        options = agent_service.AgentGenerateOptions(
            template_id="accent-emerald",
            polish_before_output=True,
            polish_level="标准",
            force_one_page=False,
        )
        bank = {"profile": None, "experiences": [], "certifications": [], "skills": []}

        snapshot = agent_service._build_resume_pdf_snapshot(resume, bank, payload, analysis, "", options)

        self.assertEqual(snapshot.templateId, "accent-emerald")
        self.assertEqual(snapshot.themeColorPresetId, "emerald")

    def test_agent_pdf_snapshot_applies_saved_module_orders(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            title="主简历",
            target_role="前端",
            config={
                "layout": {
                    "orders": {
                        "educationIds": ["edu-2", "edu-1"],
                        "certificationIds": ["cert-2", "cert-1"],
                        "skillGroupNames": ["Backend", "Frontend"],
                    }
                }
            },
        )
        payload = agent_router.AgentJobGenerateRequest(
            job_title="前端实习",
            company_name="示例公司",
            jd_text="React TypeScript",
            job_url="https://example.com/jobs/1",
        )
        analysis = agent_router.AgentJobAnalysisResponse(
            match_percentage=90,
            evaluation="匹配",
            strengths=[],
            gaps=[],
            missing_keywords=[],
            recommendation="generate",
            suggested_folder_name="示例公司_前端实习_90",
        )
        bank = {
            "profile": None,
            "experiences": [
                (
                    SimpleNamespace(id="edu-1", category=ExperienceCategory.EDUCATION),
                    SimpleNamespace(
                        id="version-edu-1",
                        title="计算机科学",
                        org="第一大学",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"degree": "本科"},
                    ),
                ),
                (
                    SimpleNamespace(id="edu-2", category=ExperienceCategory.EDUCATION),
                    SimpleNamespace(
                        id="version-edu-2",
                        title="软件工程",
                        org="第二大学",
                        start_date=None,
                        end_date=None,
                        is_current=False,
                        summary="",
                        star={"degree": "硕士"},
                    ),
                ),
            ],
            "certifications": [
                SimpleNamespace(id="cert-1", name="证书一", issuer="", issue_date=None),
                SimpleNamespace(id="cert-2", name="证书二", issuer="", issue_date=None),
            ],
            "skills": [
                (
                    SimpleNamespace(id="skill-1"),
                    SimpleNamespace(name="React", category="Frontend"),
                ),
                (
                    SimpleNamespace(id="skill-2"),
                    SimpleNamespace(name="FastAPI", category="Backend"),
                ),
            ],
        }

        snapshot = agent_service._build_resume_pdf_snapshot(
            resume,
            bank,
            payload,
            analysis,
            "",
        )

        self.assertEqual([item.id for item in snapshot.educations], ["edu-2", "edu-1"])
        self.assertEqual([item.major for item in snapshot.educations], ["软件工程", "计算机科学"])
        self.assertEqual([item.degree for item in snapshot.educations], ["硕士", "本科"])
        self.assertEqual([item.id for item in snapshot.sortedCertifications], ["cert-2", "cert-1"])
        self.assertEqual([group.name for group in snapshot.selectedSkillGroups], ["Backend", "Frontend"])
