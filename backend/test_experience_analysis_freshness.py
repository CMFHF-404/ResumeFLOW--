import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.experience import experience_service  # noqa: E402
from app.domain.experience.schemas import (  # noqa: E402
    ExperienceCreate,
    ExperienceUpdate,
    ExperienceVersionPayload,
)
from app.models import ExperienceCategory, MasterExperience  # noqa: E402


class ExperienceAnalysisFreshnessTests(unittest.IsolatedAsyncioTestCase):
    def _session(self) -> SimpleNamespace:
        return SimpleNamespace(
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

    async def test_create_education_only_invalidates_resume_evaluation(self) -> None:
        session = self._session()
        updated_at = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)
        payload = ExperienceCreate(
            category=ExperienceCategory.EDUCATION,
            version=ExperienceVersionPayload(title="University"),
        )

        with patch.object(experience_service, "utc_now", return_value=updated_at):
            with patch.object(
                experience_service,
                "invalidate_user_resume_analyses",
                AsyncMock(),
            ) as invalidate:
                await experience_service.create_experience(session, "user-1", payload)

        invalidate.assert_awaited_once_with(
            session,
            "user-1",
            updated_at=updated_at,
            invalidate_match=False,
        )

    async def test_education_to_work_transition_invalidates_jd_match(self) -> None:
        session = self._session()
        updated_at = datetime(2026, 8, 8, 12, 1, tzinfo=timezone.utc)
        master = MasterExperience(
            user_id="user-1",
            category=ExperienceCategory.EDUCATION,
        )
        payload = ExperienceUpdate(category=ExperienceCategory.WORK)

        with patch.object(
            experience_service,
            "_get_master",
            AsyncMock(return_value=master),
        ):
            with patch.object(experience_service, "utc_now", return_value=updated_at):
                with patch.object(
                    experience_service,
                    "invalidate_user_resume_analyses",
                    AsyncMock(),
                ) as invalidate:
                    await experience_service.update_experience(
                        session,
                        "user-1",
                        str(master.id),
                        payload,
                    )

        invalidate.assert_awaited_once_with(
            session,
            "user-1",
            updated_at=updated_at,
            invalidate_match=True,
        )

    async def test_update_education_only_invalidates_resume_evaluation(self) -> None:
        session = self._session()
        updated_at = datetime(2026, 8, 8, 12, 2, tzinfo=timezone.utc)
        master = MasterExperience(
            user_id="user-1",
            category=ExperienceCategory.EDUCATION,
        )
        payload = ExperienceUpdate(is_archived=False)

        with patch.object(
            experience_service,
            "_get_master",
            AsyncMock(return_value=master),
        ):
            with patch.object(experience_service, "utc_now", return_value=updated_at):
                with patch.object(
                    experience_service,
                    "invalidate_user_resume_analyses",
                    AsyncMock(),
                ) as invalidate:
                    await experience_service.update_experience(
                        session,
                        "user-1",
                        str(master.id),
                        payload,
                    )

        invalidate.assert_awaited_once_with(
            session,
            "user-1",
            updated_at=updated_at,
            invalidate_match=False,
        )

    async def test_archive_education_only_invalidates_resume_evaluation(self) -> None:
        session = self._session()
        updated_at = datetime(2026, 8, 8, 12, 3, tzinfo=timezone.utc)
        master = MasterExperience(
            user_id="user-1",
            category=ExperienceCategory.EDUCATION,
        )

        with patch.object(
            experience_service,
            "_get_master",
            AsyncMock(return_value=master),
        ):
            with patch.object(experience_service, "utc_now", return_value=updated_at):
                with patch.object(
                    experience_service,
                    "invalidate_user_resume_analyses",
                    AsyncMock(),
                ) as invalidate:
                    await experience_service.archive_experience(
                        session,
                        "user-1",
                        str(master.id),
                    )

        invalidate.assert_awaited_once_with(
            session,
            "user-1",
            updated_at=updated_at,
            invalidate_match=False,
        )


if __name__ == "__main__":
    unittest.main()
