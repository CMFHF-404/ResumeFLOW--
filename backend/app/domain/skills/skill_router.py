from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ...database import get_session
from ...dependencies import get_current_user
from .schemas import UserSkillCreate, UserSkillRead, UserSkillUpdate
from .skill_service import (
    NotFoundError,
    create_user_skill,
    delete_user_skill,
    get_user_skill,
    list_user_skills,
    update_user_skill,
)

router = APIRouter(prefix="/skills", tags=["skills"])


def _to_read(user_skill, skill) -> UserSkillRead:
    return UserSkillRead(
        id=str(user_skill.id),
        user_id=user_skill.user_id,
        skill_id=str(user_skill.skill_id),
        name=skill.name,
        category=skill.category,
        proficiency=user_skill.proficiency,
    )


@router.get("", response_model=List[UserSkillRead])
async def list_skills(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    rows = await list_user_skills(session, current_user.id)
    return [_to_read(user_skill, skill) for user_skill, skill in rows]


@router.post("", response_model=UserSkillRead)
async def create_skill(
    payload: UserSkillCreate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    user_skill, skill = await create_user_skill(session, current_user.id, payload)
    return _to_read(user_skill, skill)


@router.get("/{skill_id}", response_model=UserSkillRead)
async def get_skill(
    skill_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        user_skill, skill = await get_user_skill(session, current_user.id, skill_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_read(user_skill, skill)


@router.patch("/{skill_id}", response_model=UserSkillRead)
async def update_skill(
    skill_id: UUID,
    payload: UserSkillUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        user_skill, skill = await update_user_skill(
            session, current_user.id, skill_id, payload
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _to_read(user_skill, skill)


@router.delete("/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        await delete_user_skill(session, current_user.id, skill_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
