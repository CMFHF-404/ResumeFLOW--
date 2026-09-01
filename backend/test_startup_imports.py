import os
import subprocess
import sys
import unittest


class BackendStartupImportTests(unittest.TestCase):
    def test_production_mode_requires_frontend_origin_and_cors(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                # Empty values prevent a local backend/.env from masking the
                # intentionally absent production contract in this subprocess.
                "FRONTEND_ORIGIN": "",
                "CORS_ALLOW_ORIGINS": "",
                "FRONTEND_LOGTO_ENDPOINT": "",
                "FRONTEND_LOGTO_APP_ID": "",
                "FRONTEND_LOGTO_REDIRECT_URI": "",
            }
        )

        result = subprocess.run(
            [sys.executable, "-c", "from app.config import load_settings; load_settings()"],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FRONTEND_ORIGIN", result.stderr)

    def test_local_mode_is_the_default_and_allows_loopback_auth_derivation(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "",
                "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "FRONTEND_ORIGIN": "",
                "CORS_ALLOW_ORIGINS": "",
                "FRONTEND_LOGTO_ENDPOINT": "",
                "FRONTEND_LOGTO_APP_ID": "",
                "FRONTEND_LOGTO_REDIRECT_URI": "",
            }
        )

        result = subprocess.run(
            [sys.executable, "-c", "from app.config import load_settings; load_settings()"],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_remote_frontend_auth_mirror_is_required_before_application_import(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "FRONTEND_ORIGIN": "https://app.example.com",
                "CORS_ALLOW_ORIGINS": "https://app.example.com",
            }
        )
        for name in (
            "FRONTEND_LOGTO_ENDPOINT",
            "FRONTEND_LOGTO_APP_ID",
            "FRONTEND_LOGTO_REDIRECT_URI",
        ):
            # Keep dotenv from an operator's local backend/.env from masking
            # the intentionally missing production mirror in this subprocess.
            env[name] = ""

        result = subprocess.run(
            [sys.executable, "-c", "from app.config import load_settings; load_settings()"],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("FRONTEND_LOGTO_ENDPOINT", result.stderr)

    def test_production_rejects_matching_but_malformed_logto_app_ids(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                "LOGTO_APP_ID": "resume spa app id",
                "FRONTEND_ORIGIN": "https://app.example.com",
                "CORS_ALLOW_ORIGINS": "https://app.example.com",
                "FRONTEND_LOGTO_ENDPOINT": "https://tenant.logto.app",
                "FRONTEND_LOGTO_APP_ID": "resume spa app id",
                "FRONTEND_LOGTO_REDIRECT_URI": "https://app.example.com/callback",
            }
        )

        result = subprocess.run(
            [sys.executable, "-c", "from app.config import load_settings; load_settings()"],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("LOGTO_APP_ID", result.stderr)

    def test_production_rejects_truthy_dev_auth_bypass_before_app_import(self) -> None:
        for value in ("1", "true", "yes", "on"):
            with self.subTest(value=value):
                env = os.environ.copy()
                env.update(
                    {
                        "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                        "RESUMEFLOW_DEPLOYMENT_MODE": "production",
                        "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                        "LOGTO_APP_ID": "resume-spa-app-id",
                        "FRONTEND_ORIGIN": "https://app.example.com",
                        "CORS_ALLOW_ORIGINS": "https://app.example.com",
                        "FRONTEND_LOGTO_ENDPOINT": "https://tenant.logto.app",
                        "FRONTEND_LOGTO_APP_ID": "resume-spa-app-id",
                        "FRONTEND_LOGTO_REDIRECT_URI": "https://app.example.com/callback",
                        "ENABLE_DEV_AUTH_BYPASS": value,
                    }
                )

                result = subprocess.run(
                    [sys.executable, "-c", "import app.main"],
                    cwd=os.path.dirname(__file__),
                    env=env,
                    text=True,
                    capture_output=True,
                    check=False,
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ENABLE_DEV_AUTH_BYPASS", result.stderr)

    def test_local_mode_still_allows_dev_auth_bypass(self) -> None:
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
                "RESUMEFLOW_DEPLOYMENT_MODE": "local",
                "LOGTO_ISSUER": "https://tenant.logto.app/oidc",
                "LOGTO_APP_ID": "resume-spa-app-id",
                "FRONTEND_ORIGIN": "http://localhost:5173",
                "CORS_ALLOW_ORIGINS": "http://localhost:5173",
                "ENABLE_DEV_AUTH_BYPASS": "true",
            }
        )

        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from app.config import load_settings; assert load_settings().enable_dev_auth_bypass",
            ],
            cwd=os.path.dirname(__file__),
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

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
