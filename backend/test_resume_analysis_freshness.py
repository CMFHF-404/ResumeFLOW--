import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app.domain.resume.resume_analysis_freshness import (  # noqa: E402
    invalidate_user_resume_analyses,
)


class ResumeAnalysisFreshnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_bank_change_marks_current_user_analyses_outdated(self) -> None:
        session = SimpleNamespace(execute=AsyncMock())
        updated_at = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)

        await invalidate_user_resume_analyses(
            session,
            "user-1",
            updated_at=updated_at,
        )

        self.assertEqual(session.execute.await_count, 2)
        statement, parameters = session.execute.await_args_list[-1].args
        sql = str(statement)
        self.assertIn("UPDATE resumes", sql)
        self.assertIn("'{jdAnalysis,isOutdated}'", sql)
        self.assertIn("'{jdAnalysis,evaluationIsOutdated}'", sql)
        self.assertIn("-> 'evaluationIsOutdated'", sql)
        self.assertIn("WHERE user_id = :user_id", sql)
        self.assertIn("jsonb_typeof", sql)
        self.assertEqual(
            parameters,
            {
                "user_id": "user-1",
                "updated_at": updated_at,
            },
        )


if __name__ == "__main__":
    unittest.main()
