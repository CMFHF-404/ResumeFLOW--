from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from . import billing_service
from .schemas import (
    TokenPurchaseOption,
    TokenPurchaseRequest,
    TokenPurchaseResponse,
    TokenQuotaSummary,
    TokenUsageListResponse,
)

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/summary", response_model=TokenQuotaSummary)
async def get_billing_summary(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await billing_service.get_summary(session, current_user.id)


@router.get("/usage", response_model=TokenUsageListResponse)
async def get_billing_usage(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await billing_service.list_usage_events(session, current_user.id, limit=limit)


@router.get("/purchases/options", response_model=list[TokenPurchaseOption])
async def get_billing_purchase_options():
    return billing_service.get_purchase_options()


@router.post("/purchases", response_model=TokenPurchaseResponse)
async def create_billing_purchase(
    payload: TokenPurchaseRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await billing_service.create_placeholder_purchase_response(
        session,
        current_user.id,
        payload.option_id,
    )
