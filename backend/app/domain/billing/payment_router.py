from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from . import payment_service
from .payment_schemas import (
    PaymentCheckoutResponse,
    PaymentOrderCreate,
    PaymentOrderRead,
    PaymentOrdersResponse,
    PaymentPurchaseContextResponse,
    PaymentProductsResponse,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing-payments"])


@router.get("/products", response_model=PaymentProductsResponse)
async def get_payment_products(current_user=Depends(get_current_user)):
    return payment_service.list_products(user_id=current_user.id)


@router.get("/payments/yifut/notify", response_class=PlainTextResponse)
async def yifut_payment_notify(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    try:
        order = await payment_service.process_notification(session, request.query_params)
    except HTTPException as exc:
        logger.warning("Rejected Yifut notification: %s", exc.detail)
        return PlainTextResponse("fail", status_code=400)
    except Exception:
        logger.exception("Failed to process Yifut notification")
        return PlainTextResponse("fail", status_code=500)
    if order.status != payment_service.STATUS_FULFILLED:
        return PlainTextResponse("fail", status_code=500)
    return PlainTextResponse("success")


@router.post("/payment-orders", response_model=PaymentOrderRead)
async def create_payment_order(
    payload: PaymentOrderCreate,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.create_order(
        session,
        user_id=current_user.id,
        sku=payload.sku,
        idempotency_key=idempotency_key,
        expected_payment_state_token=payload.expected_payment_state_token,
        expected_catalog_version=payload.expected_catalog_version,
    )


@router.get(
    "/payment-orders/purchase-context",
    response_model=PaymentPurchaseContextResponse,
)
async def get_payment_purchase_context(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.get_purchase_context(
        session,
        user_id=current_user.id,
    )


@router.get("/payment-orders", response_model=PaymentOrdersResponse)
async def list_payment_orders(
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.list_orders(
        session,
        user_id=current_user.id,
        limit=limit,
        cursor=cursor,
    )


@router.post("/payment-orders/{order_id}/checkout", response_model=PaymentCheckoutResponse)
async def create_payment_checkout(
    order_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.create_checkout(
        session,
        user_id=current_user.id,
        order_id=order_id,
    )


@router.post("/payment-orders/{order_id}/cancel", response_model=PaymentOrderRead)
async def cancel_payment_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.cancel_order(
        session,
        user_id=current_user.id,
        order_id=order_id,
    )


@router.get("/payment-orders/{order_id}", response_model=PaymentOrderRead)
async def get_payment_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.get_order(session, user_id=current_user.id, order_id=order_id)


@router.post("/payment-orders/{order_id}/sync", response_model=PaymentOrderRead)
async def sync_payment_order(
    order_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await payment_service.sync_order(session, user_id=current_user.id, order_id=order_id)
