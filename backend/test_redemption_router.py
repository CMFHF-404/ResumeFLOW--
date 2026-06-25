import inspect
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")
    os.environ.setdefault("REDEMPTION_CODE_ENCRYPTION_KEY", "unit-test-redemption-secret")


_set_required_env_defaults()

from app.domain.billing import redemption_router  # noqa: E402
from app.domain.billing import billing_router  # noqa: E402
from app.domain.billing.redemption_schemas import (  # noqa: E402
    RedemptionRedeemRequest,
    RedemptionRedeemResponse,
)


class RedemptionRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_user_redeem_endpoint_delegates_to_service_with_current_user(self) -> None:
        expected = RedemptionRedeemResponse(
            tokens=1000,
            package_name="体验包",
            summary={
                "user_id": "user-1",
                "token_limit": 1000,
                "remaining_tokens": 1000,
                "used_tokens": 0,
                "remaining_percent": 100,
            },
        )
        session = object()
        current_user = SimpleNamespace(id="user-1")

        with patch.object(redemption_router.redemption_service, "redeem_code", AsyncMock(return_value=expected)) as mocked:
            result = await redemption_router.redeem_billing_code(
                RedemptionRedeemRequest(code="RF-TEST-0001"),
                session=session,
                current_user=current_user,
            )

        self.assertIs(result, expected)
        mocked.assert_awaited_once_with(session, "user-1", "RF-TEST-0001")

    def test_admin_routes_are_protected_by_require_admin(self) -> None:
        source = inspect.getsource(redemption_router)

        self.assertIn("require_admin", source)
        self.assertIn("current_admin=Depends(require_admin)", source)
        self.assertIn('prefix="/api/admin/redemption"', source)

    def test_user_billing_router_no_longer_exposes_placeholder_purchase_routes(self) -> None:
        paths = {route.path for route in billing_router.router.routes}

        self.assertNotIn("/api/billing/purchases", paths)
        self.assertNotIn("/api/billing/purchases/options", paths)


if __name__ == "__main__":
    unittest.main()
