import os
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402

from app.models import ExperienceCategory  # noqa: E402
from app.domain.agent import agent_router, agent_service  # noqa: E402


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
        self.refresh = AsyncMock()
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

    async def test_resolve_generate_options_uses_server_config_when_payload_omits_values(self) -> None:
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
        self.assertFalse(result.force_one_page)


class AgentApiKeyServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_key_returns_plaintext_once_and_stores_only_hash(self) -> None:
        session = _FakeSession()

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
        self.assertTrue(agent_service.verify_agent_api_key_hash(result.plaintext_key, stored.key_hash))
        session.commit.assert_awaited_once()
        session.refresh.assert_awaited_once_with(stored)

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

        with patch.object(agent_router, "build_agent_job_analysis", AsyncMock(return_value=expected)) as mocked:
            result = await agent_router.analyze_agent_job(
                payload,
                session=SimpleNamespace(),
                agent_user=SimpleNamespace(id="user-1"),
            )

        self.assertEqual(result, expected)
        mocked.assert_awaited_once()
        self.assertEqual(mocked.await_args.args[1], "user-1")
        self.assertEqual(mocked.await_args.args[2].company_name, "字节跳动")

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

        with patch.object(agent_router, "build_agent_job_analysis", AsyncMock(return_value=analysis)):
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

    def test_force_one_page_compacts_agent_pdf_snapshot_layout(self) -> None:
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

        self.assertLess(snapshot.lineHeight, 1.75)
        self.assertLess(snapshot.fontSize, 16)
        self.assertEqual(snapshot.sectionSpacingClass, "mb-2")
        self.assertEqual(snapshot.listSpacingValue, "0.25em")

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
                star={"degree": "本科", "major": "计算机科学"},
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
                star={"degree": "硕士", "major": "隐藏专业"},
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
                        star={"degree": "本科", "major": "计算机科学"},
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
                        star={"degree": "硕士", "major": "软件工程"},
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
        self.assertEqual([item.id for item in snapshot.sortedCertifications], ["cert-2", "cert-1"])
        self.assertEqual([group.name for group in snapshot.selectedSkillGroups], ["Backend", "Frontend"])
