import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from jose import JWTError


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app import auth_middleware  # noqa: E402


class AuthMiddlewareIdTokenTests(unittest.IsolatedAsyncioTestCase):
    async def test_verify_token_uses_logto_app_id_as_audience(self) -> None:
        fake_settings = SimpleNamespace(
            logto_app_id="resume-spa-app-id",
            logto_issuer="https://example.logto.app/oidc",
        )

        with patch.object(auth_middleware, "settings", fake_settings):
            with patch.object(
                auth_middleware.jwt,
                "get_unverified_header",
                return_value={"alg": "RS256", "kid": "key-id"},
            ):
                with patch.object(
                    auth_middleware._jwks_cache,
                    "get_key",
                    new=AsyncMock(return_value={"kty": "RSA"}),
                ):
                    with patch.object(
                        auth_middleware.jwt,
                        "decode",
                        return_value={"sub": "user-1", "aud": "resume-spa-app-id"},
                    ) as decode:
                        claims = await auth_middleware._verify_token("id-token")

        self.assertEqual(claims["sub"], "user-1")
        self.assertEqual(decode.call_args.kwargs["audience"], "resume-spa-app-id")
        self.assertEqual(
            decode.call_args.kwargs["issuer"],
            "https://example.logto.app/oidc",
        )

    async def test_verify_token_rejects_management_or_backend_resource_audience(self) -> None:
        fake_settings = SimpleNamespace(
            logto_app_id="resume-spa-app-id",
            logto_issuer="https://example.logto.app/oidc",
        )

        with patch.object(auth_middleware, "settings", fake_settings):
            with patch.object(
                auth_middleware.jwt,
                "get_unverified_header",
                return_value={"alg": "RS256", "kid": "key-id"},
            ):
                with patch.object(
                    auth_middleware._jwks_cache,
                    "get_key",
                    new=AsyncMock(return_value={"kty": "RSA"}),
                ):
                    with patch.object(
                        auth_middleware.jwt,
                        "decode",
                        side_effect=JWTError("Invalid audience"),
                    ) as decode:
                        with self.assertRaises(auth_middleware.AuthError):
                            await auth_middleware._verify_token("wrong-audience-token")

        self.assertEqual(decode.call_args.kwargs["audience"], "resume-spa-app-id")

    async def test_verify_token_skips_at_hash_verification_for_bearer_id_tokens(self) -> None:
        fake_settings = SimpleNamespace(
            logto_app_id="resume-spa-app-id",
            logto_issuer="https://example.logto.app/oidc",
        )

        with patch.object(auth_middleware, "settings", fake_settings):
            with patch.object(
                auth_middleware.jwt,
                "get_unverified_header",
                return_value={"alg": "ES384", "kid": "key-id"},
            ):
                with patch.object(
                    auth_middleware._jwks_cache,
                    "get_key",
                    new=AsyncMock(return_value={"kty": "EC"}),
                ):
                    with patch.object(
                        auth_middleware.jwt,
                        "decode",
                        return_value={"sub": "user-1", "aud": "resume-spa-app-id"},
                    ) as decode:
                        await auth_middleware._verify_token("id-token-with-at-hash")

        self.assertEqual(
            decode.call_args.kwargs["options"],
            {"verify_at_hash": False},
        )


if __name__ == "__main__":
    unittest.main()
