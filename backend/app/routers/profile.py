from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from ..database import get_session
from ..dependencies import get_current_user
from ..serializers import profile_to_read
from ..services import profile_service
from ..schemas import ProfileRead, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=ProfileRead)
async def get_profile(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    profile = await profile_service.ensure_profile(session, current_user.id)
    links = await profile_service.get_profile_links(session, current_user.id)
    return profile_to_read(profile, links)


@router.patch("", response_model=ProfileRead)
async def update_profile(
    payload: ProfileUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    profile = await profile_service.update_profile(session, current_user.id, payload)
    if payload.links is not None:
        links = await profile_service.replace_profile_links(
            session, current_user.id, payload.links
        )
    else:
        links = await profile_service.get_profile_links(session, current_user.id)
    return profile_to_read(profile, links)
