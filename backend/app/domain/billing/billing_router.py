from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from . import billing_service
from .schemas import (
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
