from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ...database import get_session
from ...dependencies import get_current_user
from ...models import ExperienceCategory
from .draft_schemas import ExperienceDraftRead, ExperienceDraftUpsert
from .draft_service import (
    delete_experience_draft,
    draft_to_read,
    list_experience_drafts,
    upsert_experience_draft,
)
from .experience_service import NotFoundError

router = APIRouter(prefix="/api/experience-drafts", tags=["experience-drafts"])


@router.get("", response_model=List[ExperienceDraftRead])
async def list_drafts(
    category: Optional[ExperienceCategory] = None,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    if category not in {ExperienceCategory.WORK, ExperienceCategory.PROJECT}:
        return []
    drafts = await list_experience_drafts(session, current_user.id, category)
    return [draft_to_read(draft) for draft in drafts]


@router.post("", response_model=ExperienceDraftRead)
async def upsert_draft(
    payload: ExperienceDraftUpsert,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        draft = await upsert_experience_draft(session, current_user.id, payload)
    except (NotFoundError, ValueError) as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return draft_to_read(draft)


@router.delete("/{draft_id}", response_model=ExperienceDraftRead)
async def delete_draft(
    draft_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        draft = await delete_experience_draft(session, current_user.id, draft_id)
    except (NotFoundError, ValueError) as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return draft_to_read(draft)
