import os
import unittest
from datetime import date


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume import resume_service  # noqa: E402
from app.models import ExperienceVersion  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
