import os
import subprocess
import sys
import unittest


class BackendStartupImportTests(unittest.TestCase):
    def test_disabled_payment_with_stale_provider_url_does_not_block_startup_import(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "LOGTO_ISSUER": "https://example.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "YIFUT_ENABLED": "false",
                "YIFUT_BASE_URL": "not-a-valid-provider-url",
                "FRONTEND_ORIGIN": "http://localhost:5173",
                "PUBLIC_API_ORIGIN": "http://127.0.0.1:8000",
            }
        )

        result = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from app.config import DEFAULT_YIFUT_BASE_URL, load_settings; "
                    "assert load_settings().yifut_base_url == DEFAULT_YIFUT_BASE_URL; "
                    "import app.main; print('disabled payment import ok')"
                ),
            ],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        self.assertIn("disabled payment import ok", result.stdout)

    def test_main_imports_in_fresh_process_without_auth_billing_cycle(self) -> None:
        env = os.environ.copy()
        env["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
        env.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
        env.setdefault("LOGTO_APP_ID", "resume-spa-app-id")
        env.setdefault("REDEMPTION_CODE_ENCRYPTION_KEY", "unit-test-redemption-secret")

        result = subprocess.run(
            [sys.executable, "-c", "import app.main; print('main import ok')"],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        self.assertIn("main import ok", result.stdout)

    def test_init_db_registers_models_before_create_all(self) -> None:
        env = os.environ.copy()
        env["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
        script = """
import asyncio
from app import database

assert not database.SQLModel.metadata.tables

class Connection:
    async def run_sync(self, callback):
        assert 'users' in database.SQLModel.metadata.tables
        assert 'resumes' in database.SQLModel.metadata.tables

class Transaction:
    async def __aenter__(self):
        return Connection()

    async def __aexit__(self, exc_type, exc, traceback):
        return None

class Engine:
    def begin(self):
        return Transaction()

database.engine = Engine()
asyncio.run(database.init_db())
print('model registration ok')
"""

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        self.assertIn("model registration ok", result.stdout)


if __name__ == "__main__":
    unittest.main()
