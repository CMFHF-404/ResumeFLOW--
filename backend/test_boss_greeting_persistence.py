import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.domain.ai.ai_router import GenerateBossGreetingRequest, generate_boss_greeting_endpoint  # noqa: E402
from app.domain.resume import resume_service  # noqa: E402


class ResumeBossGreetingPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_persist_resume_boss_greeting_merges_into_resume_config(self) -> None:
        resume = SimpleNamespace(
            id="resume-1",
            config={"jdAnalysis": {"summary": "existing"}},
            updated_at=None,
        )
        timestamp = datetime(2026, 4, 4, tzinfo=timezone.utc)

        async def _refresh_resume(target: SimpleNamespace) -> None:
            target.config = {
                "jdAnalysis": {"summary": "existing"},
                "bossGreeting": {
                    "greeting": "你好，我想应聘这个岗位",
                    "signature": "sig-123",
                },
            }
            target.updated_at = timestamp

        session = SimpleNamespace(
            execute=AsyncMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(side_effect=_refresh_resume),
        )

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            with patch.object(resume_service, "utc_now", return_value=timestamp):
                result = await resume_service.persist_resume_boss_greeting(
                    session,
                    "user-1",
                    "resume-1",
                    "你好，我想应聘这个岗位",
                    "sig-123",
                )

        self.assertIs(result, resume)
        self.assertEqual(
            resume.config,
            {
                "jdAnalysis": {"summary": "existing"},
                "bossGreeting": {
                    "greeting": "你好，我想应聘这个岗位",
                    "signature": "sig-123",
                },
            },
        )
        self.assertEqual(resume.updated_at, timestamp)
        session.execute.assert_awaited_once()
        execute_kwargs = session.execute.await_args.args[1]
        self.assertEqual(execute_kwargs["resume_id"], "resume-1")
        self.assertEqual(execute_kwargs["user_id"], "user-1")
        self.assertEqual(
            json.loads(execute_kwargs["boss_greeting_payload"]),
            {
                "greeting": "你好，我想应聘这个岗位",
                "signature": "sig-123",
            },
        )
        session.commit.assert_awaited_once()
        session.refresh.assert_awaited_once_with(resume)

    def test_duplicate_config_clears_ai_generated_boss_greeting(self) -> None:
        duplicated = resume_service._build_duplicated_config(
            {
                "jdAnalysis": {"summary": "old"},
                "bossGreeting": {"greeting": "old"},
                "layout": {"density": "standard"},
            }
        )

        self.assertEqual(duplicated, {"layout": {"density": "standard"}})


class BossGreetingEndpointPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_endpoint_persists_generated_boss_greeting_when_resume_id_provided(self) -> None:
        payload = GenerateBossGreetingRequest(
            jd_text="JD",
            analysis_summary="summary",
            resume_text="{}",
            resume_id="resume-1",
            signature="sig-123",
        )
        session = SimpleNamespace()
        current_user = SimpleNamespace(id="user-1")
        generate_mock = AsyncMock(return_value={"greeting": "你好"})
        persist_mock = AsyncMock()

        with patch("app.domain.ai.ai_router.generate_boss_greeting", generate_mock):
            with patch("app.domain.ai.ai_router.persist_resume_boss_greeting", persist_mock):
                result = await generate_boss_greeting_endpoint(
                    payload,
                    session=session,
                    current_user=current_user,
                )

        self.assertEqual(result, {"greeting": "你好"})
        persist_mock.assert_awaited_once_with(
            session,
            "user-1",
            "resume-1",
            "你好",
            "sig-123",
        )
