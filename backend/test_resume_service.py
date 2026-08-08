import os
import unittest
from copy import deepcopy
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume import resume_service  # noqa: E402
from app.models import ExperienceVersion  # noqa: E402
from app.domain.resume.resume_schema import ResumeAssemblyPatch, ResumeUpdate  # noqa: E402


RESUME_UPDATED_AT = datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc)


def _guarded_resume_update(resume, **kwargs) -> ResumeUpdate:
    resume.updated_at = getattr(resume, "updated_at", RESUME_UPDATED_AT)
    return ResumeUpdate(expected_updated_at=resume.updated_at, **kwargs)


class ResumeExperienceDateTests(unittest.TestCase):
    def test_filter_overrides_normalizes_experience_dates_to_month_start(self) -> None:
        overrides = resume_service._filter_overrides(  # type: ignore[attr-defined]
            {
                "title": "AI 产品开发",
                "start_date": "2024.05",
                "end_date": "2025-03",
            }
        )

        self.assertEqual(overrides["start_date"], "2024-05-01")
        self.assertEqual(overrides["end_date"], "2025-03-01")

    def test_merge_version_accepts_legacy_resume_overrides_with_month_dates(self) -> None:
        version = ExperienceVersion(
            id="version-1",
            master_experience_id="master-1",
            version=1,
            title="旧标题",
            org="旧公司",
            start_date=date(2024, 1, 15),
            end_date=date(2024, 6, 20),
            is_current=False,
            highlights=[],
            tags=[],
            star={},
        )

        merged = resume_service._merge_version(  # type: ignore[attr-defined]
            version,
            {
                "start_date": "2024.05",
                "end_date": "2025-03-30",
            },
        )

        self.assertEqual(merged.start_date, date(2024, 5, 1))
        self.assertEqual(merged.end_date, date(2025, 3, 1))


class ResumeTargetRoleEvaluationFreshnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_target_role_update_only_marks_evaluation_outdated(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "jdAnalysis": {
                    "targetRoleSignature": resume_service._target_role_signature("产品经理"),
                    "isOutdated": False,
                }
            },
        )
        session = SimpleNamespace(
            add=lambda value: None,
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                session,
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, target_role="增长产品经理"),
            )

        self.assertEqual(resume.target_role, "增长产品经理")
        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])

    async def test_target_role_update_does_not_trust_simultaneous_client_signature(self) -> None:
        fresh_config = {
            "jdAnalysis": {
                "targetRoleSignature": resume_service._target_role_signature("增长产品经理"),
                "evaluationSignature": "evaluation-new-role",
                "isOutdated": False,
            }
        }
        resume = SimpleNamespace(target_role="产品经理", config={})
        session = SimpleNamespace(
            add=lambda value: None,
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                session,
                "user-1",
                "resume-1",
                _guarded_resume_update(
                    resume,
                    target_role="增长产品经理",
                    config=fresh_config,
                ),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])

    async def test_target_role_update_rejects_relabelled_old_evaluation(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "jdAnalysis": {
                    "targetRoleSignature": resume_service._target_role_signature("产品经理"),
                    "evaluationSignature": "evaluation-old-role",
                    "isOutdated": False,
                }
            },
        )
        relabelled_config = deepcopy(resume.config)
        relabelled_config["jdAnalysis"]["targetRoleSignature"] = (
            resume_service._target_role_signature("增长产品经理")
        )

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                SimpleNamespace(
                    add=lambda value: None,
                    commit=AsyncMock(),
                    refresh=AsyncMock(),
                ),
                "user-1",
                "resume-1",
                _guarded_resume_update(
                    resume,
                    target_role="增长产品经理",
                    config=relabelled_config,
                ),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])


class ResumeContentEvaluationFreshnessTests(unittest.IsolatedAsyncioTestCase):
    def _session(self):
        return SimpleNamespace(
            add=lambda value: None,
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

    async def test_evaluation_relevant_config_change_only_marks_evaluation_outdated(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "selection": {"experienceIds": ["exp-1"]},
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["selection"]["experienceIds"] = ["exp-2"]

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])

    async def test_config_change_does_not_trust_simultaneous_client_signature(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "personalSummary": "旧总结",
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["personalSummary"] = "新总结"
        next_config["jdAnalysis"]["evaluationSignature"] = "evaluation-2"

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])

    async def test_evaluation_only_update_preserves_current_evaluation(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "personalSummary": "当前总结",
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": True,
                    "evaluationIsOutdated": True,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["jdAnalysis"] = {
            **next_config["jdAnalysis"],
            "evaluationSignature": "evaluation-2",
            "isOutdated": False,
            "evaluationIsOutdated": False,
        }

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])
        self.assertFalse(resume.config["jdAnalysis"]["evaluationIsOutdated"])

    async def test_expected_updated_at_rejects_stale_config_save(self) -> None:
        current_updated_at = datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc)
        resume = SimpleNamespace(
            updated_at=current_updated_at,
            target_role="产品经理",
            config={"jdAnalysis": {"isOutdated": True}},
        )
        session = self._session()

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            with self.assertRaises(resume_service.ConcurrencyConflictError):
                await resume_service.update_resume(
                    session,
                    "user-1",
                    "resume-1",
                    ResumeUpdate(
                        config={"jdAnalysis": {"isOutdated": False}},
                        expected_updated_at=datetime(2026, 8, 8, 9, 59, tzinfo=timezone.utc),
                    ),
                )

        session.commit.assert_not_awaited()

    async def test_content_save_requires_expected_updated_at(self) -> None:
        session = self._session()

        with self.assertRaises(resume_service.ConcurrencyConflictError):
            await resume_service.update_resume(
                session,
                "user-1",
                "resume-1",
                ResumeUpdate(config={"personalSummary": "新总结"}),
            )

        session.commit.assert_not_awaited()

    async def test_title_save_requires_expected_updated_at(self) -> None:
        session = self._session()

        with self.assertRaises(resume_service.ConcurrencyConflictError):
            await resume_service.update_resume(
                session,
                "user-1",
                "resume-1",
                ResumeUpdate(title="新标题"),
            )

        session.commit.assert_not_awaited()

    async def test_visual_only_config_change_preserves_current_evaluation(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "layout": {"fontSize": 14},
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["layout"]["fontSize"] = 16

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])

    async def test_selection_id_order_change_preserves_current_evaluation(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "selection": {"experienceIds": ["exp-1", "exp-2"]},
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["selection"]["experienceIds"] = ["exp-2", "exp-1", "exp-2"]

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])

    async def test_hidden_summary_text_change_preserves_current_evaluation(self) -> None:
        resume = SimpleNamespace(
            target_role="产品经理",
            config={
                "profileSyncMode": "local",
                "profile": {"summary": "旧全局摘要"},
                "personalSummary": "旧简历摘要",
                "layout": {"isSummaryVisible": False},
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        next_config = deepcopy(resume.config)
        next_config["profile"]["summary"] = "新全局摘要"
        next_config["personalSummary"] = "新简历摘要"

        with patch.object(resume_service, "_get_resume", AsyncMock(return_value=resume)):
            await resume_service.update_resume(
                self._session(),
                "user-1",
                "resume-1",
                _guarded_resume_update(resume, config=next_config),
            )

        self.assertFalse(resume.config["jdAnalysis"]["isOutdated"])

    async def test_assembly_change_marks_analysis_outdated(self) -> None:
        updated_at = datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc)
        resume = SimpleNamespace(
            updated_at=updated_at,
            config={
                "jdAnalysis": {
                    "evaluationSignature": "evaluation-1",
                    "isOutdated": False,
                },
            },
        )
        session = self._session()
        get_resume_mock = AsyncMock(return_value=resume)

        with (
            patch.object(resume_service, "_get_resume", get_resume_mock),
            patch.object(
                resume_service,
                "_validate_ops",
                return_value=[{"op": "override"}],
            ),
            patch.object(resume_service, "_handle_override", AsyncMock()),
        ):
            await resume_service.update_assembly(
                session,
                "user-1",
                "resume-1",
                ResumeAssemblyPatch(
                    operations=[{"op": "override"}],
                    expected_updated_at=updated_at,
                ),
            )

        self.assertTrue(resume.config["jdAnalysis"]["isOutdated"])
        self.assertTrue(resume.config["jdAnalysis"]["evaluationIsOutdated"])
        get_resume_mock.assert_awaited_once_with(
            session,
            "user-1",
            "resume-1",
            for_update=True,
        )

    async def test_assembly_change_requires_expected_updated_at(self) -> None:
        session = self._session()

        with self.assertRaises(resume_service.ConcurrencyConflictError):
            await resume_service.update_assembly(
                session,
                "user-1",
                "resume-1",
                ResumeAssemblyPatch(operations=[]),
            )

        session.commit.assert_not_awaited()

    def test_existing_general_stale_flag_does_not_hide_current_evaluation_flag(self) -> None:
        config = {
            "jdAnalysis": {
                "isOutdated": True,
                "evaluationIsOutdated": False,
            }
        }

        marked = resume_service._mark_resume_analysis_outdated(config)

        self.assertIsNot(marked, config)
        self.assertTrue(marked["jdAnalysis"]["isOutdated"])
        self.assertTrue(marked["jdAnalysis"]["evaluationIsOutdated"])


if __name__ == "__main__":
    unittest.main()
