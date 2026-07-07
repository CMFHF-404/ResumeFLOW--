import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy.dialects import postgresql


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from app import auth_middleware  # noqa: E402
from app.domain.account import user_onboarding_service  # noqa: E402
from app.domain.profile import profile_service  # noqa: E402
from app.models import AITokenPurchaseEvent, AITokenWallet  # noqa: E402


class _ScalarResult:
    def __init__(self, first_value=None):
        self._first_value = first_value

    def first(self):
        return self._first_value


class _ExecuteResult:
    def __init__(self, first_value=None, scalar_one_or_none_value=None):
        self._first_value = first_value
        self._scalar_one_or_none_value = scalar_one_or_none_value

    def scalars(self):
        return _ScalarResult(self._first_value)

    def scalar_one_or_none(self):
        return self._scalar_one_or_none_value


class _FakeSession:
    def __init__(self, execute_values=None):
        self.execute_values = list(execute_values or [])
        self.statements = []
        self.added = []
        self.commits = 0
        self.refreshed = []

    async def execute(self, statement):
        self.statements.append(statement)
        if self.execute_values:
            return self.execute_values.pop(0)
        return _ExecuteResult()

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        return None

    async def refresh(self, value):
        self.refreshed.append(value)


class _FakeSessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class UserOnboardingTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_user_insert_grants_signup_bonus_once(self) -> None:
        session = _FakeSession([
            _ExecuteResult(scalar_one_or_none_value="user-new"),
            _ExecuteResult(first_value=None),
        ])

        created = await user_onboarding_service.ensure_user_with_signup_bonus(session, "user-new")

        self.assertTrue(created)
        wallet = next(item for item in session.added if isinstance(item, AITokenWallet))
        purchase = next(item for item in session.added if isinstance(item, AITokenPurchaseEvent))
        self.assertEqual(wallet.user_id, "user-new")
        self.assertEqual(wallet.remaining_tokens, 200_000)
        self.assertEqual(wallet.token_limit, 200_000)
        self.assertEqual(purchase.source, "signup_bonus")
        self.assertEqual(purchase.status, "signup_bonus_granted")
        compiled = str(session.statements[0].compile(dialect=postgresql.dialect()))
        self.assertIn("ON CONFLICT", compiled)
        self.assertIn("RETURNING", compiled)

    async def test_existing_user_insert_conflict_does_not_grant_bonus(self) -> None:
        session = _FakeSession([
            _ExecuteResult(scalar_one_or_none_value=None),
        ])

        created = await user_onboarding_service.ensure_user_with_signup_bonus(session, "user-existing")

        self.assertFalse(created)
        self.assertEqual(session.added, [])
        self.assertEqual(len(session.statements), 1)

    async def test_auth_middleware_user_creation_uses_onboarding_and_commits_once(self) -> None:
        session = _FakeSession()

        with patch.object(auth_middleware, "AsyncSessionFactory", return_value=_FakeSessionContext(session)):
            with patch.object(
                auth_middleware,
                "ensure_user_with_signup_bonus",
                new=AsyncMock(return_value=True),
            ) as ensure_user:
                await auth_middleware._ensure_user_exists("user-new")

        ensure_user.assert_awaited_once_with(session, "user-new")
        self.assertEqual(session.commits, 1)

    async def test_profile_lazy_user_creation_reuses_onboarding_service(self) -> None:
        session = SimpleNamespace()

        with patch.object(
            profile_service,
            "ensure_user_with_signup_bonus",
            new=AsyncMock(return_value=True),
        ) as ensure_user:
            await profile_service._ensure_user(session, "dev-user")

        ensure_user.assert_awaited_once_with(session, "dev-user")


if __name__ == "__main__":
    unittest.main()
