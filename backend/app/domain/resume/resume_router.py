from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND, HTTP_409_CONFLICT

from ...constants import DEFAULT_LIMIT, MAX_LIMIT
from ...database import get_session
from ...dependencies import get_current_user
from .serializers import resume_to_read as _resume_to_read
from .resume_schema import (
    ResumeAssemblyPatch,
    ResumeCreate,
    ResumeDetail,
    ResumeDuplicate,
    ResumeRead,
    ResumeUpdate,
)
from .resume_service import (
    ConcurrencyConflictError,
    NotFoundError,
    create_resume,
    delete_resume,
    duplicate_resume,
    get_resume_detail,
    list_resumes,
    update_resume,
    update_assembly,
)

router = APIRouter(prefix="/resumes", tags=["resumes"])


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
    except ConcurrencyConflictError as exc:
        raise HTTPException(status_code=HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _resume_to_read(resume)


@router.delete("/{resume_id}", status_code=204)
async def delete_resume_item(
    resume_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await delete_resume(session, current_user.id, resume_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=204)


@router.post("/{resume_id}/duplicate", response_model=ResumeRead)
async def duplicate_resume_item(
    resume_id: str,
    payload: Optional[ResumeDuplicate] = None,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        resume = await duplicate_resume(
            session,
            current_user.id,
            resume_id,
            title=payload.title if payload else None,
        )
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
    except ConcurrencyConflictError as exc:
        raise HTTPException(status_code=HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ResumeDetail(resume=_resume_to_read(resume), experiences=items)
