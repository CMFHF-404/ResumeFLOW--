import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app import auth_middleware


class LogtoJwksCacheSecurityTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _cached() -> auth_middleware.LogtoJWKSCache:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            3600,
            unknown_kid_refresh_cooldown_seconds=30,
            refresh_failure_cooldown_seconds=5,
        )
        cache._jwks = {"keys": [{"kid": "known", "kty": "RSA"}]}
        cache._expires_at = 1000
        return cache

    async def test_valid_cache_rejects_unknown_kid_during_refresh_cooldown(self) -> None:
        cache = self._cached()
        cache._unknown_kid_refresh_after = 130
        with (
            patch.object(auth_middleware.time, "monotonic", return_value=100),
            patch.object(cache, "_refresh", new=AsyncMock()) as refresh,
            self.assertRaisesRegex(auth_middleware.AuthError, "Signing key not found"),
        ):
            await cache.get_key("unknown")
        refresh.assert_not_awaited()

    async def test_refresh_failure_cooldown_keeps_known_cached_key_available(self) -> None:
        cache = self._cached()
        cache._refresh_retry_after = 130
        with (
            patch.object(auth_middleware.time, "monotonic", return_value=100),
            patch.object(cache, "_refresh", new=AsyncMock()) as refresh,
        ):
            self.assertEqual((await cache.get_key("known"))["kid"], "known")
            with self.assertRaisesRegex(auth_middleware.AuthError, "JWKS fetch failed"):
                await cache.get_key("unknown")
        refresh.assert_not_awaited()

    async def test_unknown_kid_refreshes_once_after_cooldown_for_rotation(self) -> None:
        cache = self._cached()
        cache._unknown_kid_refresh_after = 90

        async def refresh_rotated_keys() -> None:
            cache._jwks = {"keys": [{"kid": "rotated", "kty": "RSA"}]}
            cache._expires_at = 1000

        with (
            patch.object(auth_middleware.time, "monotonic", return_value=100),
            patch.object(cache, "_refresh", side_effect=refresh_rotated_keys) as refresh,
        ):
            self.assertEqual((await cache.get_key("rotated"))["kid"], "rotated")
            with self.assertRaisesRegex(auth_middleware.AuthError, "Signing key not found"):
                await cache.get_key("another-unknown")
        refresh.assert_awaited_once()

    async def test_expired_cache_refresh_is_singleflight(self) -> None:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            3600,
        )
        refresh_count = 0

        async def refresh_once() -> None:
            nonlocal refresh_count
            refresh_count += 1
            await asyncio.sleep(0.02)
            cache._jwks = {"keys": [{"kid": "rotated", "kty": "RSA"}]}
            cache._expires_at = auth_middleware.time.monotonic() + 3600

        with patch.object(cache, "_refresh", side_effect=refresh_once):
            keys = await asyncio.gather(
                *(cache.get_key("rotated") for _ in range(12))
            )

        self.assertEqual(refresh_count, 1)
        self.assertEqual({key["kid"] for key in keys}, {"rotated"})

    async def test_failed_refresh_is_singleflight_during_failure_cooldown(self) -> None:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            3600,
            refresh_failure_cooldown_seconds=30,
        )
        refresh_count = 0

        async def fail_once() -> None:
            nonlocal refresh_count
            refresh_count += 1
            await asyncio.sleep(0.02)
            raise httpx.ConnectError("jwks unavailable")

        with patch.object(cache, "_refresh", side_effect=fail_once):
            results = await asyncio.gather(
                *(cache.get_key("unknown") for _ in range(12)),
                return_exceptions=True,
            )

        self.assertEqual(refresh_count, 1)
        self.assertTrue(all(isinstance(result, auth_middleware.AuthError) for result in results))

    async def test_valid_cache_unknown_kid_failure_is_singleflight(self) -> None:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            3600,
            refresh_failure_cooldown_seconds=30,
        )
        cache._jwks = {"keys": [{"kid": "known", "kty": "RSA"}]}
        cache._expires_at = auth_middleware.time.monotonic() + 3600
        refresh_count = 0

        async def fail_once() -> None:
            nonlocal refresh_count
            refresh_count += 1
            await asyncio.sleep(0.02)
            raise httpx.ConnectError("jwks unavailable")

        with patch.object(cache, "_refresh", side_effect=fail_once):
            results = await asyncio.gather(
                *(cache.get_key("unknown") for _ in range(12)),
                return_exceptions=True,
            )

        self.assertEqual(refresh_count, 1)
        self.assertTrue(all(isinstance(result, auth_middleware.AuthError) for result in results))

    async def test_oversized_kid_is_rejected_without_refresh(self) -> None:
        cache = self._cached()
        with (
            patch.object(cache, "_refresh", new=AsyncMock()) as refresh,
            self.assertRaises(auth_middleware.AuthError),
        ):
            await cache.get_key("k" * (auth_middleware.MAX_JWT_KID_CHARACTERS + 1))
        refresh.assert_not_awaited()


class JwtInputBoundTests(unittest.IsolatedAsyncioTestCase):
    def test_authorization_header_limit_applies_before_scheme_parsing(self) -> None:
        request = SimpleNamespace(
            headers={
                auth_middleware.AUTH_HEADER: "Basic "
                + "x" * auth_middleware.MAX_AUTHORIZATION_HEADER_CHARACTERS
            }
        )
        with self.assertRaisesRegex(auth_middleware.AuthError, "too long"):
            auth_middleware._extract_token(request)

    async def test_oversized_token_is_rejected_before_jwt_header_decode(self) -> None:
        token = "x" * (auth_middleware.MAX_BEARER_TOKEN_CHARACTERS + 1)
        with (
            patch.object(auth_middleware.jwt, "get_unverified_header") as decode_header,
            self.assertRaisesRegex(auth_middleware.AuthError, "Token is too long"),
        ):
            await auth_middleware._verify_token(token)
        decode_header.assert_not_called()

    async def test_oversized_jwt_header_segment_is_rejected_before_decode(self) -> None:
        token = (
            "x" * (auth_middleware.MAX_JWT_HEADER_SEGMENT_CHARACTERS + 1)
            + ".payload.signature"
        )
        with (
            patch.object(auth_middleware.jwt, "get_unverified_header") as decode_header,
            self.assertRaisesRegex(auth_middleware.AuthError, "Invalid token header"),
        ):
            await auth_middleware._verify_token(token)
        decode_header.assert_not_called()


if __name__ == "__main__":
    unittest.main()
