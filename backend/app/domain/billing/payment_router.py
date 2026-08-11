from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from . import payment_service
from .payment_schemas import (
    PaymentCheckoutResponse,
    PaymentOrderCreate,
    PaymentOrderRead,
    PaymentProductsResponse,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing-payments"])


@router.get("/products", response_model=PaymentProductsResponse)
async def get_payment_products():
    return payment_service.list_products()


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

