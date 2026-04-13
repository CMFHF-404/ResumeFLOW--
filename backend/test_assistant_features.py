import os
import unittest
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import json


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.models import ExperienceCategory, ExperienceVersion, MasterExperience  # noqa: E402
from app.domain.ai import ai_service  # noqa: E402
from app.domain.assistant import assistant_router, assistant_service  # noqa: E402


class _ScalarResult:
    def __init__(self, *, one_or_none=None, first=None):
        self._one_or_none = one_or_none
        self._first = first

    def one_or_none(self):
        return self._one_or_none

    def first(self):
        return self._first


class _ExecuteResult:
    def __init__(self, *, one_or_none=None, first=None):
        self._scalars = _ScalarResult(one_or_none=one_or_none, first=first)

    def scalars(self):
        return self._scalars


class _FakeAsyncSession:
    def __init__(self, execute_results):
        self.execute = AsyncMock(side_effect=execute_results)
        self.added = []
        self.flush = AsyncMock()
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, value):
        self.added.append(value)


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
                            "snapshot": {"experiences": [], "educations": [], "certifications": [], "skills": []},
                        },
                    },
                }
            ],
        )

        self.assertEqual(payload["selected_resume"]["resume_id"], "resume-1")
        self.assertEqual(payload["selected_resume"]["resume_name"], "产品经理简历")
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


class AssistantDraftApplyTests(unittest.IsolatedAsyncioTestCase):
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


class AssistantPersistenceTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
