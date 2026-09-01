import os
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi.responses import JSONResponse


os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
)
os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")

from app import main  # noqa: E402


class AuthReadinessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.database_probe = AsyncMock()
        database_patch = patch.object(
            main,
            "verify_db_connection",
            new=self.database_probe,
        )
        database_patch.start()
        self.addCleanup(database_patch.stop)

    async def test_readiness_is_503_when_database_becomes_unavailable(self) -> None:
        self.database_probe.side_effect = RuntimeError("database unavailable")
        with (
            patch.object(
                main,
                "settings",
                SimpleNamespace(enable_dev_auth_bypass=False),
            ),
            patch.object(
                main.auth_middleware.jwks_cache,
                "_jwks",
                {"keys": [{"kid": "known", "kty": "RSA"}]},
            ),
            patch.object(main.auth_middleware.jwks_cache, "_stale_until", float("inf")),
        ):
            response = await main.readiness_check()

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body)["error"]["code"],
            "database_unavailable",
        )
        self.database_probe.assert_awaited_once()

    async def test_readiness_is_503_for_a_jwk_with_an_unknown_ec_curve(self) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "keys": [
                {
                    "kid": "broken",
                    "kty": "EC",
                    "crv": "bogus",
                    "x": "AA",
                    "y": "AA",
                }
            ]
        }
        client = AsyncMock()
        client.is_closed = False
        client.get.return_value = response
        cache = main.auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=1,
            client=client,
        )

        with (
            patch.object(
                main,
                "settings",
                SimpleNamespace(enable_dev_auth_bypass=False),
            ),
            patch.object(main.auth_middleware, "jwks_cache", cache),
        ):
            response = await main.readiness_check()

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 503)

    async def test_readiness_is_503_while_auth_keys_are_cold(self) -> None:
        with (
            patch.object(
                main,
                "settings",
                SimpleNamespace(enable_dev_auth_bypass=False),
            ),
            patch.object(main.auth_middleware.jwks_cache, "_jwks", {}),
            patch.object(main.auth_middleware.jwks_cache, "_stale_until", 0),
            patch.object(
                main.auth_middleware.jwks_cache,
                "warmup",
                new=AsyncMock(
                    side_effect=main.auth_middleware.AuthDependencyUnavailable(
                        "JWKS fetch failed",
                        retry_after_seconds=5,
                    )
                ),
            ),
        ):
            response = await main.readiness_check()

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 503)

    async def test_readiness_is_200_after_auth_warmup(self) -> None:
        with (
            patch.object(
                main,
                "settings",
                SimpleNamespace(enable_dev_auth_bypass=False),
            ),
            patch.object(
                main.auth_middleware.jwks_cache,
                "_jwks",
                {"keys": [{"kid": "known", "kty": "RSA"}]},
            ),
            patch.object(main.auth_middleware.jwks_cache, "_stale_until", float("inf")),
        ):
            response = await main.readiness_check()

        self.assertEqual(response, {"status": "ready"})
        self.database_probe.assert_awaited_once_with(log_result=False)

    async def test_readiness_probe_recovers_a_failed_cold_start(self) -> None:
        cache = main.auth_middleware.jwks_cache

        async def recover() -> None:
            cache._jwks = {"keys": [{"kid": "known", "kty": "RSA"}]}
            cache._stale_until = float("inf")

        with (
            patch.object(
                main,
                "settings",
                SimpleNamespace(enable_dev_auth_bypass=False),
            ),
            patch.object(cache, "_jwks", {}),
            patch.object(cache, "_stale_until", 0),
            patch.object(cache, "warmup", new=AsyncMock(side_effect=recover)) as warmup,
        ):
            response = await main.readiness_check()

        self.assertEqual(response, {"status": "ready"})
        warmup.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
