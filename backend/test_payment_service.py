import base64
import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app import auth_middleware
from app.domain.billing import payment_catalog, payment_provider, payment_router, payment_service
from app.domain.billing.entitlement_service import EntitlementGrant, grant_entitlement
from app.models import (
    AITokenPurchaseEvent,
    AITokenWallet,
    PaymentOrder,
    PaymentOrderIdempotencyAlias,
    PaymentOrderStateRevision,
    PaymentWebhookEvent,
)
from app.utils.time_utils import utc_now_aware


class _ScalarResult:
    def __init__(self, first_value=None):
        self._first_value = first_value

    def first(self):
        if isinstance(self._first_value, list):
            return self._first_value[0] if self._first_value else None
        return self._first_value

    def all(self):
        if isinstance(self._first_value, list):
            return self._first_value
        return [] if self._first_value is None else [self._first_value]


class _ExecuteResult:
    def __init__(self, first_value=None, *, rowcount=0):
        self._first_value = first_value
        self.rowcount = rowcount

    def scalars(self):
        return _ScalarResult(self._first_value)

    def scalar_one(self):
        return self._first_value


class _FakeSession:
    def __init__(self, values=(), *, terminal_attempt_count=0):
        self.values = list(values)
        self.terminal_attempt_count = terminal_attempt_count
        self.added = []
        self.statements = []
        self.commits = 0
        self.rollbacks = 0
        self.alias_inserts = []

    async def execute(self, statement):
        self.statements.append(statement)
        statement_text = str(statement)
        if statement_text.startswith("INSERT INTO payment_order_idempotency_aliases"):
            self.alias_inserts.append(statement.compile().params)
            return _ExecuteResult(rowcount=1)
        if "SELECT payment_orders.user_id" in statement_text:
            return self.values[0] if self.values else _ExecuteResult()
        if "FROM payment_order_state_revisions" in statement_text:
            upcoming = self.values[0]._first_value if self.values else None
            orders = upcoming if isinstance(upcoming, list) else [upcoming]
            orders = [order for order in orders if isinstance(order, PaymentOrder)]
            if not orders:
                return _ExecuteResult()
            latest = max(orders, key=lambda order: (order.updated_at, order.id))
            return _ExecuteResult(
                PaymentOrderStateRevision(
                    user_id=latest.user_id,
                    revision=sum(int(order.state_version) for order in orders),
                    latest_order_id=latest.id,
                    updated_at=latest.updated_at,
                )
            )
        if "count(payment_orders.id)" in statement_text:
            return _ExecuteResult(self.terminal_attempt_count)
        if "FROM users" in statement_text and "payment_orders" not in statement_text:
            return _ExecuteResult()
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
    def __init__(self, values=()):
        super().__init__(values)
        self._flush_failed = False

    async def flush(self):
        if not self._flush_failed:
            self._flush_failed = True
            original = RuntimeError("unique violation")
            original.constraint_name = "payment_orders_one_provider_open_per_user"
            raise IntegrityError("INSERT payment_orders", {}, original)


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


def _locking_statements(session: _FakeSession):
    return [
        statement
        for statement in session.statements
        if getattr(statement, "_for_update_arg", None) is not None
    ]


def _assert_no_key_user_lock(test_case: unittest.TestCase, statement) -> None:
    test_case.assertIn("FROM users", str(statement))
    test_case.assertTrue(statement._for_update_arg.key_share)
    test_case.assertFalse(statement._for_update_arg.read)


def _snapshot_for(sku: str):
    product = payment_catalog.get_product(
        sku,
        include_test_product=sku == payment_catalog.TEST_PRODUCT.sku,
    )
    assert product is not None
    return payment_service._product_snapshot(product)


def _state_token(*orders: PaymentOrder) -> str:
    return payment_service._payment_state_token(list(orders))


def _catalog_version(*, include_test_product: bool = False) -> str:
    return payment_service._catalog_version(
        list(payment_catalog.get_products(include_test_product=include_test_product))
    )


class PaymentCatalogTests(unittest.IsolatedAsyncioTestCase):
    def test_catalog_has_fixed_skus_prices_and_benefits(self) -> None:
        response = payment_service.list_products(_settings())
        self.assertTrue(response.payments_enabled)
        self.assertEqual(response.catalog_version, _catalog_version())
        self.assertEqual(len(response.catalog_version), 64)
        self.assertEqual(
            [(item.sku, item.amount_fen) for item in response.products],
            [
                ("tokens_100k", 198),
                ("tokens_500k", 990),
                ("tokens_1m", 1890),
                ("unlimited_month", 2980),
                ("unlimited_quarter", 7980),
                ("unlimited_year", 22980),
            ],
        )
        self.assertEqual(response.products[0].token_amount, 100_000)
        self.assertEqual(
            [item.unlimited_duration_days for item in response.products[3:]],
            [30, 90, 365],
        )

    def test_catalog_exposes_ten_cent_test_package_only_when_enabled(self) -> None:
        disabled = payment_service.list_products(_settings())
        enabled = payment_service.list_products(
            _settings(yifut_test_user_ids=["user-1"]),
            user_id="user-1",
        )

        self.assertNotIn("tokens_test_10k", [item.sku for item in disabled.products])
        self.assertNotEqual(disabled.catalog_version, enabled.catalog_version)
        self.assertEqual(
            enabled.catalog_version,
            _catalog_version(include_test_product=True),
        )
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

    def test_payment_order_expiry_model_index_is_pending_only(self) -> None:
        index = next(
            item
            for item in PaymentOrder.__table__.indexes
            if item.name == "idx_payment_orders_pending_expires"
        )
        self.assertEqual([column.name for column in index.columns], ["expires_at"])
        self.assertEqual(
            str(index.dialect_options["postgresql"]["where"]),
            "status = 'pending'",
        )

    def test_active_payment_order_states_exclude_replaceable_terminal_orders(self) -> None:
        self.assertEqual(
            set(payment_service.ACTIVE_PAYMENT_ORDER_STATUSES),
            {"pending", "paid"},
        )

    def test_provider_open_guard_conflict_recognizes_asyncpg_and_dbapi_orig(self) -> None:
        asyncpg_style = SimpleNamespace(
            constraint_name="payment_orders_one_provider_open_per_user"
        )
        dbapi_style = SimpleNamespace(
            diag=SimpleNamespace(
                constraint_name="payment_order_provider_open_claims_pkey"
            )
        )
        for original in (asyncpg_style, dbapi_style):
            with self.subTest(original=original):
                error = IntegrityError("INSERT payment_orders", {}, original)
                self.assertTrue(
                    payment_service._is_provider_open_guard_conflict(error)
                )
        unrelated = IntegrityError(
            "INSERT payment_orders",
            {},
            SimpleNamespace(constraint_name="payment_orders_merchant_order_no_key"),
        )
        self.assertFalse(payment_service._is_provider_open_guard_conflict(unrelated))


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
    async def test_100k_package_order_snapshots_catalog_values(self) -> None:
        session = _FakeSession([_ExecuteResult()])
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            created = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="checkout-100k",
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
            )

        order = next(item for item in session.added if isinstance(item, PaymentOrder))
        self.assertEqual((created.sku, created.amount_fen), ("tokens_100k", 198))
        self.assertEqual((order.amount_fen, order.token_amount), (198, 100_000))
        self.assertEqual(order.entitlement_snapshot_json["token_amount"], 100_000)

    def test_token_package_prices_do_not_reward_splitting_orders(self) -> None:
        token_products = [item for item in payment_catalog.PRODUCTS if item.category == "tokens"]
        for smaller, larger in zip(token_products, token_products[1:]):
            assert smaller.token_amount is not None
            assert larger.token_amount is not None
            required_smaller_orders = (larger.token_amount + smaller.token_amount - 1) // smaller.token_amount
            self.assertGreaterEqual(
                required_smaller_orders * smaller.amount_fen,
                larger.amount_fen,
                f"{smaller.sku} can undercut {larger.sku} by splitting orders",
            )

    async def test_order_list_is_stable_paginated_and_exposes_only_safe_fields(self) -> None:
        created_at = datetime(2026, 8, 12, 4, 0, tzinfo=timezone.utc)
        orders = [
            PaymentOrder(
                id=uuid.UUID(int=value),
                user_id="user-1",
                merchant_order_no=f"RF-LIST-{value}",
                idempotency_key=f"list-{value}",
                sku="tokens_100k",
                product_name="100K Token 包",
                amount_fen=198,
                currency="CNY",
                benefit_type="tokens",
                token_amount=100_000,
                entitlement_snapshot_json={"description": "100,000 Token，永久有效", "private": "hidden"},
                expires_at=created_at + timedelta(minutes=30),
                created_at=created_at,
                provider_trade_no=f"YF-{value}",
                failure_reason="internal failure",
            )
            for value in (3, 2, 1)
        ]
        session = _FakeSession(
            [_ExecuteResult(rowcount=0), _ExecuteResult(orders)]
        )

        response = await payment_service.list_orders(
            session,
            user_id="user-1",
            limit=2,
        )

        self.assertEqual([item.id for item in response.items], [str(orders[0].id), str(orders[1].id)])
        self.assertTrue(response.has_more)
        self.assertIsNotNone(response.next_cursor)
        cursor_created_at, cursor_id = payment_service._decode_orders_cursor(response.next_cursor)
        self.assertEqual((cursor_created_at, cursor_id), (created_at, orders[1].id))
        exposed = response.items[0].model_dump()
        self.assertEqual(exposed["description"], "100,000 Token，永久有效")
        self.assertFalse(
            {
                "merchant_order_no",
                "idempotency_key",
                "provider_trade_no",
                "failure_reason",
                "entitlement_snapshot_json",
                "summary",
            }
            & set(exposed)
        )
        self.assertIn("payment_orders.user_id", str(session.statements[1]))

    async def test_order_list_rejects_invalid_cursor_before_querying(self) -> None:
        session = _FakeSession()
        with self.assertRaises(HTTPException) as raised:
            await payment_service.list_orders(
                session,
                user_id="user-1",
                cursor="not-a-valid-cursor!",
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail["code"], "invalid_payment_orders_cursor")
        self.assertEqual(session.statements, [])

    def test_order_list_cursor_rejects_timezone_normalization_overflow(self) -> None:
        for created_at in (
            "0001-01-01T00:00:00+14:00",
            "9999-12-31T23:59:59-14:00",
        ):
            cursor = base64.urlsafe_b64encode(
                json.dumps(
                    {"created_at": created_at, "id": str(uuid.uuid4())},
                    separators=(",", ":"),
                ).encode("utf-8")
            ).rstrip(b"=").decode("ascii")
            with self.assertRaises(HTTPException) as raised:
                payment_service._decode_orders_cursor(cursor)
            self.assertEqual(raised.exception.status_code, 400)
            self.assertEqual(raised.exception.detail["code"], "invalid_payment_orders_cursor")

    async def test_expire_pending_orders_uses_atomic_boundary_update(self) -> None:
        now = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        session = _FakeSession([_ExecuteResult(rowcount=2)])

        count = await payment_service.expire_pending_orders(
            session,
            user_id="user-1",
            now=now,
        )

        self.assertEqual(count, 2)
        self.assertEqual(session.commits, 1)
        _assert_no_key_user_lock(self, session.statements[0])
        statement_text = str(session.statements[1])
        self.assertIn("payment_orders.expires_at <=", statement_text)
        self.assertIn("payment_orders.user_id", statement_text)
        self.assertIn("state_version=(payment_orders.state_version +", statement_text)

    async def test_expiry_all_users_locks_users_in_stable_order(self) -> None:
        session = _FakeSession(
            [
                _ExecuteResult(["user-a", "user-b"]),
                _ExecuteResult(rowcount=1),
                _ExecuteResult(rowcount=2),
                _ExecuteResult(["user-c"]),
                _ExecuteResult(rowcount=3),
                _ExecuteResult([]),
            ]
        )

        count = await payment_service.expire_pending_orders(session, batch_size=2)

        self.assertEqual(count, 6)
        due_users_statement = str(session.statements[0])
        self.assertIn("DISTINCT", due_users_statement)
        self.assertIn("ORDER BY users.id", due_users_statement)
        self.assertIn("LIMIT", due_users_statement)
        batch_locks = [
            statement
            for statement in session.statements
            if "FROM users" in str(statement) and "payment_orders" in str(statement)
        ]
        self.assertEqual(len(batch_locks), 3)
        for statement in batch_locks:
            _assert_no_key_user_lock(self, statement)
            self.assertTrue(statement._for_update_arg.skip_locked)
        self.assertEqual(session.commits, 2)

    async def test_expiry_rejects_invalid_batch_size_without_querying(self) -> None:
        session = _FakeSession()

        with self.assertRaises(ValueError):
            await payment_service.expire_pending_orders(session, batch_size=0)

        self.assertEqual(session.statements, [])
        self.assertEqual(session.commits, 0)

    async def test_cancel_pending_order_is_idempotent_and_boundary_expiry_wins(self) -> None:
        boundary = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        cancellable = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CANCEL-1",
            idempotency_key="cancel-1",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=boundary + timedelta(seconds=1),
        )
        session = _FakeSession([_ExecuteResult(cancellable)])
        with patch.object(payment_service, "utc_now", return_value=boundary):
            cancelled = await payment_service.cancel_order(
                session,
                user_id="user-1",
                order_id=str(cancellable.id),
            )
        self.assertEqual(cancelled.status, "cancelled")
        self.assertEqual(cancelled.state_version, 2)
        self.assertEqual(cancelled.cancelled_at, boundary)
        self.assertEqual(session.commits, 1)
        cancellation_locks = _locking_statements(session)
        _assert_no_key_user_lock(self, cancellation_locks[0])
        self.assertIn("payment_orders", str(cancellation_locks[1]))

        replay_session = _FakeSession([_ExecuteResult(cancellable)])
        with patch.object(payment_service, "utc_now", return_value=boundary):
            replay = await payment_service.cancel_order(
                replay_session,
                user_id="user-1",
                order_id=str(cancellable.id),
            )
        self.assertEqual(replay.status, "cancelled")
        self.assertEqual(replay.state_version, 2)
        self.assertEqual(replay_session.commits, 0)

        expiring = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-EXPIRE-BOUNDARY",
            idempotency_key="expire-boundary",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=boundary,
        )
        expiry_session = _FakeSession([_ExecuteResult(expiring)])
        with patch.object(payment_service, "utc_now", return_value=boundary):
            expired = await payment_service.cancel_order(
                expiry_session,
                user_id="user-1",
                order_id=str(expiring.id),
            )
        self.assertEqual(expired.status, "expired")
        self.assertEqual(expired.state_version, 2)
        self.assertIsNone(expired.cancelled_at)

    async def test_cancel_rejects_paid_orders_and_hides_other_users_orders(self) -> None:
        paid = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-PAID-CANCEL",
            idempotency_key="paid-cancel",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=utc_now_aware() + timedelta(minutes=20),
            status="paid",
        )
        with self.assertRaises(HTTPException) as paid_error:
            await payment_service.cancel_order(
                _FakeSession([_ExecuteResult(paid)]),
                user_id="user-1",
                order_id=str(paid.id),
            )
        self.assertEqual(paid_error.exception.status_code, 409)

        with self.assertRaises(HTTPException) as hidden_error:
            await payment_service.cancel_order(
                _FakeSession([_ExecuteResult()]),
                user_id="other-user",
                order_id=str(paid.id),
            )
        self.assertEqual(hidden_error.exception.status_code, 404)

    async def test_get_order_uses_user_then_order_lock_before_local_expiry(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-GET-LOCK-ORDER",
            idempotency_key="get-lock-order",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=utc_now_aware() + timedelta(minutes=10),
        )
        session = _FakeSession([_ExecuteResult(order)])
        result = await payment_service.get_order(
            session,
            user_id="user-1",
            order_id=str(order.id),
        )
        self.assertEqual(result.id, str(order.id))
        locks = _locking_statements(session)
        _assert_no_key_user_lock(self, locks[0])
        self.assertIn("payment_orders", str(locks[1]))

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
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
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
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(include_test_product=True),
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
            entitlement_snapshot_json=_snapshot_for("tokens_test_10k"),
            expires_at=now + timedelta(minutes=20),
        )
        session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])

        with (
            patch.object(
                payment_service,
                "_require_payments_enabled",
                return_value=_settings(yifut_test_user_ids=["user-1"]),
            ),
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
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
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

    async def test_purchase_context_token_is_stable_and_returns_latest_order(self) -> None:
        now = utc_now_aware()
        older = PaymentOrder(
            id=uuid.UUID(int=2),
            user_id="user-1",
            merchant_order_no="RF-CONTEXT-OLDER",
            idempotency_key="context-older",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            benefit_type="tokens",
            token_amount=100_000,
            status="expired",
            state_version=3,
            expires_at=utc_now_aware(),
            updated_at=now - timedelta(minutes=1),
        )
        latest = PaymentOrder(
            id=uuid.UUID(int=1),
            user_id="user-1",
            merchant_order_no="RF-CONTEXT-LATEST",
            idempotency_key="context-latest",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            benefit_type="tokens",
            token_amount=500_000,
            status="fulfilled",
            state_version=2,
            expires_at=utc_now_aware(),
            updated_at=now,
        )
        context_session = _FakeSession([_ExecuteResult([latest, older])])
        context = await payment_service.get_purchase_context(
            context_session,
            user_id="user-1",
        )

        self.assertEqual(context.latest_order.id, str(latest.id))
        self.assertEqual(context.latest_order.state_version, 2)
        self.assertEqual(context.payment_state_token, _state_token(older, latest))
        self.assertEqual(len(context.payment_state_token), 64)
        latest_statement = str(context_session.statements[1])
        self.assertIn("payment_orders.id =", latest_statement)
        self.assertNotIn("ORDER BY", latest_statement)

        # A late callback to an older-created order makes that order the most
        # recently changed context item without changing token determinism.
        older.status = "fulfilled"
        older.state_version += 1
        older.updated_at = now + timedelta(seconds=1)
        refreshed = await payment_service.get_purchase_context(
            _FakeSession([_ExecuteResult([older, latest])]),
            user_id="user-1",
        )
        self.assertEqual(refreshed.latest_order.id, str(older.id))
        self.assertEqual(refreshed.latest_order.state_version, 4)

    async def test_active_payment_state_query_locks_at_most_two_active_orders(self) -> None:
        session = _FakeSession([_ExecuteResult([])])

        await payment_service._find_active_payment_orders(
            session,
            user_id="user-1",
            for_update=True,
        )

        statement = session.statements[0]
        statement_text = str(statement)
        self.assertIn("payment_orders.status IN", statement_text)
        self.assertIn("LIMIT", statement_text)
        self.assertIn(2, statement.compile().params.values())
        self.assertIsNotNone(statement._for_update_arg)

    async def test_terminal_repurchase_rate_limit_rejects_before_new_order(self) -> None:
        now = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)
        old_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RATE-LIMIT-OLD",
            idempotency_key="rate-limit-old",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="cancelled",
            cancelled_at=now - timedelta(minutes=1),
            expires_at=now - timedelta(minutes=1),
            created_at=now - timedelta(minutes=5),
            updated_at=now - timedelta(minutes=1),
        )
        session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(old_order)],
            terminal_attempt_count=payment_service.TERMINAL_REPURCHASE_RATE_LIMIT_MAX,
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="rate-limit-new",
                expected_payment_state_token=_state_token(old_order),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail["code"], "payment_order_rate_limited")
        self.assertEqual(raised.exception.headers["Retry-After"], "3600")
        self.assertEqual(
            [item for item in session.added if isinstance(item, PaymentOrder)],
            [],
        )
        count_statement = next(
            statement
            for statement in session.statements
            if "count(payment_orders.id)" in str(statement)
        )
        self.assertIn("payment_orders.created_at >=", str(count_statement))

    async def test_terminal_repurchase_rate_limit_counts_just_expired_order(self) -> None:
        now = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)
        due_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RATE-LIMIT-DUE",
            idempotency_key="rate-limit-due",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="pending",
            expires_at=now - timedelta(seconds=1),
            created_at=now - timedelta(minutes=5),
            updated_at=now - timedelta(minutes=1),
        )
        session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(due_order)],
            terminal_attempt_count=(
                payment_service.TERMINAL_REPURCHASE_RATE_LIMIT_MAX - 1
            ),
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="rate-limit-new",
                expected_payment_state_token=_state_token(due_order),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(raised.exception.detail["code"], "payment_order_rate_limited")
        self.assertEqual(due_order.status, "pending")
        self.assertEqual(
            [item for item in session.added if isinstance(item, PaymentOrder)],
            [],
        )
        self.assertEqual(session.commits, 0)

    async def test_new_key_cannot_alias_an_active_order(self) -> None:
        now = datetime(2026, 8, 14, 4, 30, tzinfo=timezone.utc)
        active_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RATE-LIMIT-ACTIVE",
            idempotency_key="active-original",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="pending",
            expires_at=now + timedelta(minutes=20),
            created_at=now - timedelta(minutes=10),
            updated_at=now - timedelta(minutes=10),
        )
        session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(active_order)],
            terminal_attempt_count=payment_service.TERMINAL_REPURCHASE_RATE_LIMIT_MAX,
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="active-retry",
                expected_payment_state_token=_state_token(active_order),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "payment_order_unsettled")
        self.assertEqual(raised.exception.detail["order_id"], str(active_order.id))
        self.assertEqual(
            [item for item in session.added if isinstance(item, PaymentOrder)],
            [],
        )
        self.assertEqual(session.alias_inserts, [])
        self.assertEqual(session.commits, 0)
        self.assertFalse(
            any("count(payment_orders.id)" in str(statement) for statement in session.statements)
        )

    async def test_callback_first_invalidates_observed_state_before_new_order(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CALLBACK-FIRST",
            idempotency_key="old-key",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            benefit_type="tokens",
            token_amount=100_000,
            status="expired",
            state_version=4,
            expires_at=utc_now_aware(),
        )
        observed_token = _state_token(order)
        order.status = "fulfilled"
        order.state_version += 1
        stale_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult([order])]
        )
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                stale_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="new-key-after-callback",
                expected_payment_state_token=observed_token,
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.detail["code"], "payment_order_state_changed")
        self.assertEqual(raised.exception.detail["latest_order"]["id"], str(order.id))
        self.assertEqual(stale_session.added, [])

        refreshed_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult([order])]
        )
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            created = await payment_service.create_order(
                refreshed_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="new-key-after-refresh",
                expected_payment_state_token=_state_token(order),
                expected_catalog_version=_catalog_version(),
            )
        self.assertNotEqual(created.id, str(order.id))

    async def test_catalog_rollout_rejects_observed_old_price_before_order_creation(self) -> None:
        observed_version = _catalog_version()
        changed_products = tuple(
            (
                payment_catalog.PaymentProduct(
                    **{
                        **product.__dict__,
                        "amount_fen": 299,
                    }
                )
                if product.sku == "tokens_100k"
                else product
            )
            for product in payment_catalog.PRODUCTS
        )
        current_version = payment_service._catalog_version(list(changed_products))
        session = _FakeSession([_ExecuteResult(), _ExecuteResult()])
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "get_products", return_value=changed_products),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="old-catalog-click",
                expected_payment_state_token=_state_token(),
                expected_catalog_version=observed_version,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "payment_catalog_changed")
        self.assertEqual(raised.exception.detail["catalog_version"], current_version)
        self.assertEqual(session.added, [])
        self.assertEqual(session.commits, 0)
        _assert_no_key_user_lock(self, session.statements[0])

    async def test_non_latest_callback_also_invalidates_payment_state_token(self) -> None:
        now = utc_now_aware()
        older_unsettled = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-NONLATEST-OLD",
            idempotency_key="nonlatest-old",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            benefit_type="tokens",
            token_amount=100_000,
            status="expired",
            state_version=1,
            expires_at=now,
            created_at=now - timedelta(days=1),
        )
        latest = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-NONLATEST-LATEST",
            idempotency_key="nonlatest-latest",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            benefit_type="tokens",
            token_amount=500_000,
            status="fulfilled",
            state_version=2,
            expires_at=now,
            created_at=now,
        )
        observed_token = _state_token(older_unsettled, latest)
        older_unsettled.status = "fulfilled"
        older_unsettled.state_version += 1
        session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult([latest, older_unsettled])]
        )
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="nonlatest-new",
                expected_payment_state_token=observed_token,
                expected_catalog_version=_catalog_version(),
            )
        self.assertEqual(raised.exception.detail["code"], "payment_order_state_changed")
        self.assertEqual(raised.exception.detail["latest_order"]["id"], str(latest.id))

    async def test_two_empty_state_tabs_cannot_create_two_orders(self) -> None:
        empty_token = _state_token()
        first_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult([])]
        )
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            first = await payment_service.create_order(
                first_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="tab-one",
                expected_payment_state_token=empty_token,
                expected_catalog_version=_catalog_version(),
            )
        first_order = next(
            item for item in first_session.added if isinstance(item, PaymentOrder)
        )
        second_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult([first_order])]
        )
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                second_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="tab-two",
                expected_payment_state_token=empty_token,
                expected_catalog_version=_catalog_version(),
            )
        self.assertEqual(first.id, str(first_order.id))
        self.assertEqual(raised.exception.detail["code"], "payment_order_state_changed")
        self.assertEqual(second_session.added, [])

    async def test_alias_and_legacy_replay_bypass_current_payment_catalog(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-REPLAY-REMOVED",
            idempotency_key="legacy-replay",
            sku="tokens_test_10k",
            product_name="10K Token 测试包",
            amount_fen=10,
            benefit_type="tokens",
            token_amount=10_000,
            status="cancelled",
            expires_at=utc_now_aware(),
        )
        for label, session in (
            ("alias", _FakeSession([_ExecuteResult(order)])),
            ("legacy", _FakeSession([_ExecuteResult(), _ExecuteResult(order)])),
        ):
            with self.subTest(label=label), patch.object(
                payment_service,
                "_require_payments_enabled",
                side_effect=AssertionError("replay must bypass payment availability"),
            ), patch.object(
                payment_service,
                "get_products",
                side_effect=AssertionError("replay must bypass current catalog"),
            ):
                replayed = await payment_service.create_order(
                    session,
                    user_id="user-1",
                    sku="tokens_test_10k",
                    idempotency_key="legacy-replay",
                )
            self.assertEqual(replayed.id, str(order.id))

    async def test_same_sku_terminal_repurchase_creates_new_merchant_order(self) -> None:
        now = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        old_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-REUSE-TERMINAL",
            idempotency_key="first-attempt",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="cancelled",
            cancelled_at=now - timedelta(minutes=1),
            expires_at=now - timedelta(seconds=1),
        )
        session = _FakeSession([_ExecuteResult(), _ExecuteResult(), _ExecuteResult(old_order)])

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
        ):
            replacement = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="second-attempt",
                expected_payment_state_token=_state_token(old_order),
                expected_catalog_version=_catalog_version(),
            )

        replacement_order = next(
            item for item in session.added if isinstance(item, PaymentOrder)
        )
        self.assertEqual(replacement.id, str(replacement_order.id))
        self.assertNotEqual(replacement.id, str(old_order.id))
        self.assertEqual(old_order.merchant_order_no, "RF-REUSE-TERMINAL")
        self.assertEqual(old_order.status, "cancelled")
        self.assertEqual(old_order.cancelled_at, now - timedelta(minutes=1))
        self.assertEqual(replacement_order.sku, old_order.sku)
        self.assertEqual(replacement_order.status, "pending")
        self.assertEqual(replacement_order.expires_at, now + payment_service.ORDER_TTL)
        self.assertNotEqual(replacement_order.merchant_order_no, old_order.merchant_order_no)
        self.assertEqual(session.commits, 1)
        _assert_no_key_user_lock(self, session.statements[0])
        self.assertTrue(
            any("payment_orders" in str(item) for item in _locking_statements(session)[1:])
        )
        self.assertEqual(session.alias_inserts[0]["idempotency_key"], "second-attempt")
        self.assertEqual(session.alias_inserts[0]["payment_order_id"], replacement_order.id)
        self.assertEqual(replacement.state_version, 1)

    async def test_terminal_repurchase_keeps_each_key_bound_to_its_own_order(self) -> None:
        now = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-ALIAS-REPLAY",
            idempotency_key="K1",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="expired",
            expires_at=now - timedelta(minutes=1),
        )
        reuse_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(order)]
        )
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
        ):
            replacement = await payment_service.create_order(
                reuse_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="K2",
                expected_payment_state_token=_state_token(order),
                expected_catalog_version=_catalog_version(),
            )

        replacement_order = next(
            item for item in reuse_session.added if isinstance(item, PaymentOrder)
        )
        self.assertEqual(replacement.id, str(replacement_order.id))
        self.assertNotEqual(replacement.id, str(order.id))
        self.assertEqual(reuse_session.alias_inserts[0]["idempotency_key"], "K2")
        self.assertEqual(
            reuse_session.alias_inserts[0]["payment_order_id"],
            replacement_order.id,
        )

        replacement_order.status = "fulfilled"
        replacement_order.fulfilled_at = now
        for key, expected_order in (("K2", replacement_order), ("K1", order)):
            replay_session = _FakeSession([_ExecuteResult(expected_order)])
            with patch.object(
                payment_service,
                "_require_payments_enabled",
                return_value=_settings(),
            ), patch.object(
                payment_service,
                "_summary_for_order",
                AsyncMock(return_value=None),
            ):
                replayed = await payment_service.create_order(
                    replay_session,
                    user_id="user-1",
                    sku="tokens_100k",
                    idempotency_key=key,
                )
            self.assertEqual(replayed.id, str(expected_order.id))
            self.assertEqual(
                [item for item in replay_session.added if isinstance(item, PaymentOrder)],
                [],
            )
            self.assertEqual(replay_session.commits, 0)

    async def test_legacy_original_key_hit_is_backfilled_atomically(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-LEGACY-KEY",
            idempotency_key="legacy-key",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="fulfilled",
            expires_at=utc_now_aware(),
        )
        session = _FakeSession([_ExecuteResult(), _ExecuteResult(order)])
        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            replayed = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="legacy-key",
            )

        self.assertEqual(replayed.id, str(order.id))
        self.assertEqual(session.commits, 1)
        self.assertEqual(session.alias_inserts[0]["payment_order_id"], order.id)

    async def test_terminal_repurchase_uses_the_current_product_snapshot(self) -> None:
        current_snapshot = _snapshot_for("tokens_100k")
        cases = (
            ("price", {**current_snapshot, "amount_fen": 197}, 197, 100_000),
            ("benefit", {**current_snapshot, "token_amount": 99_000}, 198, 99_000),
        )
        for label, snapshot, amount_fen, token_amount in cases:
            with self.subTest(label=label):
                order = PaymentOrder(
                    user_id="user-1",
                    merchant_order_no=f"RF-CATALOG-{label.upper()}",
                    idempotency_key=f"old-{label}",
                    sku="tokens_100k",
                    product_name="100K Token 包",
                    amount_fen=amount_fen,
                    currency="CNY",
                    benefit_type="tokens",
                    token_amount=token_amount,
                    entitlement_snapshot_json=snapshot,
                    status="expired",
                    expires_at=utc_now_aware() - timedelta(minutes=1),
                )
                session = _FakeSession(
                    [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(order)]
                )
                with patch.object(
                    payment_service,
                    "_require_payments_enabled",
                    return_value=_settings(),
                ):
                    replacement = await payment_service.create_order(
                        session,
                        user_id="user-1",
                        sku="tokens_100k",
                        idempotency_key=f"new-{label}",
                        expected_payment_state_token=_state_token(order),
                        expected_catalog_version=_catalog_version(),
                    )

                replacement_order = next(
                    item for item in session.added if isinstance(item, PaymentOrder)
                )
                self.assertEqual(replacement.id, str(replacement_order.id))
                self.assertNotEqual(replacement.id, str(order.id))
                self.assertEqual(order.status, "expired")
                self.assertEqual(replacement_order.amount_fen, 198)
                self.assertEqual(replacement_order.token_amount, 100_000)
                self.assertEqual(
                    replacement_order.entitlement_snapshot_json,
                    current_snapshot,
                )
                self.assertEqual(session.commits, 1)

    async def test_terminal_order_does_not_block_a_new_different_sku(self) -> None:
        old_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-BLOCK-DIFFERENT-SKU",
            idempotency_key="first-attempt",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="expired",
            expires_at=utc_now_aware() - timedelta(minutes=1),
        )
        session = _FakeSession([_ExecuteResult(), _ExecuteResult(), _ExecuteResult(old_order)])

        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            replacement = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="second-attempt",
                expected_payment_state_token=_state_token(old_order),
                expected_catalog_version=_catalog_version(),
            )

        replacement_order = next(
            item for item in session.added if isinstance(item, PaymentOrder)
        )
        self.assertEqual(replacement.id, str(replacement_order.id))
        self.assertNotEqual(replacement.id, str(old_order.id))
        self.assertEqual(replacement_order.sku, "tokens_500k")
        self.assertEqual(old_order.status, "expired")

    async def test_multiple_terminal_orders_do_not_block_a_new_order(self) -> None:
        now = utc_now_aware()
        orders = [
            PaymentOrder(
                user_id="user-1",
                merchant_order_no=f"RF-LEGACY-{index}",
                idempotency_key=f"legacy-{index}",
                sku="tokens_100k",
                product_name="100K Token 包",
                amount_fen=198,
                currency="CNY",
                benefit_type="tokens",
                token_amount=100_000,
                status="expired",
                expires_at=now - timedelta(minutes=index),
            )
            for index in (1, 2)
        ]
        session = _FakeSession([_ExecuteResult(), _ExecuteResult(), _ExecuteResult(orders)])

        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            replacement = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="new-attempt",
                expected_payment_state_token=_state_token(*orders),
                expected_catalog_version=_catalog_version(),
            )

        replacement_order = next(
            item for item in session.added if isinstance(item, PaymentOrder)
        )
        self.assertEqual(replacement.id, str(replacement_order.id))
        self.assertTrue(all(order.status == "expired" for order in orders))
        _assert_no_key_user_lock(self, session.statements[0])

    async def test_late_callback_after_repurchase_fulfills_only_the_old_order(self) -> None:
        now = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        old_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-REUSE-LATE-CALLBACK",
            idempotency_key="first-attempt",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="expired",
            expires_at=now - timedelta(minutes=1),
        )
        repurchase_session = _FakeSession(
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(old_order)]
        )
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
        ):
            replacement = await payment_service.create_order(
                repurchase_session,
                user_id="user-1",
                sku="tokens_100k",
                idempotency_key="second-attempt",
                expected_payment_state_token=_state_token(old_order),
                expected_catalog_version=_catalog_version(),
            )

        status_during_grant: list[str] = []

        async def capture_terminal_status(*args, **kwargs):
            status_during_grant.append(old_order.status)

        grant_mock = AsyncMock(side_effect=capture_terminal_status)
        callback_session = _FakeSession([_ExecuteResult(old_order)])
        payload = {
            "pid": "1001",
            "out_trade_no": old_order.merchant_order_no,
            "money": "1.98",
            "currency": "CNY",
            "trade_status": "TRADE_SUCCESS",
            "trade_no": "YF-REUSE-LATE-CALLBACK",
        }
        with (
            patch.object(payment_service, "grant_entitlement", grant_mock),
            patch.object(payment_service, "_summary_for_order", AsyncMock(return_value=None)),
        ):
            fulfilled = await payment_service._fulfill_verified_payment(
                callback_session,
                merchant_order_no=old_order.merchant_order_no,
                payload=payload,
                record_webhook=False,
                settings=_settings(),
            )

        replacement_order = next(
            item for item in repurchase_session.added if isinstance(item, PaymentOrder)
        )
        self.assertEqual(replacement.id, str(replacement_order.id))
        self.assertNotEqual(replacement.id, str(old_order.id))
        self.assertEqual(fulfilled.id, str(old_order.id))
        self.assertEqual(fulfilled.status, "fulfilled")
        self.assertEqual(old_order.merchant_order_no, "RF-REUSE-LATE-CALLBACK")
        self.assertEqual(replacement_order.status, "pending")
        self.assertNotEqual(
            replacement_order.merchant_order_no,
            old_order.merchant_order_no,
        )
        grant_mock.assert_awaited_once()
        self.assertEqual(status_during_grant, ["expired"])
        self.assertTrue(
            any(
                "payment_orders" in str(item)
                for item in _locking_statements(repurchase_session)[1:]
            )
        )
        callback_lock_statements = _locking_statements(callback_session)
        _assert_no_key_user_lock(self, callback_lock_statements[0])
        self.assertIn("payment_orders", str(callback_lock_statements[1]))

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
            [_ExecuteResult(), _ExecuteResult(), _ExecuteResult(), _ExecuteResult(raced_order)]
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
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "idempotency_key_conflict")
        self.assertEqual(session.rollbacks, 1)

    async def test_flush_race_with_legacy_same_key_backfills_alias_before_return(self) -> None:
        raced_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RACED-SAME-SKU",
            idempotency_key="same-key",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            entitlement_snapshot_json=_snapshot_for("tokens_500k"),
            expires_at=utc_now_aware() + timedelta(minutes=20),
        )
        session = _IntegrityRaceSession(
            [
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(raced_order),
            ]
        )

        with patch.object(payment_service, "_require_payments_enabled", return_value=_settings()):
            replayed = await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="same-key",
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(replayed.id, str(raced_order.id))
        self.assertEqual(session.rollbacks, 1)
        self.assertEqual(session.commits, 1)
        self.assertEqual(session.alias_inserts[0]["payment_order_id"], raced_order.id)

    async def test_different_key_database_guard_conflict_returns_retryable_409(self) -> None:
        raced_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-RACED-DIFFERENT-KEY",
            idempotency_key="other-key",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            entitlement_snapshot_json=_snapshot_for("tokens_500k"),
            status="paid",
            paid_at=utc_now_aware(),
            expires_at=utc_now_aware() + timedelta(minutes=20),
        )
        session = _IntegrityRaceSession(
            [
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult([raced_order]),
            ]
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="new-key",
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "payment_order_reconciliation_required",
        )
        self.assertTrue(raised.exception.detail["retryable"])
        self.assertEqual(raised.exception.detail["order_id"], str(raced_order.id))
        self.assertEqual(session.rollbacks, 1)

    async def test_guard_conflict_remains_retryable_409_after_open_order_is_fulfilled(
        self,
    ) -> None:
        session = _IntegrityRaceSession(
            [
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult(),
                _ExecuteResult([]),
            ]
        )

        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_order(
                session,
                user_id="user-1",
                sku="tokens_500k",
                idempotency_key="new-key-after-race",
                expected_payment_state_token=_state_token(),
                expected_catalog_version=_catalog_version(),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(
            raised.exception.detail["code"],
            "payment_order_reconciliation_required",
        )
        self.assertTrue(raised.exception.detail["retryable"])
        self.assertIsNone(raised.exception.detail["order_id"])
        self.assertEqual(
            raised.exception.detail["payment_state_token"],
            _state_token(),
        )

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
            entitlement_snapshot_json=_snapshot_for("tokens_500k"),
            expires_at=now + timedelta(minutes=20),
        )
        session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])
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

    async def test_checkout_notify_url_respects_public_api_mount_prefix(self) -> None:
        for public_api_origin, expected_notify_url in (
            (
                "https://api.example.com/api",
                "https://api.example.com/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.com/gateway",
                "https://api.example.com/gateway/api/billing/payments/yifut/notify",
            ),
            (
                "https://api.example.com/gateway/api",
                "https://api.example.com/gateway/api/billing/payments/yifut/notify",
            ),
        ):
            with self.subTest(public_api_origin=public_api_origin):
                now = utc_now_aware()
                order = PaymentOrder(
                    user_id="user-1",
                    merchant_order_no=f"RF-ORIGIN-{uuid.uuid4().hex}",
                    idempotency_key=f"origin-{uuid.uuid4().hex}",
                    sku="tokens_500k",
                    product_name="500K Token 包",
                    amount_fen=990,
                    currency="CNY",
                    benefit_type="tokens",
                    token_amount=500_000,
                    entitlement_snapshot_json=_snapshot_for("tokens_500k"),
                    expires_at=now + timedelta(minutes=20),
                )
                session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])
                captured = {}

                def fake_signed_fields(fields, _private_key):
                    captured.update(fields)
                    return {**{key: str(value) for key, value in fields.items()}, "sign_type": "RSA", "sign": "sig"}

                with (
                    patch.object(
                        payment_service,
                        "_require_payments_enabled",
                        return_value=_settings(public_api_origin=public_api_origin),
                    ),
                    patch.object(
                        payment_service.payment_provider,
                        "build_signed_fields",
                        side_effect=fake_signed_fields,
                    ),
                ):
                    await payment_service.create_checkout(
                        session,
                        user_id="user-1",
                        order_id=str(order.id),
                    )

                self.assertEqual(captured["notify_url"], expected_notify_url)

    async def test_checkout_rejects_terminal_order_without_reopening_it(self) -> None:
        now = datetime(2026, 8, 12, 4, 30, tzinfo=timezone.utc)
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CHECKOUT-REOPEN",
            idempotency_key="checkout-reopen",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="expired",
            expires_at=now - timedelta(minutes=1),
        )
        session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            patch.object(payment_service, "utc_now", return_value=now),
            patch.object(payment_service.payment_provider, "build_signed_fields") as sign,
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_checkout(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )

        self.assertEqual(raised.exception.detail["code"], "payment_order_not_payable")
        self.assertEqual(order.merchant_order_no, "RF-CHECKOUT-REOPEN")
        self.assertEqual(order.status, "expired")
        self.assertEqual(order.expires_at, now - timedelta(minutes=1))
        self.assertEqual(session.commits, 0)
        sign.assert_not_called()
        _assert_no_key_user_lock(self, session.statements[0])

    async def test_checkout_blocks_catalog_drift_before_reopen_or_signing(self) -> None:
        current_snapshot = _snapshot_for("tokens_100k")
        for label, snapshot, amount_fen, token_amount in (
            ("price", {**current_snapshot, "amount_fen": 197}, 197, 100_000),
            ("benefit", {**current_snapshot, "token_amount": 99_000}, 198, 99_000),
        ):
            with self.subTest(label=label):
                order = PaymentOrder(
                    user_id="user-1",
                    merchant_order_no=f"RF-CHECKOUT-CATALOG-{label.upper()}",
                    idempotency_key=f"checkout-{label}",
                    sku="tokens_100k",
                    product_name="100K Token 包",
                    amount_fen=amount_fen,
                    currency="CNY",
                    benefit_type="tokens",
                    token_amount=token_amount,
                    entitlement_snapshot_json=snapshot,
                    status="expired",
                    expires_at=utc_now_aware() - timedelta(minutes=1),
                )
                session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])
                sign = AsyncMock()
                with (
                    patch.object(
                        payment_service,
                        "_require_payments_enabled",
                        return_value=_settings(),
                    ),
                    patch.object(payment_service.payment_provider, "build_signed_fields", sign),
                    self.assertRaises(HTTPException) as raised,
                ):
                    await payment_service.create_checkout(
                        session,
                        user_id="user-1",
                        order_id=str(order.id),
                    )

                self.assertEqual(raised.exception.detail["code"], "payment_order_catalog_changed")
                self.assertEqual(order.status, "expired")
                self.assertEqual(session.commits, 0)
                sign.assert_not_called()

    async def test_checkout_rejects_terminal_order_with_terminal_history(self) -> None:
        now = utc_now_aware()
        target = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CHECKOUT-LEGACY-TARGET",
            idempotency_key="legacy-target",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            entitlement_snapshot_json=_snapshot_for("tokens_100k"),
            status="expired",
            expires_at=now - timedelta(minutes=2),
        )
        other = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CHECKOUT-LEGACY-OTHER",
            idempotency_key="legacy-other",
            sku="tokens_500k",
            product_name="500K Token 包",
            amount_fen=990,
            currency="CNY",
            benefit_type="tokens",
            token_amount=500_000,
            status="cancelled",
            expires_at=now - timedelta(minutes=1),
            cancelled_at=now - timedelta(minutes=1),
        )
        session = _FakeSession([_ExecuteResult(target), _ExecuteResult([])])
        with (
            patch.object(payment_service, "_require_payments_enabled", return_value=_settings()),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.create_checkout(
                session,
                user_id="user-1",
                order_id=str(target.id),
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "payment_order_not_payable")
        self.assertEqual(target.status, "expired")
        self.assertEqual(session.commits, 0)
        _assert_no_key_user_lock(self, session.statements[0])

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
        trade_status_query_payload = {
            **valid,
            "status": "",
        }
        self.assertEqual(
            payment_service._validate_provider_payload(
                trade_status_query_payload,
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
        self.assertEqual(fulfilled.state_version, 2)
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
        self.assertEqual(duplicate.state_version, 2)
        self.assertEqual(wallet.remaining_tokens, 500_400)
        self.assertEqual(
            len([item for item in duplicate_session.added if isinstance(item, AITokenPurchaseEvent)]),
            0,
        )

    async def test_verified_late_payment_fulfills_cancelled_order_once(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-CANCELLED-LATE-PAID",
            idempotency_key="cancelled-late-paid",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=now - timedelta(minutes=1),
            status="cancelled",
            cancelled_at=now - timedelta(minutes=2),
        )
        payload = {
            "pid": "1001",
            "out_trade_no": order.merchant_order_no,
            "money": "1.98",
            "currency": "CNY",
            "trade_status": "TRADE_SUCCESS",
            "trade_no": "YF-CANCELLED-LATE-1",
        }
        grant_mock = AsyncMock()
        session = _FakeSession([_ExecuteResult(order)])
        with (
            patch.object(payment_service, "grant_entitlement", grant_mock),
            patch.object(payment_service, "_summary_for_order", AsyncMock(return_value=None)),
        ):
            fulfilled = await payment_service._fulfill_verified_payment(
                session,
                merchant_order_no=order.merchant_order_no,
                payload=payload,
                record_webhook=False,
                settings=_settings(),
            )

        self.assertEqual(fulfilled.status, "fulfilled")
        self.assertEqual(fulfilled.cancelled_at, order.cancelled_at)
        grant_mock.assert_awaited_once()

        duplicate_grant = AsyncMock()
        duplicate_session = _FakeSession([_ExecuteResult(order)])
        with (
            patch.object(payment_service, "grant_entitlement", duplicate_grant),
            patch.object(payment_service, "_summary_for_order", AsyncMock(return_value=None)),
        ):
            duplicate = await payment_service._fulfill_verified_payment(
                duplicate_session,
                merchant_order_no=order.merchant_order_no,
                payload=payload,
                record_webhook=False,
                settings=_settings(),
            )
        self.assertEqual(duplicate.status, "fulfilled")
        duplicate_grant.assert_not_awaited()

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
        lock_statements = _locking_statements(session)
        _assert_no_key_user_lock(self, lock_statements[0])
        self.assertIn("payment_orders", str(lock_statements[1]))

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
        lock_statements = _locking_statements(session)
        _assert_no_key_user_lock(self, lock_statements[0])
        self.assertIn("payment_orders", str(lock_statements[1]))

    async def test_sync_unpaid_uses_user_then_order_lock_before_local_expiry(self) -> None:
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-SYNC-UNPAID-LOCK",
            idempotency_key="sync-unpaid-lock",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            benefit_type="tokens",
            token_amount=100_000,
            status="pending",
            expires_at=utc_now_aware() + timedelta(minutes=10),
        )
        session = _FakeSession([_ExecuteResult(order), _ExecuteResult(order)])
        with (
            patch.object(payment_service, "_require_query_configured", return_value=_settings()),
            patch.object(
                payment_service.payment_provider,
                "query_order",
                return_value={"code": "0", "status": "0"},
            ),
        ):
            synced = await payment_service.sync_order(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )
        self.assertEqual(synced.status, "pending")
        lock_statements = _locking_statements(session)
        _assert_no_key_user_lock(self, lock_statements[0])
        self.assertIn("payment_orders", str(lock_statements[1]))

    async def test_sync_rejects_nonzero_provider_code_without_expiring_order(self) -> None:
        now = utc_now_aware()
        order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-SYNC-ERROR-CODE",
            idempotency_key="sync-error-code",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            status="pending",
            expires_at=now - timedelta(minutes=1),
        )
        session = _FakeSession([_ExecuteResult(order)])
        with (
            patch.object(payment_service, "_require_query_configured", return_value=_settings()),
            patch.object(
                payment_service.payment_provider,
                "query_order",
                return_value={"code": 1, "msg": "temporary provider error"},
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            await payment_service.sync_order(
                session,
                user_id="user-1",
                order_id=str(order.id),
            )

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail["code"], "payment_sync_failed")
        self.assertEqual(order.status, "pending")
        self.assertEqual(session.commits, 0)

    async def test_unpaid_sync_rechecks_the_order_under_lock_before_expiring(self) -> None:
        now = utc_now_aware()
        queried_order = PaymentOrder(
            user_id="user-1",
            merchant_order_no="RF-SYNC-RACE",
            idempotency_key="sync-race",
            sku="tokens_100k",
            product_name="100K Token 包",
            amount_fen=198,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=now - timedelta(minutes=1),
            status="pending",
        )
        fulfilled_order = PaymentOrder(
            id=queried_order.id,
            user_id="user-1",
            merchant_order_no=queried_order.merchant_order_no,
            idempotency_key=queried_order.idempotency_key,
            sku=queried_order.sku,
            product_name=queried_order.product_name,
            amount_fen=queried_order.amount_fen,
            currency="CNY",
            benefit_type="tokens",
            token_amount=100_000,
            expires_at=queried_order.expires_at,
            status="fulfilled",
            fulfilled_at=now,
        )
        provider_payload = {
            "code": 0,
            "pid": "1001",
            "out_trade_no": queried_order.merchant_order_no,
            "money": "1.98",
            "currency": "CNY",
            "status": 0,
        }
        session = _FakeSession(
            [_ExecuteResult(queried_order), _ExecuteResult(fulfilled_order)]
        )

        with (
            patch.object(payment_service, "_require_query_configured", return_value=_settings()),
            patch.object(payment_service.payment_provider, "query_order", return_value=provider_payload),
            patch.object(payment_service, "_summary_for_order", AsyncMock(return_value=None)),
        ):
            synced = await payment_service.sync_order(
                session,
                user_id="user-1",
                order_id=str(queried_order.id),
            )

        self.assertEqual(synced.status, "fulfilled")
        self.assertIn("FOR UPDATE", str(session.statements[1]).upper())
        self.assertEqual(session.commits, 0)

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
