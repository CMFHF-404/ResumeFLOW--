import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.profile import profile_router, profile_service  # noqa: E402
from app.domain.profile.schemas import ProfileUpdate  # noqa: E402


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalars(self):
        return self

    def first(self):
        return self.value


class ProfileUpdateConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_expected_timestamp_conflict_rejects_stale_extra_json(self) -> None:
        current_timestamp = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        profile = SimpleNamespace(
            user_id="user-1",
            extra_json={"resume_template_presets": {"modern-slate": {"theme": "emerald"}}},
            updated_at=current_timestamp,
        )
        session = SimpleNamespace(
            add=Mock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        payload = ProfileUpdate(
            extra_json={"avatar_data_url": "data:image/jpeg;base64,stale"},
            expected_updated_at=current_timestamp - timedelta(seconds=1),
        )

        with patch.object(
            profile_service,
            "_fetch_profile_for_update",
            AsyncMock(return_value=profile),
        ):
            with self.assertRaises(profile_service.ProfileUpdateConflictError):
                await profile_service.update_profile(session, "user-1", payload)

        self.assertEqual(
            profile.extra_json,
            {"resume_template_presets": {"modern-slate": {"theme": "emerald"}}},
        )
        session.commit.assert_not_awaited()

    async def test_matching_timestamp_updates_without_persisting_precondition(self) -> None:
        current_timestamp = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        next_timestamp = datetime(2026, 8, 1, 10, 1, tzinfo=timezone.utc)
        profile = SimpleNamespace(
            user_id="user-1",
            extra_json={"avatar_data_url": "legacy"},
            updated_at=current_timestamp,
        )
        session = SimpleNamespace(
            add=Mock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        payload = ProfileUpdate(
            extra_json={
                "avatar_data_url": "square",
                "resume_template_presets": {"modern-slate": {"theme": "emerald"}},
            },
            expected_updated_at=current_timestamp,
        )

        with patch.object(
            profile_service,
            "_fetch_profile_for_update",
            AsyncMock(return_value=profile),
        ):
            with patch.object(
                profile_service,
                "_sync_global_resumes_after_profile_update",
                AsyncMock(),
            ):
                with patch.object(profile_service, "utc_now", return_value=next_timestamp):
                    updated = await profile_service.update_profile(session, "user-1", payload)

        self.assertIs(updated, profile)
        self.assertEqual(profile.updated_at, next_timestamp)
        self.assertFalse(hasattr(profile, "expected_updated_at"))
        session.commit.assert_awaited_once()

    async def test_score_relevant_profile_change_invalidates_global_resume_evaluations(self) -> None:
        current_timestamp = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        next_timestamp = datetime(2026, 8, 1, 10, 1, tzinfo=timezone.utc)
        profile = SimpleNamespace(
            user_id="user-1",
            full_name="旧姓名",
            updated_at=current_timestamp,
        )
        session = SimpleNamespace(
            add=Mock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        payload = ProfileUpdate(full_name="新姓名", expected_updated_at=current_timestamp)

        with patch.object(
            profile_service,
            "_fetch_profile_for_update",
            AsyncMock(return_value=profile),
        ):
            with patch.object(
                profile_service,
                "_sync_global_resumes_after_profile_update",
                AsyncMock(),
            ) as invalidate:
                with patch.object(profile_service, "utc_now", return_value=next_timestamp):
                    await profile_service.update_profile(session, "user-1", payload)

        invalidate.assert_awaited_once_with(
            session,
            "user-1",
            updated_at=next_timestamp,
            previous_profile={
                "name": "旧姓名",
                "email": "",
                "phone": "",
                "location": "",
                "linkedin": "",
                "summary": "",
                "avatarDataUrl": "",
            },
            invalidate_evaluations=True,
        )
        session.commit.assert_awaited_once()

    async def test_unrelated_profile_metadata_does_not_invalidate_resume_evaluations(self) -> None:
        current_timestamp = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        profile = SimpleNamespace(
            user_id="user-1",
            extra_json={},
            updated_at=current_timestamp,
        )
        session = SimpleNamespace(
            add=Mock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        payload = ProfileUpdate(
            extra_json={"resume_template_presets": {}},
            expected_updated_at=current_timestamp,
        )

        with patch.object(
            profile_service,
            "_fetch_profile_for_update",
            AsyncMock(return_value=profile),
        ):
            with patch.object(
                profile_service,
                "_sync_global_resumes_after_profile_update",
                AsyncMock(),
            ) as invalidate:
                await profile_service.update_profile(session, "user-1", payload)

        invalidate.assert_not_awaited()

    async def test_global_resume_sync_migrates_legacy_snapshots_and_invalidates_scores(self) -> None:
        updated_at = datetime(2026, 8, 1, 10, 1, tzinfo=timezone.utc)
        session = SimpleNamespace(execute=AsyncMock())
        previous_profile = {
            "name": "旧姓名",
            "email": "old@example.com",
            "phone": "",
            "location": "上海",
            "linkedin": "",
            "summary": "旧摘要",
            "avatarDataUrl": "",
        }

        await profile_service._sync_global_resumes_after_profile_update(
            session,
            "user-1",
            updated_at=updated_at,
            previous_profile=previous_profile,
            invalidate_evaluations=True,
        )

        self.assertEqual(session.execute.await_count, 2)
        statement, parameters = session.execute.await_args_list[-1].args
        sql = str(statement)
        self.assertIn("UPDATE resumes", sql)
        self.assertIn("'{jdAnalysis,isOutdated}'", sql)
        self.assertIn("'{jdAnalysis,evaluationIsOutdated}'", sql)
        self.assertIn("profileSyncMode", sql)
        self.assertIn("jsonb_build_object('profileSyncMode', 'global')", sql)
        self.assertIn("profile_avatar", sql)
        self.assertEqual(
            parameters,
            {
                "user_id": "user-1",
                "updated_at": updated_at,
                "invalidate_evaluations": True,
                "profile_name": "旧姓名",
                "profile_email": "old@example.com",
                "profile_phone": "",
                "profile_location": "上海",
                "profile_linkedin": "",
                "profile_summary": "旧摘要",
                "profile_avatar": "",
            },
        )

    async def test_avatar_only_change_refreshes_global_resume_preview_without_staling_score(self) -> None:
        current_timestamp = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)
        profile = SimpleNamespace(
            user_id="user-1",
            extra_json={"avatar_data_url": "old-avatar"},
            updated_at=current_timestamp,
        )
        session = SimpleNamespace(add=Mock(), commit=AsyncMock(), refresh=AsyncMock())
        payload = ProfileUpdate(
            extra_json={"avatar_data_url": "new-avatar"},
            expected_updated_at=current_timestamp,
        )

        with patch.object(
            profile_service,
            "_fetch_profile_for_update",
            AsyncMock(return_value=profile),
        ):
            with patch.object(
                profile_service,
                "_sync_global_resumes_after_profile_update",
                AsyncMock(),
            ) as sync_resumes:
                await profile_service.update_profile(session, "user-1", payload)

        self.assertEqual(sync_resumes.await_args.kwargs["invalidate_evaluations"], False)
        self.assertEqual(
            sync_resumes.await_args.kwargs["previous_profile"]["avatarDataUrl"],
            "old-avatar",
        )

    async def test_expected_update_selects_the_profile_for_update(self) -> None:
        profile = SimpleNamespace(user_id="user-1")
        session = SimpleNamespace(execute=AsyncMock(return_value=_ScalarResult(profile)))

        result = await profile_service._fetch_profile_for_update(session, "user-1")

        self.assertIs(result, profile)
        statement = session.execute.await_args.args[0]
        self.assertIsNotNone(statement._for_update_arg)

    async def test_router_maps_stale_profile_updates_to_409(self) -> None:
        payload = ProfileUpdate(
            extra_json={"avatar_data_url": "square"},
            expected_updated_at=datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc),
        )
        with patch.object(
            profile_router,
            "update_profile",
            AsyncMock(side_effect=profile_service.ProfileUpdateConflictError("stale profile")),
        ):
            with self.assertRaises(HTTPException) as raised:
                await profile_router.patch_profile(
                    payload,
                    session=SimpleNamespace(),
                    current_user=SimpleNamespace(id="user-1"),
                )

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
