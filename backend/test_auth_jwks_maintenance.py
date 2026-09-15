import asyncio
import time
import unittest

import httpx

from app.auth_middleware import AuthDependencyUnavailable, LogtoJWKSCache
from test_auth_jwks_availability import _valid_rsa_jwk


class JWKSBackgroundMaintenanceTests(unittest.IsolatedAsyncioTestCase):
    async def make_cache(self, handler, **options):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(client.aclose)
        cache = LogtoJWKSCache(
            "https://tenant.example.test/oidc/jwks", 60,
            client=client, refresh_attempts=1, **options,
        )
        self.addAsyncCleanup(cache.close)
        return cache

    async def test_cold_start_recovers_without_users_or_readiness_probes(self):
        key = _valid_rsa_jwk("known")
        recovered = asyncio.Event()
        calls = 0

        async def handler(request):
            nonlocal calls
            calls += 1
            if calls <= 2:
                raise httpx.ConnectTimeout("temporary outage", request=request)
            recovered.set()
            return httpx.Response(200, json={"keys": [key]})

        cache = await self.make_cache(handler, refresh_failure_cooldown_seconds=0)
        with self.assertRaises(AuthDependencyUnavailable):
            await cache.warmup()
        self.assertFalse(cache.is_ready)
        cache.start_refresh_worker()
        task = cache._refresh_task
        cache.start_refresh_worker()
        self.assertIs(cache._refresh_task, task)
        await asyncio.wait_for(recovered.wait(), timeout=3)
        self.assertTrue(cache.is_ready)
        self.assertEqual(calls, 3)
        self.assertEqual(await cache.get_key("known"), key)
        self.assertEqual(calls, 3)

    async def test_refreshes_before_expiry_without_blocking_known_key_requests(self):
        old_key = _valid_rsa_jwk("old")
        new_key = _valid_rsa_jwk("new")
        fetching = asyncio.Event()
        release = asyncio.Event()
        finished = asyncio.Event()

        async def handler(request):
            fetching.set()
            await release.wait()
            finished.set()
            return httpx.Response(200, json={"keys": [new_key]})

        cache = await self.make_cache(handler)
        cache._jwks = {"keys": [old_key]}
        cache._expires_at = time.monotonic() + 5
        cache._stale_until = cache._expires_at + 900
        cache.start_refresh_worker()
        await asyncio.wait_for(fetching.wait(), timeout=1)
        self.assertEqual(
            await asyncio.wait_for(cache.get_key("old"), timeout=0.2), old_key,
        )
        release.set()
        await asyncio.wait_for(finished.wait(), timeout=1)
        self.assertEqual(await cache.get_key("new"), new_key)
        self.assertIsNone(cache._find_key("old"))

    async def test_failed_refresh_does_not_extend_expired_key_trust(self):
        failed = asyncio.Event()

        async def handler(request):
            failed.set()
            raise httpx.ConnectTimeout("offline", request=request)

        cache = await self.make_cache(handler)
        cache._jwks = {"keys": [_valid_rsa_jwk("old")]}
        cache._expires_at = time.monotonic() - 901
        cache._stale_until = time.monotonic() - 1
        deadline = cache._stale_until
        cache.start_refresh_worker()
        await asyncio.wait_for(failed.wait(), timeout=1)
        self.assertFalse(cache.is_ready)
        self.assertEqual(cache._stale_until, deadline)
        for kid in ("old", "unknown"):
            with self.assertRaises(AuthDependencyUnavailable):
                await cache.get_key(kid)

    async def test_close_cancels_inflight_background_fetch(self):
        fetching = asyncio.Event()
        cancelled = asyncio.Event()

        async def handler(request):
            fetching.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        cache = await self.make_cache(handler)
        cache.start_refresh_worker()
        await asyncio.wait_for(fetching.wait(), timeout=1)
        await asyncio.wait_for(cache.close(), timeout=1)
        self.assertTrue(cancelled.is_set())
        self.assertIsNone(cache._refresh_task)
        self.assertIsNone(cache._client)


if __name__ == "__main__":
    unittest.main()
