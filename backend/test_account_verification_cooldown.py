import asyncio
import os
import unittest


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_AUDIENCE", "https://api.example.com")


_set_required_env_defaults()

from app.domain.account.verification_cooldown_service import (  # noqa: E402
    VERIFICATION_CODE_COOLDOWN_SECONDS,
    VerificationCodeCooldownError,
    VerificationCodeCooldownStore,
)
from app.domain.account import account_router  # noqa: E402


class VerificationCodeCooldownStoreTests(unittest.IsolatedAsyncioTestCase):
    def test_account_router_exposes_cooldown_endpoint(self) -> None:
        routes = {
            getattr(route, "path", "")
            for route in account_router.router.routes
        }

        self.assertIn("/account/verification-code-cooldown", routes)

    async def test_second_request_within_cooldown_is_rejected(self) -> None:
        now = 1000.0
        store = VerificationCodeCooldownStore(now=lambda: now)

        first = await store.reserve(
            user_id="user-1",
            identifier_type="phone",
            identifier_value="13237737767",
        )

        self.assertEqual(first.retry_after_seconds, 0)
        with self.assertRaises(VerificationCodeCooldownError) as raised:
            await store.reserve(
                user_id="user-1",
                identifier_type="phone",
                identifier_value="13237737767",
            )
        self.assertEqual(raised.exception.retry_after_seconds, VERIFICATION_CODE_COOLDOWN_SECONDS)
        self.assertEqual(raised.exception.message, "请稍后再试")

    async def test_release_allows_retry_after_failed_send(self) -> None:
        store = VerificationCodeCooldownStore(now=lambda: 1500.0)

        await store.reserve(
            user_id="user-1",
            identifier_type="email",
            identifier_value="User@Example.com",
        )

        released = await store.release(
            user_id="user-1",
            identifier_type="email",
            identifier_value="user@example.com",
        )

        self.assertTrue(released)
        retry = await store.reserve(
            user_id="user-1",
            identifier_type="email",
            identifier_value="user@example.com",
        )
        self.assertEqual(retry.retry_after_seconds, 0)

    async def test_concurrent_requests_for_same_identifier_only_allow_one(self) -> None:
        store = VerificationCodeCooldownStore(now=lambda: 2000.0)

        async def reserve_once():
            try:
                await store.reserve(
                    user_id="user-1",
                    identifier_type="phone",
                    identifier_value="+86 132 3773 7767",
                )
                return "allowed"
            except VerificationCodeCooldownError:
                return "blocked"

        results = await asyncio.gather(reserve_once(), reserve_once())

        self.assertEqual(sorted(results), ["allowed", "blocked"])


if __name__ == "__main__":
    unittest.main()
