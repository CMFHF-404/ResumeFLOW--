import unittest
from pathlib import Path

from dotenv import dotenv_values

from app.config import validate_frontend_auth_config, validate_logto_app_id


class FrontendAuthConfigTests(unittest.TestCase):
    def test_local_env_example_uses_derived_frontend_auth_mirror(self) -> None:
        values = dotenv_values(Path(__file__).with_name(".env.example"))

        self.assertEqual(values["RESUMEFLOW_DEPLOYMENT_MODE"], "local")
        self.assertEqual(values["FRONTEND_ORIGIN"], "http://localhost:5173")
        self.assertEqual(values["CORS_ALLOW_ORIGINS"], "http://localhost:5173")
        for name in (
            "FRONTEND_LOGTO_ENDPOINT",
            "FRONTEND_LOGTO_APP_ID",
            "FRONTEND_LOGTO_REDIRECT_URI",
        ):
            with self.subTest(name=name):
                self.assertEqual(values[name], "")

    def test_logto_app_ids_require_the_shared_public_identifier_format(self) -> None:
        for value in ("resume-spa-app-id", "resume_spa_app_id", "abc123"):
            with self.subTest(value=value):
                self.assertEqual(validate_logto_app_id(value, "TEST_APP_ID"), value)

        for value in ("", " app-id", "app-id ", "app id", "app=id", "app.id"):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "TEST_APP_ID"):
                validate_logto_app_id(value, "TEST_APP_ID")

    def test_accepts_one_explicit_public_auth_contract(self) -> None:
        validate_frontend_auth_config(
            logto_issuer="https://tenant.logto.app/oidc",
            logto_app_id="resume-spa-app-id",
            frontend_origin="https://app.example.com",
            cors_allow_origins=["https://app.example.com"],
            frontend_logto_endpoint="https://tenant.logto.app",
            frontend_logto_app_id="resume-spa-app-id",
            frontend_logto_redirect_uri="https://app.example.com/callback",
            require_explicit=True,
        )

    def test_rejects_missing_or_drifted_public_auth_values(self) -> None:
        valid = {
            "logto_issuer": "https://tenant.logto.app/oidc",
            "logto_app_id": "resume-spa-app-id",
            "frontend_origin": "https://app.example.com",
            "cors_allow_origins": ["https://app.example.com"],
            "frontend_logto_endpoint": "https://tenant.logto.app",
            "frontend_logto_app_id": "resume-spa-app-id",
            "frontend_logto_redirect_uri": "https://app.example.com/callback",
            "require_explicit": True,
        }
        cases = (
            ({"frontend_logto_endpoint": None}, "FRONTEND_LOGTO_ENDPOINT"),
            ({"frontend_logto_endpoint": "https://other.logto.app"}, "FRONTEND_LOGTO_ENDPOINT"),
            ({"frontend_logto_app_id": "other-spa-app-id"}, "FRONTEND_LOGTO_APP_ID"),
            ({"frontend_logto_redirect_uri": "https://other.example.com/callback"}, "FRONTEND_LOGTO_REDIRECT_URI"),
            ({"frontend_logto_redirect_uri": "https://app.example.com/callback?next=/"}, "FRONTEND_LOGTO_REDIRECT_URI"),
            ({"cors_allow_origins": ["https://other.example.com"]}, "CORS_ALLOW_ORIGINS"),
        )

        for override, message in cases:
            with self.subTest(override=override), self.assertRaisesRegex(RuntimeError, message):
                validate_frontend_auth_config(**(valid | override))

    def test_loopback_development_can_derive_the_public_mirror_values(self) -> None:
        validate_frontend_auth_config(
            logto_issuer="https://tenant.logto.app/oidc",
            logto_app_id="resume-spa-app-id",
            frontend_origin="http://localhost:5173",
            cors_allow_origins=["http://localhost:5173"],
            frontend_logto_endpoint=None,
            frontend_logto_app_id=None,
            frontend_logto_redirect_uri=None,
            require_explicit=False,
        )


if __name__ == "__main__":
    unittest.main()
