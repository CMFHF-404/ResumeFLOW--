import os
import subprocess
import sys
import unittest


def _test_env() -> dict[str, str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    env.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    env.setdefault("LOGTO_APP_ID", "resume-spa-app-id")
    return env


class AssistantContextBoundaryTests(unittest.TestCase):
    def test_router_reexports_context_projection_helpers(self) -> None:
        from app.domain.assistant import assistant_context_service, assistant_router

        self.assertIs(
            assistant_router._normalize_bank_text,
            assistant_context_service._normalize_bank_text,
        )
        self.assertIs(
            assistant_router._serialize_optional_date,
            assistant_context_service._serialize_optional_date,
        )
        self.assertIs(
            assistant_router._build_star_snapshot,
            assistant_context_service._build_star_snapshot,
        )
        self.assertEqual(
            assistant_router.BANK_CONTEXT_FETCH_BATCH_SIZE,
            assistant_context_service.BANK_CONTEXT_FETCH_BATCH_SIZE,
        )

    def test_context_projection_runs_without_importing_http_router(self) -> None:
        script = """
import sys
from app.domain.assistant.assistant_context_service import project_bank_context

payload = project_bank_context(
    profile=None,
    experience_rows=[],
    certifications=[],
    skills=[],
)
assert payload == {
    "profile": {},
    "experiences": {"work": [], "project": [], "education": []},
    "certifications": [],
    "skills": [],
}
assert "app.domain.assistant.assistant_router" not in sys.modules
"""
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=_test_env(),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
