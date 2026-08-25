from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import Settings, build_public_api_url, load_settings
from ...models import (
    PaymentOrder,
    PaymentOrderIdempotencyAlias,
    PaymentOrderStateRevision,
    PaymentWebhookEvent,
    User,
)
from ...utils.time_utils import utc_now_aware as utc_now
from . import billing_service, payment_provider
from .entitlement_service import EntitlementGrant, grant_entitlement
from .payment_catalog import PaymentProduct, get_product, get_products
from .payment_schemas import (
    PaymentCheckoutResponse,
    PaymentOrderListItem,
    PaymentOrderRead,
    PaymentOrdersResponse,
    PaymentPurchaseContextResponse,
    PaymentProductRead,
    PaymentProductsResponse,
)


ORDER_TTL = timedelta(minutes=30)
EXPIRY_USER_BATCH_SIZE = 100
SOURCE_YIFUT_PAYMENT = "yifut_payment"
STATUS_PENDING = "pending"
STATUS_PAID = "paid"
STATUS_FULFILLED = "fulfilled"
STATUS_EXPIRED = "expired"
STATUS_CANCELLED = "cancelled"
STATUS_FAILED = "failed"
ACTIVE_PAYMENT_ORDER_STATUSES = (
    STATUS_PENDING,
    STATUS_PAID,
)
TERMINAL_REPURCHASE_RATE_LIMIT_STATUSES = (
    STATUS_EXPIRED,
    STATUS_CANCELLED,
    STATUS_FAILED,
)
TERMINAL_REPURCHASE_RATE_LIMIT_WINDOW = timedelta(hours=1)
TERMINAL_REPURCHASE_RATE_LIMIT_MAX = 10
PROVIDER_OPEN_GUARD_CONSTRAINTS = frozenset(
    {
        "payment_orders_one_provider_open_per_user",
        # Compatibility with a claim table created before the primary key was
        # explicitly named by migration 014.
        "payment_order_provider_open_claims_pkey",
    }
)


def _valid_merchant_id(value: Any) -> bool:
    merchant_id = str(value or "").strip()
    return bool(merchant_id and merchant_id.isascii() and merchant_id.isdecimal())


def payments_enabled(settings: Settings | Any | None = None) -> bool:
    current = settings or load_settings()
    return bool(
        current.yifut_enabled
        and _valid_merchant_id(current.yifut_merchant_id)
        and current.yifut_merchant_private_key
        and current.yifut_platform_public_key
        and current.yifut_base_url
        and current.public_api_origin
        and current.frontend_origin
    )


def _require_payments_enabled(settings: Settings | Any | None = None) -> Any:
    current = settings or load_settings()
    if not payments_enabled(current):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "payments_unavailable",
                "message": "在线支付暂未开放，请稍后重试。",
            },
        )
    return current


def _require_notification_configured(settings: Settings | Any | None = None) -> Any:
    current = settings or load_settings()
    if not _valid_merchant_id(current.yifut_merchant_id) or not current.yifut_platform_public_key:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "payment_notification_unavailable",
                "message": "支付通知验签配置缺失。",
            },
        )
    return current


def _require_query_configured(settings: Settings | Any | None = None) -> Any:
    current = settings or load_settings()
    if not (
        _valid_merchant_id(current.yifut_merchant_id)
        and current.yifut_merchant_private_key
        and current.yifut_platform_public_key
        and current.yifut_base_url
    ):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "payment_query_unavailable",
                "message": "支付查单配置缺失。",
            },
        )
    return current


def _test_product_allowed(settings: Settings | Any, user_id: str) -> bool:
    return bool(user_id and user_id in getattr(settings, "yifut_test_user_ids", ()))


def list_products(
    settings: Settings | Any | None = None,
    *,
    user_id: str = "",
) -> PaymentProductsResponse:
    current = settings or load_settings()
    products = list(get_products(
        include_test_product=_test_product_allowed(current, user_id)
    ))
    return PaymentProductsResponse(
        payments_enabled=payments_enabled(current),
        catalog_version=_catalog_version(products),
        products=[PaymentProductRead(**product.__dict__) for product in products],
    )


def _parse_order_id(order_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(order_id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=404,
            detail={"code": "payment_order_not_found", "message": "支付订单不存在。"},
        ) from exc


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _is_expired(order: PaymentOrder, now: datetime | None = None) -> bool:
    return _aware_utc(order.expires_at) <= _aware_utc(now or utc_now())


def _expire_order_if_due(order: PaymentOrder, *, now: datetime) -> bool:
    if order.status != STATUS_PENDING or not _is_expired(order, now):
        return False
    order.status = STATUS_EXPIRED
    order.state_version += 1
    order.updated_at = now
    return True


async def expire_pending_orders(
    session: AsyncSession,
    *,
    user_id: str | None = None,
    now: datetime | None = None,
    batch_size: int = EXPIRY_USER_BATCH_SIZE,
) -> int:
    """Persist all orders that reached their strict 30-minute boundary.

    Expiration closes the local checkout and releases its active-payment claim.
    The original merchant order remains available for independently verified
    late provider reconciliation, while an explicit repurchase creates a new
    merchant order and ``create_checkout`` rejects the expired order.
    Global maintenance locks due users in bounded, skip-locked batches and
    commits each batch so multiple workers neither pile up user locks nor wait
    on the same batch. A targeted user pass retains its single-transaction
    behavior for request paths.
    """
    if batch_size < 1:
        raise ValueError("payment expiry batch_size must be positive")
    expired_at = _aware_utc(now or utc_now())
    if user_id is not None:
        await _lock_payment_user(session, user_id)
        result = await session.execute(
            update(PaymentOrder)
            .where(
                PaymentOrder.user_id == user_id,
                PaymentOrder.status == STATUS_PENDING,
                PaymentOrder.expires_at <= expired_at,
            )
            .values(
                status=STATUS_EXPIRED,
                state_version=PaymentOrder.state_version + 1,
                updated_at=expired_at,
            )
        )
        await session.commit()
        return int(getattr(result, "rowcount", 0) or 0)

    expired_count = 0
    while True:
        due_users = (
            select(PaymentOrder.user_id.label("user_id"))
            .where(
                PaymentOrder.status == STATUS_PENDING,
                PaymentOrder.expires_at <= expired_at,
            )
            .distinct()
            .subquery()
        )
        due_users_result = await session.execute(
            select(User.id)
            .join(
                due_users,
                due_users.c.user_id == User.id,
            )
            .order_by(User.id)
            .limit(batch_size)
            .with_for_update(key_share=True, skip_locked=True, of=User)
        )
        due_user_ids = list(due_users_result.scalars().all())
        if not due_user_ids:
            break
        for due_user_id in due_user_ids:
            # The batch query already holds User locks in stable order. Each
            # update therefore preserves User -> PaymentOrder lock ordering.
            result = await session.execute(
                update(PaymentOrder)
                .where(
                    PaymentOrder.user_id == due_user_id,
                    PaymentOrder.status == STATUS_PENDING,
                    PaymentOrder.expires_at <= expired_at,
                )
                .values(
                    status=STATUS_EXPIRED,
                    state_version=PaymentOrder.state_version + 1,
                    updated_at=expired_at,
                )
            )
            expired_count += int(getattr(result, "rowcount", 0) or 0)
        # Release all user locks before selecting the next bounded batch.
        await session.commit()
    return expired_count


def _merchant_order_no(now: datetime) -> str:
    return f"RF{now.strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:16].upper()}"


def _product_snapshot(product: PaymentProduct) -> dict[str, Any]:
    return {
        "sku": product.sku,
        "name": product.name,
        "category": product.category,
        "amount_fen": product.amount_fen,
        "currency": product.currency,
        "benefit_type": product.benefit_type,
        "token_amount": product.token_amount,
        "unlimited_duration_days": product.unlimited_duration_days,
        "description": product.description,
    }


def _catalog_version(products: list[PaymentProduct]) -> str:
    snapshots = sorted(
        (_product_snapshot(product) for product in products),
        key=lambda snapshot: str(snapshot["sku"]),
    )
    canonical = json.dumps(
        snapshots,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _order_matches_product_snapshot(order: PaymentOrder, product: PaymentProduct) -> bool:
    """Require the provider charge and entitlement snapshot to remain immutable."""
    return (
        order.sku == product.sku
        and order.product_name == product.name
        and int(order.amount_fen) == int(product.amount_fen)
        and order.currency == product.currency
        and order.benefit_type == product.benefit_type
        and int(order.token_amount or 0) == int(product.token_amount or 0)
        and order.unlimited_duration_days == product.unlimited_duration_days
        and dict(order.entitlement_snapshot_json or {}) == _product_snapshot(product)
    )


def _catalog_changed_error(order: PaymentOrder) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "payment_order_catalog_changed",
            "message": "套餐价格或权益已变更，该历史订单不能继续支付，请联系客服处理。",
            "order_id": str(order.id),
        },
    )


async def _summary_for_order(session: AsyncSession, order: PaymentOrder):
    if order.status != STATUS_FULFILLED:
        return None
    return await billing_service.get_summary(session, order.user_id)


async def to_order_read(session: AsyncSession, order: PaymentOrder) -> PaymentOrderRead:
    return PaymentOrderRead(
        id=str(order.id),
        status=order.status,
        state_version=int(order.state_version),
        sku=order.sku,
        product_name=order.product_name,
        amount_fen=int(order.amount_fen),
        currency=order.currency,
        created_at=order.created_at,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
        fulfilled_at=order.fulfilled_at,
        cancelled_at=order.cancelled_at,
        provider_trade_no=order.provider_trade_no,
        summary=await _summary_for_order(session, order),
    )


def _order_description(order: PaymentOrder) -> str:
    snapshot = order.entitlement_snapshot_json
    if not isinstance(snapshot, dict):
        return ""
    return str(snapshot.get("description") or "")


def to_order_list_item(order: PaymentOrder) -> PaymentOrderListItem:
    return PaymentOrderListItem(
        id=str(order.id),
        status=order.status,
        state_version=int(order.state_version),
        sku=order.sku,
        product_name=order.product_name,
        amount_fen=int(order.amount_fen),
        currency=order.currency,
        benefit_type=order.benefit_type,
        token_amount=int(order.token_amount or 0),
        unlimited_duration_days=order.unlimited_duration_days,
        description=_order_description(order),
        created_at=order.created_at,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
        fulfilled_at=order.fulfilled_at,
        cancelled_at=order.cancelled_at,
    )


def _encode_orders_cursor(created_at: datetime, order_id: uuid.UUID) -> str:
    payload = json.dumps(
        {
            "created_at": _aware_utc(created_at).isoformat(),
            "id": str(order_id),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_orders_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    value = (cursor or "").strip()
    try:
        if not value or len(value) > 512:
            raise ValueError("invalid cursor length")
        padded = value + "=" * (-len(value) % 4)
        raw = base64.b64decode(padded, altchars=b"-_", validate=True)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"created_at", "id"}:
            raise ValueError("invalid cursor payload")
        created_at = datetime.fromisoformat(str(payload["created_at"]).replace("Z", "+00:00"))
        if created_at.tzinfo is None:
            raise ValueError("cursor datetime must be timezone-aware")
        order_id = uuid.UUID(str(payload["id"]))
        return _aware_utc(created_at), order_id
    except (OverflowError, UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_orders_cursor", "message": "订单列表游标无效。"},
        ) from exc


async def _find_by_id(
    session: AsyncSession,
    order_id: str,
    *,
    user_id: str | None = None,
    for_update: bool = False,
) -> PaymentOrder:
    statement = select(PaymentOrder).where(PaymentOrder.id == _parse_order_id(order_id))
    if user_id is not None:
        statement = statement.where(PaymentOrder.user_id == user_id)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    order = result.scalars().first()
    if order is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "payment_order_not_found", "message": "支付订单不存在。"},
        )
    return order


async def _lock_payment_user(session: AsyncSession, user_id: str) -> None:
    """Serialize payment attempts without blocking entitlement FK key-shares.

    ``key_share=True`` with SQLAlchemy's default ``read=False`` emits PostgreSQL
    ``FOR NO KEY UPDATE``.  It is mutually exclusive with another payment lock
    for this user, but compatible with the ``KEY SHARE`` taken by foreign-key
    writes from other entitlement paths.
    """
    await session.execute(
        select(User.id).where(User.id == user_id).with_for_update(key_share=True)
    )


async def _find_order_by_idempotency_alias(
    session: AsyncSession,
    *,
    user_id: str,
    idempotency_key: str,
) -> PaymentOrder | None:
    result = await session.execute(
        select(PaymentOrder)
        .join(
            PaymentOrderIdempotencyAlias,
            PaymentOrderIdempotencyAlias.payment_order_id == PaymentOrder.id,
        )
        .where(
            PaymentOrderIdempotencyAlias.user_id == user_id,
            PaymentOrderIdempotencyAlias.idempotency_key == idempotency_key,
            PaymentOrder.user_id == user_id,
        )
    )
    return result.scalars().first()


async def _find_legacy_order_by_original_key(
    session: AsyncSession,
    *,
    user_id: str,
    idempotency_key: str,
) -> PaymentOrder | None:
    result = await session.execute(
        select(PaymentOrder).where(
            PaymentOrder.user_id == user_id,
            PaymentOrder.idempotency_key == idempotency_key,
        )
    )
    return result.scalars().first()


def _validate_idempotent_replay(order: PaymentOrder, requested_sku: str) -> None:
    if order.sku != requested_sku:
        raise HTTPException(
            status_code=409,
            detail={"code": "idempotency_key_conflict", "message": "该幂等键已用于其他套餐。"},
        )


async def _find_payment_state_snapshot(
    session: AsyncSession,
    *,
    user_id: str,
) -> tuple[int, uuid.UUID | None]:
    result = await session.execute(
        select(PaymentOrderStateRevision).where(
            PaymentOrderStateRevision.user_id == user_id
        )
    )
    state = result.scalars().first()
    if state is None:
        return 0, None
    return int(state.revision), state.latest_order_id


async def _find_latest_payment_order(
    session: AsyncSession,
    *,
    user_id: str,
    latest_order_id: uuid.UUID | None,
) -> PaymentOrder | None:
    if latest_order_id is None:
        return None
    result = await session.execute(
        select(PaymentOrder)
        .where(
            PaymentOrder.id == latest_order_id,
            PaymentOrder.user_id == user_id,
        )
    )
    return result.scalars().first()


async def _find_active_payment_orders(
    session: AsyncSession,
    *,
    user_id: str,
    for_update: bool = False,
) -> list[PaymentOrder]:
    statement = (
        select(PaymentOrder)
        .where(
            PaymentOrder.user_id == user_id,
            PaymentOrder.status.in_(ACTIVE_PAYMENT_ORDER_STATUSES),
        )
        .order_by(PaymentOrder.updated_at.desc(), PaymentOrder.id.desc())
        .limit(2)
    )
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    return [
        order
        for order in result.scalars().all()
        if order.status in ACTIVE_PAYMENT_ORDER_STATUSES
    ]


def _payment_state_token_from_revision(revision: int) -> str:
    canonical = str(max(0, int(revision))).encode("ascii")
    return hashlib.sha256(canonical).hexdigest()


def _payment_state_token(orders: list[PaymentOrder]) -> str:
    # Migration 016 initializes the per-user revision to this aggregate. Every
    # later insert or update advances the stored revision exactly once.
    return _payment_state_token_from_revision(
        sum(max(0, int(order.state_version)) for order in orders)
    )


def _payment_state_changed_error(
    *,
    revision: int,
    latest: PaymentOrder | None,
) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "payment_order_state_changed",
            "message": "支付订单状态已变化，请刷新订单状态后重试。",
            "payment_state_token": _payment_state_token_from_revision(revision),
            "latest_order": (
                to_order_list_item(latest).model_dump(mode="json")
                if latest is not None
                else None
            ),
        },
    )


def _is_provider_open_guard_conflict(error: BaseException) -> bool:
    pending: list[object] = [error]
    visited: set[int] = set()
    while pending:
        current = pending.pop()
        if current is None or id(current) in visited:
            continue
        visited.add(id(current))
        names = {
            getattr(current, "constraint_name", None),
            getattr(getattr(current, "diag", None), "constraint_name", None),
        }
        if PROVIDER_OPEN_GUARD_CONSTRAINTS.intersection(names):
            return True
        for attribute in ("orig", "__cause__", "__context__"):
            nested = getattr(current, attribute, None)
            if nested is not None:
                pending.append(nested)
    return any(name in str(error) for name in PROVIDER_OPEN_GUARD_CONSTRAINTS)


async def _raise_if_provider_open_write_conflict(
    session: AsyncSession,
    *,
    user_id: str,
    error: IntegrityError,
) -> None:
    if not _is_provider_open_guard_conflict(error):
        return
    revision, _ = await _find_payment_state_snapshot(session, user_id=user_id)
    provider_open = await _find_active_payment_orders(session, user_id=user_id)
    raise HTTPException(
        status_code=409,
        detail={
            "code": "payment_order_reconciliation_required",
            "message": "支付订单已被并发更新，请刷新订单状态后重试。",
            "retryable": True,
            "payment_state_token": _payment_state_token_from_revision(revision),
            "order_id": str(provider_open[0].id) if provider_open else None,
        },
    )


async def _raise_if_payment_state_changed(
    session: AsyncSession,
    *,
    user_id: str,
    revision: int,
    latest_order_id: uuid.UUID | None,
    expected_token: str | None,
) -> None:
    if (
        expected_token is not None
        and expected_token == _payment_state_token_from_revision(revision)
    ):
        return
    latest = await _find_latest_payment_order(
        session,
        user_id=user_id,
        latest_order_id=latest_order_id,
    )
    raise _payment_state_changed_error(revision=revision, latest=latest)


async def _enforce_terminal_repurchase_rate_limit(
    session: AsyncSession,
    *,
    user_id: str,
    now: datetime,
    additional_terminal_attempt_count: int = 0,
) -> None:
    result = await session.execute(
        select(func.count(PaymentOrder.id)).where(
            PaymentOrder.user_id == user_id,
            PaymentOrder.status.in_(TERMINAL_REPURCHASE_RATE_LIMIT_STATUSES),
            PaymentOrder.created_at >= now - TERMINAL_REPURCHASE_RATE_LIMIT_WINDOW,
        )
    )
    terminal_attempt_count = int(result.scalar_one() or 0) + max(
        0,
        int(additional_terminal_attempt_count),
    )
    if terminal_attempt_count < TERMINAL_REPURCHASE_RATE_LIMIT_MAX:
        return
    raise HTTPException(
        status_code=429,
        detail={
            "code": "payment_order_rate_limited",
            "message": "短时间内取消或超时的支付订单过多，请一小时后再试。",
            "retry_after_seconds": int(
                TERMINAL_REPURCHASE_RATE_LIMIT_WINDOW.total_seconds()
            ),
        },
        headers={
            "Retry-After": str(
                int(TERMINAL_REPURCHASE_RATE_LIMIT_WINDOW.total_seconds())
            )
        },
    )


async def _insert_idempotency_alias(
    session: AsyncSession,
    *,
    order: PaymentOrder,
    user_id: str,
    idempotency_key: str,
    now: datetime,
) -> None:
    """Insert the permanent key mapping in the caller's order transaction."""
    await session.flush()
    result = await session.execute(
        pg_insert(PaymentOrderIdempotencyAlias.__table__)
        .values(
            user_id=user_id,
            idempotency_key=idempotency_key,
            payment_order_id=order.id,
            created_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "idempotency_key"])
    )
    if int(getattr(result, "rowcount", 0) or 0) != 0:
        return
    mapped = await _find_order_by_idempotency_alias(
        session,
        user_id=user_id,
        idempotency_key=idempotency_key,
    )
    if mapped is None or mapped.id != order.id:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "idempotency_key_conflict", "message": "该幂等键已绑定其他支付订单。"},
        )


async def create_order(
    session: AsyncSession,
    *,
    user_id: str,
    sku: str,
    idempotency_key: str,
    expected_payment_state_token: str | None = None,
    expected_catalog_version: str | None = None,
) -> PaymentOrderRead:
    key = (idempotency_key or "").strip()
    if not key or len(key) > 128:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key 必填且不能超过 128 字符。"},
        )
    requested_sku = str(sku or "").strip()
    if not requested_sku or len(requested_sku) > 64:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_product", "message": "未知的支付套餐。"},
        )

    # Serialise payment-attempt creation even when this user does not yet have
    # an order row (locking payment_orders alone would not protect that gap).
    await _lock_payment_user(session, user_id)

    existing = await _find_order_by_idempotency_alias(
        session,
        user_id=user_id,
        idempotency_key=key,
    )
    if existing is not None:
        _validate_idempotent_replay(existing, requested_sku)
        return await to_order_read(session, existing)

    # Transitional fallback for deployments where application traffic reaches
    # this code before the alias backfill has observed an older order.
    legacy = await _find_legacy_order_by_original_key(
        session,
        user_id=user_id,
        idempotency_key=key,
    )
    if legacy is not None:
        _validate_idempotent_replay(legacy, requested_sku)
        now = utc_now()
        await _insert_idempotency_alias(
            session,
            order=legacy,
            user_id=user_id,
            idempotency_key=key,
            now=now,
        )
        await session.commit()
        await session.refresh(legacy)
        return await to_order_read(session, legacy)

    current = _require_payments_enabled()
    visible_products = list(
        get_products(include_test_product=_test_product_allowed(current, user_id))
    )
    current_catalog_version = _catalog_version(visible_products)
    if (
        expected_catalog_version is None
        or expected_catalog_version != current_catalog_version
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "payment_catalog_changed",
                "message": "支付套餐已更新，请刷新套餐与价格后重试。",
                "catalog_version": current_catalog_version,
            },
        )
    product = next(
        (item for item in visible_products if item.sku == requested_sku),
        None,
    )
    if product is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_product", "message": "未知的支付套餐。"},
        )

    state_revision, latest_order_id = await _find_payment_state_snapshot(
        session,
        user_id=user_id,
    )
    await _raise_if_payment_state_changed(
        session,
        user_id=user_id,
        revision=state_revision,
        latest_order_id=latest_order_id,
        expected_token=expected_payment_state_token,
    )

    # A cancelled or expired order remains available for late provider
    # reconciliation under its own merchant number, while an explicit
    # repurchase creates a new order. A genuinely new idempotency key must not
    # be attached to an active order: the user has to settle or cancel that
    # order first. Replays of the original key have already returned above.
    now = utc_now()
    active_orders = await _find_active_payment_orders(
        session,
        user_id=user_id,
        for_update=True,
    )
    due_orders = [
        order
        for order in active_orders
        if order.status == STATUS_PENDING and _is_expired(order, now)
    ]
    active_orders = [order for order in active_orders if order not in due_orders]
    if len(active_orders) > 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "payment_order_reconciliation_required",
                "message": "存在多笔未结算订单，需人工对账，请联系客服。",
                "order_id": str(active_orders[0].id),
            },
        )
    if active_orders:
        active_order = active_orders[0]
        raise HTTPException(
            status_code=409,
            detail={
                "code": "payment_order_unsettled",
                "message": "已有未结算订单，请先完成支付、等待到账或取消该订单后再重新下单。",
                "order_id": str(active_order.id),
                "sku": active_order.sku,
            },
        )

    due_terminal_attempt_count = sum(
        1
        for order in due_orders
        if _aware_utc(order.created_at)
        >= now - TERMINAL_REPURCHASE_RATE_LIMIT_WINDOW
    )
    await _enforce_terminal_repurchase_rate_limit(
        session,
        user_id=user_id,
        now=now,
        additional_terminal_attempt_count=due_terminal_attempt_count,
    )
    # The rolling limit includes just-expired active rows in memory before
    # mutating them. This avoids an autoflush counting an uncommitted expiration
    # and then rolling that expiration back with the 429 response.
    for due_order in due_orders:
        _expire_order_if_due(due_order, now=now)
    snapshot = _product_snapshot(product)
    order = PaymentOrder(
        user_id=user_id,
        merchant_order_no=_merchant_order_no(now),
        idempotency_key=key,
        sku=product.sku,
        product_name=product.name,
        amount_fen=product.amount_fen,
        currency=product.currency,
        benefit_type=product.benefit_type,
        token_amount=int(product.token_amount or 0),
        unlimited_duration_days=product.unlimited_duration_days,
        entitlement_snapshot_json=snapshot,
        status=STATUS_PENDING,
        expires_at=now + ORDER_TTL,
        created_at=now,
        updated_at=now,
    )
    session.add(order)
    try:
        await _insert_idempotency_alias(
            session,
            order=order,
            user_id=user_id,
            idempotency_key=key,
            now=now,
        )
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raced_from_legacy = False
        raced = await _find_order_by_idempotency_alias(
            session,
            user_id=user_id,
            idempotency_key=key,
        )
        if raced is None:
            raced = await _find_legacy_order_by_original_key(
                session,
                user_id=user_id,
                idempotency_key=key,
            )
            raced_from_legacy = raced is not None
        if raced is None:
            await _raise_if_provider_open_write_conflict(
                session,
                user_id=user_id,
                error=error,
            )
            raise
        _validate_idempotent_replay(raced, requested_sku)
        if raced_from_legacy:
            await _insert_idempotency_alias(
                session,
                order=raced,
                user_id=user_id,
                idempotency_key=key,
                now=utc_now(),
            )
            await session.commit()
            await session.refresh(raced)
        order = raced
    else:
        await session.refresh(order)
    return await to_order_read(session, order)


async def get_purchase_context(
    session: AsyncSession,
    *,
    user_id: str,
) -> PaymentPurchaseContextResponse:
    revision, latest_order_id = await _find_payment_state_snapshot(
        session,
        user_id=user_id,
    )
    latest = await _find_latest_payment_order(
        session,
        user_id=user_id,
        latest_order_id=latest_order_id,
    )
    return PaymentPurchaseContextResponse(
        payment_state_token=_payment_state_token_from_revision(revision),
        latest_order=to_order_list_item(latest) if latest is not None else None,
    )


async def list_orders(
    session: AsyncSession,
    *,
    user_id: str,
    limit: int = 20,
    cursor: str | None = None,
) -> PaymentOrdersResponse:
    if limit < 1 or limit > 50:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_orders_limit", "message": "订单列表每页数量必须在 1 到 50 之间。"},
        )
    cursor_values = _decode_orders_cursor(cursor) if cursor is not None else None
    await expire_pending_orders(session, user_id=user_id)

    statement = select(PaymentOrder).where(PaymentOrder.user_id == user_id)
    if cursor_values is not None:
        cursor_created_at, cursor_id = cursor_values
        statement = statement.where(
            or_(
                PaymentOrder.created_at < cursor_created_at,
                and_(
                    PaymentOrder.created_at == cursor_created_at,
                    PaymentOrder.id < cursor_id,
                ),
            )
        )
    statement = statement.order_by(
        PaymentOrder.created_at.desc(),
        PaymentOrder.id.desc(),
    ).limit(limit + 1)
    result = await session.execute(statement)
    orders = list(result.scalars().all())
    has_more = len(orders) > limit
    visible_orders = orders[:limit]
    next_cursor = None
    if has_more and visible_orders:
        last_order = visible_orders[-1]
        next_cursor = _encode_orders_cursor(last_order.created_at, last_order.id)
    return PaymentOrdersResponse(
        items=[to_order_list_item(order) for order in visible_orders],
        next_cursor=next_cursor,
        has_more=has_more,
    )


async def get_order(session: AsyncSession, *, user_id: str, order_id: str) -> PaymentOrderRead:
    await _lock_payment_user(session, user_id)
    order = await _find_by_id(session, order_id, user_id=user_id, for_update=True)
    now = utc_now()
    if _expire_order_if_due(order, now=now):
        await session.commit()
        await session.refresh(order)
    return await to_order_read(session, order)


async def cancel_order(
    session: AsyncSession,
    *,
    user_id: str,
    order_id: str,
) -> PaymentOrderRead:
    await _lock_payment_user(session, user_id)
    order = await _find_by_id(session, order_id, user_id=user_id, for_update=True)
    now = utc_now()
    if _expire_order_if_due(order, now=now):
        await session.commit()
        await session.refresh(order)
        return await to_order_read(session, order)
    if order.status == STATUS_PENDING:
        order.status = STATUS_CANCELLED
        order.state_version += 1
        order.cancelled_at = now
        order.updated_at = now
        await session.commit()
        await session.refresh(order)
        return await to_order_read(session, order)
    if order.status in {STATUS_CANCELLED, STATUS_EXPIRED, STATUS_FAILED}:
        return await to_order_read(session, order)
    if order.status in {STATUS_PAID, STATUS_FULFILLED}:
        raise HTTPException(
            status_code=409,
            detail={"code": "payment_order_not_cancellable", "message": "已支付订单不能取消。"},
        )
    raise HTTPException(
        status_code=409,
        detail={"code": "payment_order_not_cancellable", "message": "该订单当前不能取消。"},
    )


async def create_checkout(
    session: AsyncSession,
    *,
    user_id: str,
    order_id: str,
) -> PaymentCheckoutResponse:
    settings = _require_payments_enabled()
    await _lock_payment_user(session, user_id)
    order = await _find_by_id(session, order_id, user_id=user_id, for_update=True)
    unsettled_result = await session.execute(
        select(PaymentOrder)
        .where(
            PaymentOrder.user_id == user_id,
            PaymentOrder.status.in_(ACTIVE_PAYMENT_ORDER_STATUSES),
        )
        .order_by(PaymentOrder.created_at.desc(), PaymentOrder.id.desc())
        .with_for_update()
    )
    unsettled_orders = list(unsettled_result.scalars().all())
    if unsettled_orders and (
        len(unsettled_orders) != 1 or unsettled_orders[0].id != order.id
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "payment_order_reconciliation_required",
                "message": "存在多笔未结算订单，需人工对账，请联系客服。",
                "order_id": str(unsettled_orders[0].id),
            },
        )
    product = get_product(
        order.sku,
        include_test_product=_test_product_allowed(settings, user_id),
    )
    if product is None or not _order_matches_product_snapshot(order, product):
        raise _catalog_changed_error(order)
    now = utc_now()
    if order.status == STATUS_PENDING:
        expired_in_transaction = _expire_order_if_due(order, now=now)
    else:
        expired_in_transaction = False
    if expired_in_transaction:
        await session.commit()
        await session.refresh(order)
    if order.status != STATUS_PENDING:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "payment_order_not_payable",
                "message": "该订单当前不能发起支付。",
                "order_id": str(order.id),
                "state_version": int(order.state_version),
            },
        )

    return_url = f"{settings.frontend_origin}/?{urlencode({'payment_order': str(order.id)})}"
    fields = payment_provider.build_signed_fields(
        {
            "pid": settings.yifut_merchant_id,
            "out_trade_no": order.merchant_order_no,
            "name": order.product_name,
            "money": f"{Decimal(order.amount_fen) / Decimal(100):.2f}",
            "notify_url": build_public_api_url(
                settings.public_api_origin,
                "/api/billing/payments/yifut/notify",
            ),
            "return_url": return_url,
            "fee_mode": "0",
            "timestamp": str(int(utc_now().timestamp())),
        },
        settings.yifut_merchant_private_key,
    )
    return PaymentCheckoutResponse(
        order=await to_order_read(session, order),
        action=payment_provider.provider_url(settings.yifut_base_url, payment_provider.CHECKOUT_PATH),
        fields=fields,
    )


def _money_to_fen(value: Any) -> int:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if not amount.is_finite() or amount < 0:
            raise InvalidOperation
        return int(amount * 100)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_amount", "message": "支付金额无效。"},
        ) from exc


def _validate_provider_payload(
    payload: Mapping[str, Any],
    *,
    settings: Any,
    order: PaymentOrder,
    require_success: bool,
    allow_query_status: bool = False,
) -> str:
    if str(payload.get("pid") or "") != str(settings.yifut_merchant_id):
        raise HTTPException(status_code=400, detail={"code": "payment_merchant_mismatch", "message": "商户号不匹配。"})
    if str(payload.get("out_trade_no") or "") != order.merchant_order_no:
        raise HTTPException(status_code=400, detail={"code": "payment_order_mismatch", "message": "订单号不匹配。"})
    money = payload.get("money", payload.get("amount"))
    if money is None or _money_to_fen(money) != int(order.amount_fen):
        raise HTTPException(status_code=400, detail={"code": "payment_amount_mismatch", "message": "支付金额不匹配。"})
    currency = str(payload.get("currency") or "CNY").upper()
    if currency != order.currency:
        raise HTTPException(status_code=400, detail={"code": "payment_currency_mismatch", "message": "支付币种不匹配。"})
    if require_success:
        is_success = (
            (
                str(payload.get("status") or "") == "1"
                or str(payload.get("trade_status") or "") == "TRADE_SUCCESS"
            )
            if allow_query_status
            else str(payload.get("trade_status") or "") == "TRADE_SUCCESS"
        )
        if not is_success:
            raise HTTPException(
                status_code=400,
                detail={"code": "payment_not_successful", "message": "支付状态不是成功。"},
            )
    trade_no = str(payload.get("trade_no") or "").strip()
    if not trade_no:
        raise HTTPException(status_code=400, detail={"code": "payment_trade_no_missing", "message": "平台交易号缺失。"})
    return trade_no


def _event_key(payload: Mapping[str, Any]) -> str:
    canonical = payment_provider.canonicalize_parameters(payload)
    signature = str(payload.get("sign") or "")
    return hashlib.sha256(f"{canonical}&sign={signature}".encode("utf-8")).hexdigest()


def _provider_paid_at(payload: Mapping[str, Any], fallback: datetime) -> datetime:
    endtime = str(payload.get("endtime") or "").strip()
    if not endtime:
        return fallback
    try:
        local_paid_at = datetime.strptime(endtime, "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=ZoneInfo("Asia/Shanghai")
        )
    except ValueError:
        return fallback
    return local_paid_at.astimezone(timezone.utc)


async def _fulfill_verified_payment(
    session: AsyncSession,
    *,
    merchant_order_no: str,
    payload: Mapping[str, Any],
    record_webhook: bool,
    settings: Any | None = None,
    allow_query_status: bool = False,
) -> PaymentOrderRead:
    current_settings = settings or _require_notification_configured()
    owner_result = await session.execute(
        select(PaymentOrder.user_id).where(PaymentOrder.merchant_order_no == merchant_order_no)
    )
    order_user_id = owner_result.scalars().first()
    if order_user_id is None:
        raise HTTPException(status_code=404, detail={"code": "payment_order_not_found", "message": "支付订单不存在。"})
    # Keep the same User -> PaymentOrder lock order as creation and checkout.
    # The entitlement write references users, so taking the order lock first can
    # deadlock against a concurrent checkout which already holds the user row.
    await _lock_payment_user(session, order_user_id)
    result = await session.execute(
        select(PaymentOrder)
        .where(PaymentOrder.merchant_order_no == merchant_order_no)
        .with_for_update()
    )
    order = result.scalars().first()
    if order is None:
        raise HTTPException(status_code=404, detail={"code": "payment_order_not_found", "message": "支付订单不存在。"})
    trade_no = _validate_provider_payload(
        payload,
        settings=current_settings,
        order=order,
        require_success=True,
        allow_query_status=allow_query_status,
    )
    if order.provider_trade_no and order.provider_trade_no != trade_no:
        raise HTTPException(status_code=409, detail={"code": "payment_trade_no_conflict", "message": "平台交易号冲突。"})

    webhook_event = None
    if record_webhook:
        key = _event_key(payload)
        event_result = await session.execute(
            select(PaymentWebhookEvent).where(PaymentWebhookEvent.event_key == key)
        )
        webhook_event = event_result.scalars().first()
        if webhook_event is None:
            webhook_event = PaymentWebhookEvent(
                event_key=key,
                merchant_order_no=order.merchant_order_no,
                provider_trade_no=trade_no,
                signature_valid=True,
                payload_json=dict(payload),
            )
            session.add(webhook_event)

    now = utc_now()
    if order.status != STATUS_FULFILLED:
        paid_at = order.paid_at or _provider_paid_at(payload, now)
        await grant_entitlement(
            session,
            user_id=order.user_id,
            grant=EntitlementGrant(
                option_id=order.sku,
                label=order.product_name,
                benefit_type=order.benefit_type,
                token_amount=int(order.token_amount or 0),
                unlimited_duration_days=order.unlimited_duration_days,
            ),
            source=SOURCE_YIFUT_PAYMENT,
            source_id=str(order.id),
            status="payment_succeeded",
            metadata={
                "provider": "yifut",
                "merchant_order_no": order.merchant_order_no,
                "provider_trade_no": trade_no,
                "amount_fen": int(order.amount_fen),
                "currency": order.currency,
            },
            now=paid_at,
        )
        # Persist the payment order as one terminal transition after the
        # entitlement write. This avoids an observable intermediate `paid`
        # state competing with a newer active order's per-user claim.
        order.state_version += 1
        order.provider_trade_no = trade_no
        order.paid_at = paid_at
        order.status = STATUS_FULFILLED
        order.fulfilled_at = now
        order.updated_at = now
    if webhook_event is not None:
        webhook_event.processed_at = now
    await session.commit()
    await session.refresh(order)
    return await to_order_read(session, order)


async def process_notification(session: AsyncSession, payload: Mapping[str, Any]) -> PaymentOrderRead:
    settings = _require_notification_configured()
    values = {str(key): str(value) for key, value in payload.items()}
    if not payment_provider.verify_parameters(values, settings.yifut_platform_public_key):
        raise HTTPException(status_code=400, detail={"code": "invalid_payment_signature", "message": "支付通知签名无效。"})
    merchant_order_no = str(values.get("out_trade_no") or "")
    if not merchant_order_no:
        raise HTTPException(status_code=400, detail={"code": "payment_order_no_missing", "message": "商户订单号缺失。"})
    return await _fulfill_verified_payment(
        session,
        merchant_order_no=merchant_order_no,
        payload=values,
        record_webhook=True,
        settings=settings,
    )


def _query_reports_paid(payload: Mapping[str, Any]) -> bool:
    return (
        str(payload.get("trade_status") or "") == "TRADE_SUCCESS"
        or str(payload.get("status") or "") == "1"
    )


async def sync_order(session: AsyncSession, *, user_id: str, order_id: str) -> PaymentOrderRead:
    order = await _find_by_id(session, order_id, user_id=user_id)
    if order.status == STATUS_FULFILLED:
        return await to_order_read(session, order)
    merchant_order_no = order.merchant_order_no
    await session.rollback()
    settings = _require_query_configured()
    try:
        payload = await payment_provider.query_order(
            base_url=settings.yifut_base_url,
            merchant_id=settings.yifut_merchant_id,
            merchant_private_key=settings.yifut_merchant_private_key,
            platform_public_key=settings.yifut_platform_public_key,
            merchant_order_no=merchant_order_no,
        )
    except payment_provider.PaymentProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": "payment_sync_failed", "message": "暂时无法向支付平台查询订单。"},
        ) from exc

    if str(payload.get("code")) != "0":
        raise HTTPException(
            status_code=502,
            detail={"code": "payment_sync_failed", "message": "支付平台未能确认订单状态。"},
        )

    if not _query_reports_paid(payload):
        await _lock_payment_user(session, user_id)
        order = await _find_by_id(
            session,
            order_id,
            user_id=user_id,
            for_update=True,
        )
        now = utc_now()
        if _expire_order_if_due(order, now=now):
            await session.commit()
            await session.refresh(order)
        return await to_order_read(session, order)

    return await _fulfill_verified_payment(
        session,
        merchant_order_no=merchant_order_no,
        payload=payload,
        record_webhook=False,
        settings=settings,
        allow_query_status=True,
    )
