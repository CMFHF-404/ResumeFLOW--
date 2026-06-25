import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")
    os.environ.setdefault("REDEMPTION_CODE_ENCRYPTION_KEY", "unit-test-redemption-secret")


_set_required_env_defaults()

from fastapi import HTTPException  # noqa: E402

from app.domain.billing import redemption_service  # noqa: E402
from app.domain.billing.redemption_schemas import (  # noqa: E402
    RedemptionBatchCreate,
    RedemptionPackageCreate,
    RedemptionPackageUpdate,
)
from app.models import (  # noqa: E402
    AITokenPurchaseEvent,
    AITokenWallet,
    RedemptionBatch,
    RedemptionCode,
    RedemptionPackage,
)


class _ScalarResult:
    def __init__(self, first_value=None, all_values=None):
        self._first_value = first_value
        self._all_values = all_values if all_values is not None else []

    def first(self):
        return self._first_value

    def all(self):
        return self._all_values


class _ExecuteResult:
    def __init__(self, first_value=None, all_values=None):
        self._first_value = first_value
        self._all_values = all_values

    def scalars(self):
        return _ScalarResult(self._first_value, self._all_values)


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


class RedemptionCryptoTests(unittest.TestCase):
    def test_hash_normalizes_spacing_and_case(self) -> None:
        self.assertEqual(
            redemption_service.hash_redemption_code(" rf-ABCD-1234 "),
            redemption_service.hash_redemption_code("RFABCD1234"),
        )

    def test_encrypts_plaintext_for_admin_reexport(self) -> None:
        encrypted = redemption_service.encrypt_redemption_code("RF-TEST-0001")

        self.assertNotIn("RF-TEST-0001", encrypted)
        self.assertEqual(redemption_service.decrypt_redemption_code(encrypted), "RF-TEST-0001")


class RedemptionPackageTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_and_update_package_validates_token_amount(self) -> None:
        session = _FakeSession()

        created = await redemption_service.create_package(
            session,
            RedemptionPackageCreate(name="体验包", token_amount=100_000, notes="渠道 A"),
        )

        self.assertEqual(created.name, "体验包")
        self.assertEqual(created.token_amount, 100_000)
        self.assertEqual(session.commits, 1)

        with self.assertRaises(HTTPException) as raised:
            await redemption_service.update_package(
                session,
                str(created.id),
                RedemptionPackageUpdate(token_amount=0),
            )
        self.assertEqual(raised.exception.status_code, 400)


class RedemptionBatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_batch_stores_hash_ciphertext_and_token_snapshot(self) -> None:
        package = RedemptionPackage(name="渠道套餐", token_amount=250_000, is_active=True)
        session = _FakeSession([_ExecuteResult(first_value=package)])

        with patch.object(
            redemption_service,
            "_new_plaintext_code",
            side_effect=["RF-AAAA-0001", "RF-BBBB-0002"],
        ):
            response = await redemption_service.create_redemption_batch(
                session,
                created_by="admin-user",
                payload=RedemptionBatchCreate(
                    package_id=str(package.id),
                    name="六月渠道",
                    channel="june-campaign",
                    count=2,
                ),
            )

        batches = [item for item in session.added if isinstance(item, RedemptionBatch)]
        codes = [item for item in session.added if isinstance(item, RedemptionCode)]

        self.assertEqual(response.codes, ["RF-AAAA-0001", "RF-BBBB-0002"])
        self.assertEqual(len(batches), 1)
        self.assertEqual(len(codes), 2)
        self.assertEqual(batches[0].token_amount, 250_000)
        self.assertEqual(codes[0].token_amount, 250_000)
        self.assertNotEqual(codes[0].code_hash, "RF-AAAA-0001")
        self.assertEqual(redemption_service.decrypt_redemption_code(codes[0].code_ciphertext), "RF-AAAA-0001")
        self.assertEqual(session.commits, 1)


class RedemptionRedeemTests(unittest.IsolatedAsyncioTestCase):
    async def test_redeem_single_use_code_stacks_tokens_without_resetting_used_tokens(self) -> None:
        code = RedemptionCode(
            batch_id=None,
            package_id=None,
            code_hash=redemption_service.hash_redemption_code("RF-STACK-0001"),
            code_ciphertext=redemption_service.encrypt_redemption_code("RF-STACK-0001"),
            code_prefix="RF-STACK",
            token_amount=1_000,
            package_name="叠加包",
            status="unused",
        )
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=5_000,
            remaining_tokens=1_500,
            used_tokens=3_500,
        )
        session = _FakeSession([_ExecuteResult(first_value=code), _ExecuteResult(first_value=wallet)])

        response = await redemption_service.redeem_code(session, "user-1", "RF-STACK-0001")

        self.assertEqual(code.status, "redeemed")
        self.assertEqual(code.redeemed_by_user_id, "user-1")
        self.assertEqual(wallet.token_limit, 6_000)
        self.assertEqual(wallet.remaining_tokens, 2_500)
        self.assertEqual(wallet.used_tokens, 3_500)
        self.assertEqual(response.summary.remaining_tokens, 2_500)
        purchase_events = [item for item in session.added if isinstance(item, AITokenPurchaseEvent)]
        self.assertEqual(len(purchase_events), 1)
        self.assertEqual(purchase_events[0].source, "redemption_code")
        self.assertEqual(purchase_events[0].status, "redemption_succeeded")
        self.assertTrue(session.statements)
        self.assertIsNotNone(getattr(session.statements[0], "_for_update_arg", None))

    async def test_redeem_used_code_does_not_credit_wallet_twice(self) -> None:
        code = RedemptionCode(
            code_hash=redemption_service.hash_redemption_code("RF-USED-0001"),
            code_ciphertext=redemption_service.encrypt_redemption_code("RF-USED-0001"),
            code_prefix="RF-USED",
            token_amount=1_000,
            package_name="已用包",
            status="redeemed",
            redeemed_by_user_id="user-1",
        )
        session = _FakeSession([_ExecuteResult(first_value=code)])

        with self.assertRaises(HTTPException) as raised:
            await redemption_service.redeem_code(session, "user-1", "RF-USED-0001")

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(session.added, [])

    async def test_revoke_unused_code_prevents_future_redemption(self) -> None:
        code = RedemptionCode(
            code_hash=redemption_service.hash_redemption_code("RF-REVOKE-0001"),
            code_ciphertext=redemption_service.encrypt_redemption_code("RF-REVOKE-0001"),
            code_prefix="RF-REVOKE",
            token_amount=1_000,
            package_name="待废包",
            status="unused",
        )
        session = _FakeSession([_ExecuteResult(first_value=code)])

        revoked = await redemption_service.revoke_code(session, str(code.id), "admin-user")

        self.assertEqual(revoked.status, "revoked")
        self.assertEqual(revoked.revoked_by_user_id, "admin-user")
        self.assertEqual(session.commits, 1)


class RedemptionSchemaTests(unittest.TestCase):
    def test_models_define_redemption_tables_and_purchase_source_columns(self) -> None:
        self.assertEqual(RedemptionPackage.__tablename__, "redemption_packages")
        self.assertEqual(RedemptionBatch.__tablename__, "redemption_batches")
        self.assertEqual(RedemptionCode.__tablename__, "redemption_codes")
        self.assertTrue(hasattr(AITokenPurchaseEvent, "source"))
        self.assertTrue(hasattr(AITokenPurchaseEvent, "source_id"))

    def test_database_startup_ensures_redemption_tables(self) -> None:
        with open("app/database.py", "r", encoding="utf-8") as handle:
            source = handle.read()
        with open("app/main.py", "r", encoding="utf-8") as handle:
            main_source = handle.read()
        with open("schema.sql", "r", encoding="utf-8") as handle:
            schema_source = handle.read()

        self.assertIn("async def ensure_redemption_code_tables", source)
        self.assertRegex(source, r"ensure_dev_schema\(\)[\s\S]*await ensure_redemption_code_tables\(\)")
        self.assertRegex(main_source, r"lifespan\([\s\S]*await ensure_redemption_code_tables\(\)")
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_packages", schema_source)
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_batches", schema_source)
        self.assertIn("CREATE TABLE IF NOT EXISTS redemption_codes", schema_source)


if __name__ == "__main__":
    unittest.main()
