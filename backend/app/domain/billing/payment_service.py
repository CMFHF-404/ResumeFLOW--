from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import Settings, load_settings
from ...models import PaymentOrder, PaymentWebhookEvent
from ...utils.time_utils import utc_now_aware as utc_now
from . import billing_service, payment_provider
from .entitlement_service import EntitlementGrant, grant_entitlement
from .payment_catalog import PaymentProduct, get_product, get_products
from .payment_schemas import (
    PaymentCheckoutResponse,
    PaymentOrderRead,
    PaymentProductRead,
    PaymentProductsResponse,
)


ORDER_TTL = timedelta(minutes=30)
SOURCE_YIFUT_PAYMENT = "yifut_payment"
STATUS_PENDING = "pending"
STATUS_PAID = "paid"
STATUS_FULFILLED = "fulfilled"
STATUS_EXPIRED = "expired"
STATUS_FAILED = "failed"


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
                "message": "在线支付暂未开放，请使用卡密兑换。",
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
    products = get_products(
        include_test_product=_test_product_allowed(current, user_id)
    )
    return PaymentProductsResponse(
        payments_enabled=payments_enabled(current),
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


async def _summary_for_order(session: AsyncSession, order: PaymentOrder):
    if order.status != STATUS_FULFILLED:
        return None
    return await billing_service.get_summary(session, order.user_id)


async def to_order_read(session: AsyncSession, order: PaymentOrder) -> PaymentOrderRead:
    return PaymentOrderRead(
        id=str(order.id),
        status=order.status,
        sku=order.sku,
        product_name=order.product_name,
        amount_fen=int(order.amount_fen),
        currency=order.currency,
        created_at=order.created_at,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
        fulfilled_at=order.fulfilled_at,
        provider_trade_no=order.provider_trade_no,
        summary=await _summary_for_order(session, order),
    )


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


async def create_order(
    session: AsyncSession,
    *,
    user_id: str,
    sku: str,
    idempotency_key: str,
) -> PaymentOrderRead:
    current = _require_payments_enabled()
    key = (idempotency_key or "").strip()
    if not key or len(key) > 128:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_idempotency_key", "message": "Idempotency-Key 必填且不能超过 128 字符。"},
        )
    product = get_product(
        sku,
        include_test_product=_test_product_allowed(current, user_id),
    )
    if product is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_payment_product", "message": "未知的支付套餐。"},
        )

    existing_result = await session.execute(
        select(PaymentOrder).where(
            PaymentOrder.user_id == user_id,
            PaymentOrder.idempotency_key == key,
        )
    )
    existing = existing_result.scalars().first()
    if existing is not None:
        if existing.sku != product.sku:
            raise HTTPException(
                status_code=409,
                detail={"code": "idempotency_key_conflict", "message": "该幂等键已用于其他套餐。"},
            )
        return await to_order_read(session, existing)

    now = utc_now()
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
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raced_result = await session.execute(
            select(PaymentOrder).where(
                PaymentOrder.user_id == user_id,
                PaymentOrder.idempotency_key == key,
            )
        )
        raced = raced_result.scalars().first()
        if raced is None:
            raise
        if raced.sku != product.sku:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "idempotency_key_conflict",
                    "message": "该幂等键已用于其他套餐。",
                },
            )
        order = raced
    else:
        await session.refresh(order)
    return await to_order_read(session, order)


async def get_order(session: AsyncSession, *, user_id: str, order_id: str) -> PaymentOrderRead:
    order = await _find_by_id(session, order_id, user_id=user_id, for_update=True)
    if order.status == STATUS_PENDING and _is_expired(order):
        order.status = STATUS_EXPIRED
        order.updated_at = utc_now()
        await session.commit()
        await session.refresh(order)
    return await to_order_read(session, order)


async def create_checkout(
    session: AsyncSession,
    *,
    user_id: str,
    order_id: str,
) -> PaymentCheckoutResponse:
    settings = _require_payments_enabled()
    order = await _find_by_id(session, order_id, user_id=user_id, for_update=True)
    if order.status == STATUS_PENDING and _is_expired(order):
        order.status = STATUS_EXPIRED
        order.updated_at = utc_now()
        await session.commit()
    if order.status != STATUS_PENDING:
        raise HTTPException(
            status_code=409,
            detail={"code": "payment_order_not_payable", "message": "该订单当前不能发起支付。"},
        )

    return_url = f"{settings.frontend_origin}/?{urlencode({'payment_order': str(order.id)})}"
    fields = payment_provider.build_signed_fields(
        {
            "pid": settings.yifut_merchant_id,
            "out_trade_no": order.merchant_order_no,
            "name": order.product_name,
            "money": f"{Decimal(order.amount_fen) / Decimal(100):.2f}",
            "notify_url": (
                f"{settings.public_api_origin}/api/billing/payments/yifut/notify"
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
            str(payload.get("status") or "") == "1"
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
        order.status = STATUS_PAID
        order.provider_trade_no = trade_no
        order.paid_at = order.paid_at or _provider_paid_at(payload, now)
        order.updated_at = now
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
            now=order.paid_at,
        )
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

    if str(payload.get("code")) != "0" or not _query_reports_paid(payload):
        order = await _find_by_id(session, order_id, user_id=user_id)
        if order.status == STATUS_PENDING and _is_expired(order):
            order.status = STATUS_EXPIRED
            order.updated_at = utc_now()
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
