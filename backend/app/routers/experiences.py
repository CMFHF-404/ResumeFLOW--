from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ..constants import DEFAULT_LIMIT, MAX_LIMIT
from ..database import get_session
from ..dependencies import get_current_user
from ..models import ExperienceCategory
from ..serializers import experience_version_to_read, master_experience_to_read
from ..services import experience_service
from ..schemas import (
    ExperienceCreate,
    ExperienceDetail,
    ExperienceListItem,
    ExperienceUpdate,
    ExperienceVersionPayload,
    ExperienceVersionRead,
)

router = APIRouter(prefix="/experiences", tags=["experiences"])


@router.get("", response_model=List[ExperienceListItem])
async def list_experiences(
    category: Optional[ExperienceCategory] = None,
    q: Optional[str] = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    rows = await experience_service.list_experiences(
        session,
        current_user.id,
        category,
        q,
        limit,
        offset,
    )
    return [
        ExperienceListItem(
            master=master_experience_to_read(master),
            latest_version=experience_version_to_read(version) if version else None,
        )
        for master, version in rows
    ]


@router.post("", response_model=ExperienceDetail)
async def create_experience(
    payload: ExperienceCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    master, version = await experience_service.create_experience(
        session, current_user.id, payload
    )
    return ExperienceDetail(
        master=master_experience_to_read(master),
        latest_version=experience_version_to_read(version),
        versions=[experience_version_to_read(version)],
    )


@router.get("/{master_id}", response_model=ExperienceDetail)
async def get_experience_detail(
    master_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        master, latest_version, versions = await experience_service.get_experience_detail(
            session, current_user.id, master_id
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=master_experience_to_read(master),
        latest_version=experience_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[experience_version_to_read(item) for item in versions],
    )


@router.patch("/{master_id}", response_model=ExperienceDetail)
async def update_experience(
    master_id: str,
    payload: ExperienceUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await experience_service.update_master(
            session, current_user.id, master_id, payload
        )
        master, latest_version, versions = await experience_service.get_experience_detail(
            session, current_user.id, master_id
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=master_experience_to_read(master),
        latest_version=experience_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[experience_version_to_read(item) for item in versions],
    )


@router.post("/{master_id}/versions", response_model=ExperienceVersionRead)
async def create_experience_version(
    master_id: str,
    payload: ExperienceVersionPayload,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        version = await experience_service.create_version(
            session, current_user.id, master_id, payload
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return experience_version_to_read(version)


@router.get("/{master_id}/versions", response_model=List[ExperienceVersionRead])
async def list_experience_versions(
    master_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        _, _, versions = await experience_service.get_experience_detail(
            session, current_user.id, master_id
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [experience_version_to_read(version) for version in versions]


@router.delete("/{master_id}", response_model=ExperienceDetail)
async def archive_experience(
    master_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        master = await experience_service.archive_master(
            session, current_user.id, master_id
        )
        master, latest_version, versions = await experience_service.get_experience_detail(
            session, current_user.id, master_id
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=master_experience_to_read(master),
        latest_version=experience_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[experience_version_to_read(item) for item in versions],
    )
