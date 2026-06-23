import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()
sys.path.append(str(Path(__file__).parent))

from app.domain.parser.duplicate_detection import apply_duplicate_flags  # noqa: E402
from app.domain.parser.schemas import (  # noqa: E402
    DuplicateMatch,
    ParsedExperienceItem,
    ParsedExperienceVersion,
)
from app.models import ExperienceCategory  # noqa: E402


class ParserDuplicateDetectionTests(unittest.TestCase):
    def test_duplicate_match_serializes_semantic_match_metadata(self) -> None:
        payload = DuplicateMatch(
            is_duplicate=True,
            match_type="semantic",
            match_score=0.91,
            matched_existing_id="exp-1",
            match_reason="同一项目经历，角色名称存在轻微漂移。",
        ).model_dump()

        self.assertEqual(payload["matched_existing_id"], "exp-1")
        self.assertEqual(payload["match_reason"], "同一项目经历，角色名称存在轻微漂移。")

    def test_duplicate_detection_normalizes_cjk_compatibility_characters(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-project",
            category=ExperienceCategory.PROJECT,
            version=ParsedExperienceVersion(
                title="负责⼈",
                org="软瘾互助⼩组",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.PROJECT,
                title="负责人",
                org="软瘾互助小组",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertTrue(result.duplicate.is_duplicate)
        self.assertEqual(result.duplicate.match_type, "exact")
        self.assertEqual(result.duplicate.match_score, 1.0)

    def test_duplicate_detection_tolerates_project_title_org_swap(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-project",
            category=ExperienceCategory.PROJECT,
            version=ParsedExperienceVersion(
                title="软瘾互助小组",
                org="负责人",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.PROJECT,
                title="负责人",
                org="软瘾互助小组",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertTrue(result.duplicate.is_duplicate)

    def test_duplicate_detection_tolerates_fast_model_project_category_drift(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-project",
            category=ExperienceCategory.WORK,
            version=ParsedExperienceVersion(
                title="负责人",
                org="软瘾互助小组",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.PROJECT,
                title="负责人",
                org="软瘾互助小组",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertTrue(result.duplicate.is_duplicate)

    def test_duplicate_detection_tolerates_merged_project_title_without_org(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-project",
            category=ExperienceCategory.PROJECT,
            version=ParsedExperienceVersion(
                title="软瘾互助小组 · 负责人",
                org="",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.PROJECT,
                title="负责人",
                org="软瘾互助小组",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertTrue(result.duplicate.is_duplicate)

    def test_duplicate_detection_tolerates_project_role_wording_drift(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-project",
            category=ExperienceCategory.PROJECT,
            version=ParsedExperienceVersion(
                title="发起人",
                org="软瘾互助小组",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.PROJECT,
                title="负责人",
                org="软瘾互助小组",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertTrue(result.duplicate.is_duplicate)

    def test_duplicate_detection_does_not_merge_same_company_different_work_roles(self) -> None:
        parsed = ParsedExperienceItem(
            id="parsed-work",
            category=ExperienceCategory.WORK,
            version=ParsedExperienceVersion(
                title="产品经理",
                org="腾讯",
            ),
        )
        existing = [
            SimpleNamespace(
                category=ExperienceCategory.WORK,
                title="项目经理",
                org="腾讯",
            )
        ]

        [result] = apply_duplicate_flags([parsed], existing)

        self.assertFalse(result.duplicate.is_duplicate)


if __name__ == "__main__":
    unittest.main()
