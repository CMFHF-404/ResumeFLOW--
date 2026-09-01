import json
import base64
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from app import auth_middleware


def _request(path: str = "/api/profile") -> SimpleNamespace:
    return SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        headers={auth_middleware.AUTH_HEADER: "Bearer header.payload.signature"},
        query_params=SimpleNamespace(getlist=lambda _name: []),
    )


def _token_with_header(header: dict[str, str]) -> str:
    def encode(value: object) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    return f"{encode(header)}.{encode({'sub': 'user-1'})}.AA"


def _base64url_uint(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _valid_rsa_jwk(kid: str) -> dict[str, str]:
    numbers = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    ).public_key().public_numbers()
    return {
        "kid": kid,
        "kty": "RSA",
        "n": _base64url_uint(numbers.n),
        "e": _base64url_uint(numbers.e),
    }


def _rsa_signing_material(kid: str) -> tuple[bytes, dict[str, str]]:
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    numbers = private_key.public_key().public_numbers()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_pem, {
        "kid": kid,
        "kty": "RSA",
        "n": _base64url_uint(numbers.n),
        "e": _base64url_uint(numbers.e),
    }


def _bogus_ec_jwk(kid: str) -> dict[str, str]:
    return {"kid": kid, "kty": "EC", "crv": "bogus", "x": "AA", "y": "AA"}


class AuthFailureResponseContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_jwks_failure_is_503_and_does_not_masquerade_as_invalid_token(self) -> None:
        middleware = auth_middleware.LogtoAuthMiddleware(lambda *_args: None)
        with patch.object(
            auth_middleware,
            "_verify_token",
            new=AsyncMock(
                side_effect=auth_middleware.AuthDependencyUnavailable(
                    "Authentication key service is temporarily unavailable",
                    retry_after_seconds=7,
                )
            ),
        ):
            response = await middleware.dispatch(_request(), AsyncMock())

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "7")
        self.assertNotIn("www-authenticate", response.headers)
        self.assertEqual(
            json.loads(response.body),
            {
                "error": {
                    "code": "auth_dependency_unavailable",
                    "message": "Authentication key service is temporarily unavailable",
                }
            },
        )

    async def test_real_token_rejection_remains_401_with_bearer_challenge(self) -> None:
        middleware = auth_middleware.LogtoAuthMiddleware(lambda *_args: None)
        with patch.object(
            auth_middleware,
            "_verify_token",
            new=AsyncMock(
                side_effect=auth_middleware.TokenValidationError("Invalid token")
            ),
        ):
            response = await middleware.dispatch(_request(), AsyncMock())

        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.headers["www-authenticate"],
            'Bearer error="invalid_token"',
        )
        self.assertEqual(json.loads(response.body)["error"]["code"], "invalid_token")

    async def test_token_algorithm_key_type_mismatch_remains_401(self) -> None:
        token = _token_with_header({"alg": "ES384", "kid": "known"})
        request = _request()
        request.headers = {auth_middleware.AUTH_HEADER: f"Bearer {token}"}

        with patch.object(
            auth_middleware.jwks_cache,
            "get_key",
            new=AsyncMock(return_value=_valid_rsa_jwk("known")),
        ):
            response = await auth_middleware.LogtoAuthMiddleware(
                lambda *_args: None
            ).dispatch(request, AsyncMock())

        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.body)["error"]["code"], "invalid_token")
        self.assertNotIn("retry-after", response.headers)

    async def test_malformed_rsa_jwk_returns_503_instead_of_escaping_as_500(self) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "keys": [{"kid": "broken", "kty": "RSA", "n": "***", "e": "AQAB"}]
        }
        client = AsyncMock()
        client.is_closed = False
        client.get.return_value = response
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=1,
            client=client,
        )
        token = _token_with_header({"alg": "RS256", "kid": "broken"})
        request = _request()
        request.headers = {auth_middleware.AUTH_HEADER: f"Bearer {token}"}

        with patch.object(auth_middleware, "jwks_cache", cache):
            response = await auth_middleware.LogtoAuthMiddleware(
                lambda *_args: None
            ).dispatch(request, AsyncMock())

        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body)["error"]["code"], "auth_dependency_unavailable")
        self.assertIn("retry-after", response.headers)

    async def test_bogus_ec_curve_jwk_returns_503_instead_of_escaping_as_500(self) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"keys": [_bogus_ec_jwk("broken")]}
        client = AsyncMock()
        client.is_closed = False
        client.get.return_value = response
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=1,
            client=client,
        )
        token = _token_with_header({"alg": "ES384", "kid": "broken"})
        request = _request()
        request.headers = {auth_middleware.AUTH_HEADER: f"Bearer {token}"}

        with patch.object(auth_middleware, "jwks_cache", cache):
            response = await auth_middleware.LogtoAuthMiddleware(
                lambda *_args: None
            ).dispatch(request, AsyncMock())

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            json.loads(response.body)["error"]["code"],
            "auth_dependency_unavailable",
        )
        self.assertIn("retry-after", response.headers)

    async def test_decode_key_error_is_auth_dependency_unavailable(self) -> None:
        token = _token_with_header({"alg": "RS256", "kid": "known"})
        with (
            patch.object(
                auth_middleware.jwks_cache,
                "get_key",
                new=AsyncMock(return_value=_valid_rsa_jwk("known")),
            ),
            patch.object(auth_middleware.jwt, "decode", side_effect=KeyError("bogus")),
            self.assertRaises(auth_middleware.AuthDependencyUnavailable),
        ):
            await auth_middleware._verify_token(token)

    async def test_signed_malformed_registered_claims_remain_401(self) -> None:
        private_pem, public_jwk = _rsa_signing_material("known")
        middleware = auth_middleware.LogtoAuthMiddleware(lambda *_args: None)

        for claim_name in ("exp", "nbf"):
            with self.subTest(claim_name=claim_name):
                token = auth_middleware.jwt.encode(
                    {
                        "sub": "user-1",
                        "aud": auth_middleware.settings.logto_app_id,
                        "iss": auth_middleware.settings.logto_issuer,
                        claim_name: [],
                    },
                    private_pem,
                    algorithm="RS256",
                    headers={"kid": "known"},
                )
                request = _request()
                request.headers = {
                    auth_middleware.AUTH_HEADER: f"Bearer {token}"
                }
                with patch.object(
                    auth_middleware.jwks_cache,
                    "get_key",
                    new=AsyncMock(return_value=public_jwk),
                ):
                    response = await middleware.dispatch(request, AsyncMock())

                self.assertEqual(response.status_code, 401)
                self.assertEqual(
                    json.loads(response.body)["error"]["code"],
                    "invalid_token",
                )
                self.assertNotIn("retry-after", response.headers)


class JwksAvailabilityTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _expired_cache() -> auth_middleware.LogtoJWKSCache:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            stale_if_error_seconds=300,
            refresh_attempts=1,
        )
        cache._jwks = {"keys": [{"kid": "known", "kty": "RSA"}]}
        cache._expires_at = 100
        cache._stale_until = 400
        return cache

    async def test_expired_known_kid_uses_bounded_stale_key_when_refresh_fails(self) -> None:
        cache = self._expired_cache()
        with (
            patch.object(auth_middleware.time, "monotonic", return_value=200),
            patch.object(
                cache,
                "_refresh",
                new=AsyncMock(side_effect=httpx.ConnectError("jwks unavailable")),
            ),
        ):
            key = await cache.get_key("known")

        self.assertEqual(key["kid"], "known")

    async def test_stale_key_is_rejected_after_bounded_window(self) -> None:
        cache = self._expired_cache()
        with (
            patch.object(auth_middleware.time, "monotonic", return_value=401),
            patch.object(
                cache,
                "_refresh",
                new=AsyncMock(side_effect=httpx.ConnectError("jwks unavailable")),
            ),
            self.assertRaises(auth_middleware.AuthDependencyUnavailable),
        ):
            await cache.get_key("known")

    async def test_unknown_kid_never_uses_stale_key_when_upstream_is_down(self) -> None:
        cache = self._expired_cache()
        with (
            patch.object(auth_middleware.time, "monotonic", return_value=200),
            patch.object(
                cache,
                "_refresh",
                new=AsyncMock(side_effect=httpx.ConnectError("jwks unavailable")),
            ),
            self.assertRaises(auth_middleware.AuthDependencyUnavailable),
        ):
            await cache.get_key("unknown")

    async def test_cold_cache_is_not_ready_until_successful_warmup(self) -> None:
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=1,
        )
        self.assertFalse(cache.is_ready)

        async def warm_keys() -> None:
            cache._jwks = {"keys": [{"kid": "known", "kty": "RSA"}]}
            cache._expires_at = 500
            cache._stale_until = 800

        with (
            patch.object(auth_middleware.time, "monotonic", return_value=200),
            patch.object(cache, "_refresh", new=AsyncMock(side_effect=warm_keys)),
        ):
            await cache.warmup()
            self.assertTrue(cache.is_ready)

    async def test_refresh_retries_are_bounded_and_reuse_the_same_client(self) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "keys": [_valid_rsa_jwk("known")]
        }
        client = AsyncMock()
        client.is_closed = False
        client.get.side_effect = [
            httpx.ConnectError("first failure"),
            httpx.ConnectError("second failure"),
            response,
            response,
        ]
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=3,
            refresh_backoff_seconds=0,
            client=client,
        )

        await cache.warmup()
        await cache._refresh()

        self.assertEqual(client.get.await_count, 4)
        client.aclose.assert_not_awaited()

    async def test_malformed_jwks_is_dependency_failure_not_token_rejection(self) -> None:
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"keys": [{}]}
        client = AsyncMock()
        client.is_closed = False
        client.get.return_value = response
        cache = auth_middleware.LogtoJWKSCache(
            "https://tenant.example.test/jwks",
            60,
            refresh_attempts=1,
            client=client,
        )

        with self.assertRaises(auth_middleware.AuthDependencyUnavailable):
            await cache.get_key("unknown")

    async def test_malformed_rsa_and_ec_keys_never_make_cache_ready(self) -> None:
        malformed_keys = (
            {"kid": "rsa", "kty": "RSA", "n": "***", "e": "AQAB"},
            {"kid": "ec", "kty": "EC", "crv": "P-384", "x": "***", "y": "***"},
        )
        for malformed_key in malformed_keys:
            with self.subTest(kty=malformed_key["kty"]):
                response = Mock()
                response.raise_for_status.return_value = None
                response.json.return_value = {"keys": [malformed_key]}
                client = AsyncMock()
                client.is_closed = False
                client.get.return_value = response
                cache = auth_middleware.LogtoJWKSCache(
                    "https://tenant.example.test/jwks",
                    60,
                    refresh_attempts=1,
                    client=client,
                )

                with self.assertRaises(auth_middleware.AuthDependencyUnavailable):
                    await cache.warmup()
                self.assertFalse(cache.is_ready)


if __name__ == "__main__":
    unittest.main()
