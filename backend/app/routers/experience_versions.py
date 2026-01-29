from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ..database import get_session
from ..dependencies import get_current_user
from ..serializers import experience_version_to_read
from ..services import experience_service
from ..schemas import ExperienceVersionRead

router = APIRouter(prefix="/experience-versions", tags=["experiences"])


@router.get("/{version_id}", response_model=ExperienceVersionRead)
async def get_experience_version(
    version_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        version = await experience_service.get_version_for_user(
            session, current_user.id, version_id
        )
    except experience_service.NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return experience_version_to_read(version)
