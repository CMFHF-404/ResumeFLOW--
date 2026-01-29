from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND

from ..constants import DEFAULT_LIMIT, MAX_LIMIT
from ..database import get_session
from ..dependencies import get_current_user
from ..serializers import resume_experience_to_read, resume_to_read
from ..services import resume_service
from ..schemas import ResumeCreate, ResumeDetail, ResumeExperiencePatch, ResumeRead, ResumeUpdate

router = APIRouter(prefix="/resumes", tags=["resumes"])


@router.get("", response_model=List[ResumeRead])
async def list_resumes(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    resumes = await resume_service.list_resumes(session, current_user.id, limit, offset)
    return [resume_to_read(resume) for resume in resumes]


@router.post("", response_model=ResumeRead)
async def create_resume(
    payload: ResumeCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    resume = await resume_service.create_resume(session, current_user.id, payload)
    return resume_to_read(resume)


@router.get("/{resume_id}", response_model=ResumeDetail)
async def get_resume_detail(
    resume_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        return await _build_resume_detail(session, current_user.id, resume_id)
    except resume_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{resume_id}", response_model=ResumeRead)
async def update_resume(
    resume_id: str,
    payload: ResumeUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        resume = await resume_service.update_resume(
            session, current_user.id, resume_id, payload
        )
    except resume_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return resume_to_read(resume)


@router.delete("/{resume_id}", response_model=ResumeRead)
async def archive_resume(
    resume_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        resume = await resume_service.archive_resume(session, current_user.id, resume_id)
    except resume_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return resume_to_read(resume)


@router.patch("/{resume_id}/experiences", response_model=ResumeDetail)
async def patch_resume_experiences(
    resume_id: str,
    payload: ResumeExperiencePatch,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await resume_service.apply_experience_ops(
            session, current_user.id, resume_id, payload
        )
        return await _build_resume_detail(session, current_user.id, resume_id)
    except resume_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


async def _build_resume_detail(
    session: AsyncSession, user_id: str, resume_id: str
) -> ResumeDetail:
    resume = await resume_service.get_resume(session, user_id, resume_id)
    pairs = await resume_service.list_resume_experiences(session, resume.id)
    experiences = [
        resume_experience_to_read(resume_exp, version)
        for resume_exp, version in pairs
    ]
    return ResumeDetail(resume=resume_to_read(resume), experiences=experiences)
