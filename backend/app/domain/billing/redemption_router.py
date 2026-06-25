from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from ...utils.admin_utils import require_admin
from . import redemption_service
from .redemption_schemas import (
    RedemptionBatchCreate,
    RedemptionBatchCreateResponse,
    RedemptionBatchRevokeResponse,
    RedemptionPackageCreate,
    RedemptionPackageRead,
    RedemptionPackageUpdate,
    RedemptionRedeemRequest,
    RedemptionRedeemResponse,
    RedemptionRevokeResponse,
)

router = APIRouter(prefix="/api/billing", tags=["billing"])
admin_router = APIRouter(prefix="/api/admin/redemption", tags=["admin-redemption"])


@router.post("/redemptions", response_model=RedemptionRedeemResponse)
async def redeem_billing_code(
    payload: RedemptionRedeemRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    return await redemption_service.redeem_code(session, current_user.id, payload.code)


@admin_router.get("/packages", response_model=list[RedemptionPackageRead])
async def list_redemption_packages(
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.list_packages(session)


@admin_router.post("/packages", response_model=RedemptionPackageRead)
async def create_redemption_package(
    payload: RedemptionPackageCreate,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.create_package(session, payload)


@admin_router.patch("/packages/{package_id}", response_model=RedemptionPackageRead)
async def update_redemption_package(
    package_id: str,
    payload: RedemptionPackageUpdate,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.update_package(session, package_id, payload)


@admin_router.post("/batches", response_model=RedemptionBatchCreateResponse)
async def create_redemption_batch(
    payload: RedemptionBatchCreate,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.create_redemption_batch(
        session,
        created_by=current_admin.id,
        payload=payload,
    )


@admin_router.get("/batches/{batch_id}/export.csv")
async def export_redemption_batch(
    batch_id: str,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    csv_text = await redemption_service.export_batch_csv(session, batch_id)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="redemption-batch-{batch_id}.csv"'},
    )


@admin_router.post("/codes/{code_id}/revoke", response_model=RedemptionRevokeResponse)
async def revoke_redemption_code(
    code_id: str,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.revoke_code_response(session, code_id, current_admin.id)


@admin_router.post("/batches/{batch_id}/revoke", response_model=RedemptionBatchRevokeResponse)
async def revoke_redemption_batch(
    batch_id: str,
    session: AsyncSession = Depends(get_session),
    current_admin=Depends(require_admin),
):
    return await redemption_service.revoke_batch(session, batch_id, current_admin.id)
