from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ...constants import DEFAULT_LIMIT, MAX_LIMIT
from ...database import get_session
from ...dependencies import get_current_user
from ...models import ExperienceCategory
from .experience_service import (
    NotFoundError,
    archive_experience,
    create_experience,
    get_experience_detail,
    list_experiences,
    update_experience,
)
from .schemas import (
    ExperienceCreate,
    ExperienceDetail,
    ExperienceListItem,
    ExperienceUpdate,
)
from .serializers import (
    experience_version_to_read as _version_to_read,
    master_experience_to_read as _master_to_read,
)

router = APIRouter(prefix="/experiences", tags=["experiences"])


@router.get("", response_model=List[ExperienceListItem])
async def list_experience_items(
    category: Optional[ExperienceCategory] = None,
    q: Optional[str] = None,
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    include_archived: bool = Query(True),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    rows = await list_experiences(
        session,
        current_user.id,
        category,
        q,
        limit,
        offset,
        include_archived=include_archived,
    )
    return [
        ExperienceListItem(
            master=_master_to_read(master),
            latest_version=_version_to_read(version) if version else None,
        )
        for master, version in rows
    ]


@router.post("", response_model=ExperienceDetail)
async def create_experience_item(
    payload: ExperienceCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    master, version = await create_experience(session, current_user.id, payload)
    return ExperienceDetail(
        master=_master_to_read(master),
        latest_version=_version_to_read(version),
        versions=[_version_to_read(version)],
    )


@router.get("/{master_id}", response_model=ExperienceDetail)
async def get_experience_item(
    master_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        master, latest_version, versions = await get_experience_detail(
            session, current_user.id, master_id
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=_master_to_read(master),
        latest_version=_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[_version_to_read(item) for item in versions],
    )


@router.patch("/{master_id}", response_model=ExperienceDetail)
async def update_experience_item(
    master_id: str,
    payload: ExperienceUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await update_experience(session, current_user.id, master_id, payload)
        master, latest_version, versions = await get_experience_detail(
            session, current_user.id, master_id
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=_master_to_read(master),
        latest_version=_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[_version_to_read(item) for item in versions],
    )


@router.delete("/{master_id}", response_model=ExperienceDetail)
async def delete_experience_item(
    master_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await archive_experience(session, current_user.id, master_id)
        master, latest_version, versions = await get_experience_detail(
            session, current_user.id, master_id
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExperienceDetail(
        master=_master_to_read(master),
        latest_version=_version_to_read(latest_version)
        if latest_version
        else None,
        versions=[_version_to_read(item) for item in versions],
    )
