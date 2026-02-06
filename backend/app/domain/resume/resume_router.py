from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND

from ...constants import DEFAULT_LIMIT, MAX_LIMIT
from ...database import get_session
from ...dependencies import get_current_user
from .resume_schema import (
    ResumeAssemblyPatch,
    ResumeCreate,
    ResumeDetail,
    ResumeRead,
    ResumeUpdate,
)
from .resume_service import (
    NotFoundError,
    create_resume,
    get_resume_detail,
    list_resumes,
    update_resume,
    update_assembly,
)

router = APIRouter(prefix="/resumes", tags=["resumes"])


def _resume_to_read(resume) -> ResumeRead:
    return ResumeRead(
        id=str(resume.id),
        user_id=str(resume.user_id),
        title=resume.title,
        target_role=resume.target_role,
        config=resume.config or {},
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )


@router.get("", response_model=List[ResumeRead])
async def list_resume_items(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    resumes = await list_resumes(session, current_user.id, limit, offset)
    return [_resume_to_read(resume) for resume in resumes]


@router.post("", response_model=ResumeRead)
async def create_resume_item(
    payload: ResumeCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    resume = await create_resume(session, current_user.id, payload)
    return _resume_to_read(resume)


@router.patch("/{resume_id}", response_model=ResumeRead)
async def patch_resume_item(
    resume_id: str,
    payload: ResumeUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        resume = await update_resume(session, current_user.id, resume_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _resume_to_read(resume)


@router.get("/{resume_id}", response_model=ResumeDetail)
async def get_resume_item(
    resume_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        resume, items = await get_resume_detail(session, current_user.id, resume_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ResumeDetail(resume=_resume_to_read(resume), experiences=items)


@router.patch("/{resume_id}/assembly", response_model=ResumeDetail)
async def patch_resume_assembly(
    resume_id: str,
    payload: ResumeAssemblyPatch,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await update_assembly(session, current_user.id, resume_id, payload)
        resume, items = await get_resume_detail(session, current_user.id, resume_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ResumeDetail(resume=_resume_to_read(resume), experiences=items)

