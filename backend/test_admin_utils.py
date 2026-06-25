import os
import unittest
from types import SimpleNamespace


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402

from app.utils import admin_utils  # noqa: E402


class _ExecuteResult:
    def __init__(self, scalar=None, value=None):
        self._scalar = scalar
        self._value = value

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar

    def scalars(self):
        return self

    def first(self):
        return self._value


class _FakeSession:
    def __init__(self, execute_values=None):
        self.execute_values = list(execute_values or [])
        self.statements = []
        self.commits = 0

    async def execute(self, statement):
        self.statements.append(statement)
        if self.execute_values:
            return self.execute_values.pop(0)
        return _ExecuteResult()

    async def commit(self):
        self.commits += 1


class AdminUtilsTests(unittest.IsolatedAsyncioTestCase):
    async def test_is_admin_reads_database_flag(self) -> None:
        session = _FakeSession([_ExecuteResult(scalar=True)])

        self.assertTrue(await admin_utils.is_admin("admin-user", session))

    async def test_require_admin_rejects_non_admin_user(self) -> None:
        session = _FakeSession([_ExecuteResult(scalar=False)])
        current_user = SimpleNamespace(id="normal-user")

        with self.assertRaises(HTTPException) as raised:
            await admin_utils.require_admin(current_user, session)

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(raised.exception.detail["error"]["code"], "forbidden")


if __name__ == "__main__":
    unittest.main()
