import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app import auth_middleware
from app.domain.billing import payment_provider, payment_router, payment_service
from app.domain.billing.entitlement_service import EntitlementGrant, grant_entitlement
from app.models import AITokenPurchaseEvent, AITokenWallet, PaymentOrder, PaymentWebhookEvent
from app.utils.time_utils import utc_now_aware


class _ScalarResult:
    def __init__(self, first_value=None):
        self._first_value = first_value

    def first(self):
        return self._first_value


class _ExecuteResult:
    def __init__(self, first_value=None):
        self._first_value = first_value

    def scalars(self):
        return _ScalarResult(self._first_value)


class _FakeSession:
    def __init__(self, values=()):
        self.values = list(values)
        self.added = []
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return self.values.pop(0) if self.values else _ExecuteResult()

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        return None

    async def rollback(self):
        self.rollbacks += 1


class _IntegrityRaceSession(_FakeSession):
    async def commit(self):
        self.commits += 1
        raise IntegrityError("INSERT payment_orders", {}, RuntimeError("unique violation"))


def _settings(**overrides):
    values = {
        "yifut_enabled": True,
        "yifut_test_user_ids": [],
        "yifut_merchant_id": "1001",
        "yifut_merchant_private_key": "private-key",
        "yifut_platform_public_key": "public-key",
        "yifut_base_url": "https://www.yifut.com/",
        "public_api_origin": "https://api.example.com",
        "frontend_origin": "https://app.example.com",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class PaymentCatalogTests(unittest.IsolatedAsyncioTestCase):
    def test_catalog_has_fixed_skus_prices_and_benefits(self) -> None:
        response = payment_service.list_products(_settings())
        self.assertTrue(response.payments_enabled)
        self.assertEqual(
            [(item.sku, item.amount_fen) for item in response.products],
            [
                ("tokens_500k", 990),
                ("tokens_1m", 1890),
                ("unlimited_month", 2980),
                ("unlimited_quarter", 7980),
                ("unlimited_year", 22980),
            ],
        )
        self.assertEqual(response.products[0].token_amount, 500_000)
        self.assertEqual(
            [item.unlimited_duration_days for item in response.products[2:]],
            [30, 90, 365],
        )

    def test_catalog_exposes_ten_cent_test_package_only_when_enabled(self) -> None:
        disabled = payment_service.list_products(_settings())
        enabled = payment_service.list_products(
            _settings(yifut_test_user_ids=["user-1"]),
            user_id="user-1",
        )

        self.assertNotIn("tokens_test_10k", [item.sku for item in disabled.products])
        self.assertEqual(enabled.products[0].sku, "tokens_test_10k")
        self.assertEqual(enabled.products[0].name, "10K Token 测试包")
        self.assertEqual(enabled.products[0].amount_fen, 10)
        self.assertEqual(enabled.products[0].token_amount, 10_000)

    async def test_products_route_passes_authenticated_user_to_allowlist_filter(self) -> None:
        expected = payment_service.list_products(_settings())
        with patch.object(payment_router.payment_service, "list_products", return_value=expected) as mocked:
            result = await payment_router.get_payment_products(SimpleNamespace(id="user-1"))

        self.assertIs(result, expected)
        mocked.assert_called_once_with(user_id="user-1")

    def test_payment_flag_requires_switch_and_all_secrets(self) -> None:
        self.assertFalse(payment_service.payments_enabled(_settings(yifut_enabled=False)))
        self.assertFalse(payment_service.payments_enabled(_settings(yifut_platform_public_key=None)))

        malformed_settings = _settings(yifut_merchant_id="1796复制")
        self.assertFalse(payment_service.payments_enabled(malformed_settings))
        for require_configured in (
            payment_service._require_notification_configured,
            payment_service._require_query_configured,
        ):
            with self.assertRaises(HTTPException) as raised:
                require_configured(malformed_settings)
            self.assertEqual(raised.exception.status_code, 503)

    def test_purchase_source_id_model_index_matches_partial_database_index(self) -> None:
        index = next(
            item
            for item in AITokenPurchaseEvent.__table__.indexes
            if item.name == "uq_ai_token_purchase_events_source_id"
        )
        self.assertTrue(index.unique)
        self.assertIsNotNone(index.dialect_options["postgresql"]["where"])


class EntitlementServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_token_grant_stacks_without_resetting_used_tokens(self) -> None:
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=400,
            used_tokens=600,
        )
        session = _FakeSession([_ExecuteResult(wallet), _ExecuteResult()])
        result = await grant_entitlement(
            session,
            user_id="user-1",
            grant=EntitlementGrant(
                option_id="tokens_500k",
                label="500K Token 包",
                benefit_type="tokens",
                token_amount=500_000,
            ),
            source="yifut_payment",
            source_id="order-1",
            status="payment_succeeded",
        )
        self.assertTrue(result.created)
        self.assertEqual(wallet.token_limit, 501_000)
        self.assertEqual(wallet.remaining_tokens, 500_400)
        self.assertEqual(wallet.used_tokens, 600)
        self.assertEqual(len([item for item in session.added if isinstance(item, AITokenPurchaseEvent)]), 1)

    async def test_unlimited_grant_extends_active_expiry_and_preserves_balance(self) -> None:
        now = utc_now_aware()
        current_expiry = now + timedelta(days=4)
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=400,
            used_tokens=600,
            unlimited_tokens_expires_at=current_expiry,
            unlimited_tokens_plan_name="旧套餐",
        )
        session = _FakeSession([_ExecuteResult(wallet), _ExecuteResult()])
        await grant_entitlement(
            session,
            user_id="user-1",
            grant=EntitlementGrant(
                option_id="unlimited_month",
                label="单月不限量",
                benefit_type="unlimited_time",
                unlimited_duration_days=30,
            ),
            source="yifut_payment",
            source_id="order-2",
            status="payment_succeeded",
            now=now,
        )
        self.assertEqual(wallet.unlimited_tokens_expires_at, current_expiry + timedelta(days=30))
        self.assertEqual(wallet.unlimited_tokens_plan_name, "单月不限量")
        self.assertEqual((wallet.token_limit, wallet.remaining_tokens, wallet.used_tokens), (1_000, 400, 600))

    async def test_late_older_payment_extends_time_without_replacing_latest_plan_display(self) -> None:
        older_paid_at = datetime(2026, 8, 1, 2, 0, tzinfo=timezone.utc)
        newer_paid_at = datetime(2026, 8, 2, 2, 0, tzinfo=timezone.utc)
        current_expiry = newer_paid_at + timedelta(days=365)
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=400,
            used_tokens=600,
            unlimited_tokens_expires_at=current_expiry,
            unlimited_tokens_plan_name="年度不限量",
            last_purchase_at=newer_paid_at,
            last_purchase_tokens=0,
        )
        previous_last_purchase_id = wallet.last_purchase_id
        session = _FakeSession([_ExecuteResult(wallet), _ExecuteResult()])

        await grant_entitlement(
            session,
            user_id="user-1",
            grant=EntitlementGrant(
                option_id="unlimited_month",
                label="单月不限量",
                benefit_type="unlimited_time",
                unlimited_duration_days=30,
            ),
            source="yifut_payment",
            source_id="late-order",
            status="payment_succeeded",
            now=older_paid_at,
        )

        self.assertEqual(wallet.unlimited_tokens_expires_at, current_expiry + timedelta(days=30))
        self.assertEqual(wallet.unlimited_tokens_plan_name, "年度不限量")
        self.assertEqual(wallet.last_purchase_at, newer_paid_at)
        self.assertEqual(wallet.last_purchase_id, previous_last_purchase_id)


class PaymentCheckoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_test_package_order_requires_allowlist_and_snapshots_ten_cent_benefit(self) -> None:
        disabled_session = _FakeSession([_ExecuteResult()])
        with (
            patch.object(
                payment_service,
                "_require_payments_enabled",
                return_value=_settings(yifut_test_user_ids=["another-user"]),
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                disabled_session,
                user_id="user-1",
                sku="tokens_test_10k",
                idempotency_key="disabled-test-package",
            )

        self.assertEqual(raised.exception.detail["code"], "invalid_payment_product")
        enabled_session = _FakeSession([_ExecuteResult()])
        with patch.object(
            payment_service,
            "_require_payments_enabled",
            return_value=_settings(yifut_test_user_ids=["user-1"]),
        ):
            created = await payment_service.create_order(
                enabled_session,
                user_id="user-1",
                sku="tokens_test_10k",
                idempotency_key="enabled-test-package",
            )

        order = next(item for item in enabled_session.added if isinstance(item, PaymentOrder))
        self.assertEqual(created.sku, "tokens_test_10k")
        self.assertEqual((order.amount_fen, order.token_amount), (10, 10_000))
        self.assertEqual(order.entitlement_snapshot_json["amount_fen"], 10)
        self.assertEqual(order.entitlement_snapshot_json["token_amount"], 10_000)

    async def test_test_package_checkout_signs_ten_cent_money(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-TEST-TEN-CENTS",
            idempotency_key="test-ten-cents",
            sku="tokens_test_10k",
            product_name="10K Token 测试包",
            amount_fen=10,
            currency="CNY",
            benefit_type="tokens",
            token_amount=10_000,
            expires_at=now + timedelta(minutes=20),
        )
        session = _FakeSession([_ExecuteResult(order)])

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(
                payment_service.payment_provider,
                "build_signed_fields",
                side_effect=lambda fields, _private_key: {
                    **{key: str(value) for key, value in fields.items()},
                    "sign_type": "RSA",
                    "sign": "sig",
                },
            ),
        ):
            response = await payment_service.create_checkout(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )

        self.assertEqual(response.fields["money"], "0.10")
        self.assertEqual(response.fields["name"], "10K Token 测试包")

    async def test_order_creation_is_idempotent_and_snapshots_catalog_values(self) -> None:
        session = _FakeSession([_ExecuteResult()])
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            created = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="checkout-click-1",
            )
        order = next(item for item in session.added if isinstance(item, PaymentOrder))
        self.assertEqual(created.sku, "tokens_500k")
        self.assertEqual((order.amount_fen, order.currency, order.token_amount), (990, "CNY", 500_000))
        self.assertEqual(order.entitlement_snapshot_json["amount_fen"], 990)
        self.assertEqual(session.commits, 1)

        replay_session = _FakeSession([_ExecuteResult(order)])
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            replayed = await payment_service.create_order(
                replay_session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="checkout-click-1",
            )
        self.assertEqual(replayed.id, created.id)
        self.assertEqual(replay_session.added, [])

    async def test_concurrent_idempotency_key_reuse_for_different_sku_returns_409(self) -> None:
        raced_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RACED",
            idempotency_key="same-key",
            sku="tokens_1m",
            product_name="1M Token 包",
            amount_fen=1_890,
            currency="CNY",
            benefit_type="tokens",
            token_amount=1_000_000,
            expires_at=utc_now_aware() + timedelta(minutes=20),
        )
        session = _IntegrityRaceSession(
            [_ExecuteResult(), _ExecuteResult(raced_order)]
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="same-key",
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "idempotency_key_conflict")
        self.assertEqual(session.rollbacks, 1)

    async def test_checkout_posts_to_cashier_without_type_and_with_fixed_fee_mode(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-ORDER-1",
            idempotency_key="idem-1",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            expires_at=now + timedelta(minutes=20),
        )
        session = _FakeSession([_ExecuteResult(order)])
        captured = {}

        def fake_signed_fields(fields, private_key):
            captured.update(fields)
            return {**{key: str(value) for key, value in fields.items()}, "sign_type": "RSA", "sign": "sig"}

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service.payment_provider, "build_signed_fields", side_effect=fake_signed_fields),
        ):
            response = await payment_service.create_checkout(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )

        self.assertEqual(response.action, "https://www.yifut.com/api/pay/submit")
        self.assertEqual(response.method, "POST")
        self.assertEqual(response.fields["fee_mode"], "0")
        self.assertEqual(response.fields["money"], "9.90")
        self.assertNotIn("type", response.fields)
        self.assertEqual(captured["notify_url"], "https://api.example.com/api/billing/payments/yifut/notify")
        self.assertEqual(captured["return_url"], f"https://app.example.com/?payment_order={order.id}")

    def test_provider_payload_rejects_amount_currency_and_merchant_mismatch(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-ORDER-1",
            idempotency_key="idem-1",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            expires_at=utc_now_aware() + timedelta(minutes=20),
        )
        valid = {
            "pid": "1001",
            "out_trade_no": "RF-ORDER-1",
            "money": "9.90",
            "currency": "CNY",
            "trade_status": "TRADE_SUCCESS",
            "trade_no": "YF-1",
        }
        self.assertEqual(
            payment_service._validate_provider_payload(valid, settings=_settings(), order=order, require_success=True),
            "YF-1",
        )
        for changed in (
            {"pid": "other"},
            {"money": "9.91"},
            {"money": "NaN"},
            {"currency": "USD"},
            {"trade_status": "WAIT_BUYER_PAY"},
        ):
            with self.subTest(changed=changed), self.assertRaises(HTTPException):
                payment_service._validate_provider_payload(
                    {**valid, **changed}, settings=_settings(), order=order, require_success=True
                )

        query_payload = {
            **valid,
            "trade_status": "",
            "status": 1,
        }
        with self.assertRaises(HTTPException):
            payment_service._validate_provider_payload(
                query_payload,
                settings=_settings(),
                order=order,
                require_success=True,
            )
        self.assertEqual(
            payment_service._validate_provider_payload(
                query_payload,
                settings=_settings(),
                order=order,
                require_success=True,
                allow_query_status=True,
            ),
            "YF-1",
        )

    async def test_verified_notification_fulfills_once_and_duplicate_is_safe(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-ORDER-PAID",
            idempotency_key="idem-paid",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            expires_at=now - timedelta(minutes=1),
            status="expired",
        )
        wallet = AITokenWallet(user_id="user-1", token_limit=1_000, remaining_tokens=400, used_tokens=600)
        payload = {
            "pid": "1001",
            "out_trade_no": order.merchant_order_no,
            "money": "9.90",
            "currency": "CNY",
            "trade_status": "TRADE_SUCCESS",
            "trade_no": "YF-PAID-1",
            "sign": "valid-signature",
        }
        session = _FakeSession(
            [
                _ExecuteResult(order),
                _ExecuteResult(),
                _ExecuteResult(wallet),
                _ExecuteResult(),
                _ExecuteResult(wallet),
            ]
        )
        with patch.object(payment_service, "_require_notification_configured", return_value=_settings()):
            fulfilled = await payment_service._fulfill_verified_payment(
                session,
                merchant_order_no=order.merchant_order_no,
                payload=payload,
                record_webhook=True,
            )
        self.assertEqual(fulfilled.status, "fulfilled")
        self.assertEqual(wallet.remaining_tokens, 500_400)
        self.assertEqual(wallet.used_tokens, 600)
        self.assertEqual(len([item for item in session.added if isinstance(item, AITokenPurchaseEvent)]), 1)
        webhook = next(item for item in session.added if isinstance(item, PaymentWebhookEvent))
        self.assertIsNotNone(webhook.processed_at)

        duplicate_session = _FakeSession(
            [_ExecuteResult(order), _ExecuteResult(webhook), _ExecuteResult(wallet)]
        )
        with patch.object(payment_service, "_require_notification_configured", return_value=_settings()):
            duplicate = await payment_service._fulfill_verified_payment(
                duplicate_session,
                merchant_order_no=order.merchant_order_no,
                payload=payload,
                record_webhook=True,
            )
        self.assertEqual(duplicate.status, "fulfilled")
        self.assertEqual(wallet.remaining_tokens, 500_400)
        self.assertEqual(
            len([item for item in duplicate_session.added if isinstance(item, AITokenPurchaseEvent)]),
            0,
        )

    async def test_signed_notification_fulfills_when_new_purchases_are_disabled(self) -> None:
        now = utc_now_aware()
        platform_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = platform_private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")
        public_pem = platform_private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        settings = _settings(
            yifut_enabled=False,
            yifut_platform_public_key=public_pem,
        )
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-SIGNED-CALLBACK",
            idempotency_key="signed-callback",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            expires_at=now + timedelta(minutes=20),
        )
        wallet = AITokenWallet(
            user_id="user-1",
            token_limit=1_000,
            remaining_tokens=25,
            used_tokens=975,
        )
        payload = {
            "pid": "1001",
            "out_trade_no": order.merchant_order_no,
            "money": "9.90",
            "trade_status": "TRADE_SUCCESS",
            "trade_no": "YF-SIGNED-1",
            "timestamp": str(int(now.timestamp())),
            "sign_type": "RSA",
        }
        payload["sign"] = payment_provider.sign_parameters(payload, private_pem)
        session = _FakeSession(
            [
                _ExecuteResult(order),
                _ExecuteResult(),
                _ExecuteResult(wallet),
                _ExecuteResult(),
                _ExecuteResult(wallet),
            ]
        )

        with patch.object(
            payment_service,
            "_require_notification_configured",
            return_value=settings,
        ):
            result = await payment_service.process_notification(session, payload)

        self.assertEqual(result.status, "fulfilled")
        self.assertEqual(wallet.remaining_tokens, 500_025)
        self.assertFalse(payment_service.payments_enabled(settings))

    async def test_sync_fulfills_a_late_paid_expired_order(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-LATE-PAID",
            idempotency_key="idem-late",
            sku="unlimited_month",
            product_name="单月不限量",
            amount_fen=2_980,
            currency="CNY",
            benefit_type="unlimited_time",
            unlimited_duration_days=30,
            expires_at=now - timedelta(hours=1),
            status="expired",
        )
        wallet = AITokenWallet(user_id="user-1", token_limit=1_000, remaining_tokens=400, used_tokens=600)
        provider_payload = {
            "code": 0,
            "pid": "1001",
            "out_trade_no": order.merchant_order_no,
            "money": "29.80",
            "currency": "CNY",
            "status": 1,
            "trade_no": "YF-LATE-1",
            "endtime": "2026-08-11 10:00:00",
            "sign": "verified-by-provider-adapter",
        }
        session = _FakeSession(
            [
                _ExecuteResult(order),
                _ExecuteResult(order),
                _ExecuteResult(wallet),
                _ExecuteResult(),
                _ExecuteResult(wallet),
            ]
        )
        with (
            patch.object(payment_service, "_require_query_configured", return_value=_settings()),
            patch.object(payment_service.payment_provider, "query_order", return_value=provider_payload),
        ):
            synced = await payment_service.sync_order(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )
        self.assertEqual(synced.status, "fulfilled")
        self.assertEqual(wallet.unlimited_tokens_plan_name, "单月不限量")
        self.assertEqual(order.paid_at, datetime(2026, 8, 11, 2, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(wallet.unlimited_tokens_expires_at, order.paid_at + timedelta(days=30))
        self.assertEqual(session.rollbacks, 1)

    def test_notification_verification_remains_available_when_purchase_switch_is_off(self) -> None:
        settings = _settings(yifut_enabled=False)

        self.assertFalse(payment_service.payments_enabled(settings))
        self.assertIs(payment_service._require_notification_configured(settings), settings)
        self.assertIs(payment_service._require_query_configured(settings), settings)


class PaymentAuthBoundaryTests(unittest.TestCase):
    @staticmethod
    def _request(path: str, method: str = "GET") -> Request:
        return Request({"type": "http", "method": method, "path": path, "headers": []})

    def test_only_exact_get_notify_path_is_public(self) -> None:
        path = "/api/billing/payments/yifut/notify"
        self.assertTrue(auth_middleware._is_public_request(self._request(path)))
        self.assertFalse(auth_middleware._is_public_request(self._request(path, "POST")))
        self.assertFalse(auth_middleware._is_public_request(self._request(f"{path}/extra")))
        self.assertFalse(auth_middleware._is_public_request(self._request("/api/billing/payment-orders")))


if __name__ == "__main__":
    unittest.main()
