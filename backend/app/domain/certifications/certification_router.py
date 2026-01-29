from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ...database import get_session
from ...dependencies import get_current_user
from .certification_service import (
    NotFoundError,
    create_certification,
    delete_certification,
    get_certification,
    list_certifications,
    update_certification,
)
from .schemas import CertificationCreate, CertificationRead, CertificationUpdate

router = APIRouter(prefix="/certifications", tags=["certifications"])


def _cert_to_read(cert) -> CertificationRead:
    return CertificationRead(
        id=str(cert.id),
        user_id=cert.user_id,
        name=cert.name,
        issuer=cert.issuer,
        issue_date=cert.issue_date,
        expiry_date=cert.expiry_date,
        credential_id=cert.credential_id,
        credential_url=cert.credential_url,
        description=cert.description,
        created_at=cert.created_at,
        updated_at=cert.updated_at,
    )


@router.get("", response_model=List[CertificationRead])
async def list_user_certifications(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    certs = await list_certifications(session, current_user.id)
    return [_cert_to_read(cert) for cert in certs]


@router.post("", response_model=CertificationRead)
async def create_user_certification(
    payload: CertificationCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    cert = await create_certification(session, current_user.id, payload)
    return _cert_to_read(cert)


@router.get("/{cert_id}", response_model=CertificationRead)
async def get_user_certification(
    cert_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        cert = await get_certification(session, current_user.id, cert_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _cert_to_read(cert)


@router.patch("/{cert_id}", response_model=CertificationRead)
async def update_user_certification(
    cert_id: UUID,
    payload: CertificationUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        cert = await update_certification(session, current_user.id, cert_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _cert_to_read(cert)


@router.delete("/{cert_id}", status_code=204)
async def delete_user_certification(
    cert_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await delete_certification(session, current_user.id, cert_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
