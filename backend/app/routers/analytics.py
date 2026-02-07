from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..dependencies import get_current_user
from ..services.analytics_service import (
    get_ai_quality_data,
    get_editor_ux_data,
    get_funnel_data,
)
from ..utils.admin_utils import is_admin, require_admin

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/check-admin")
async def check_admin_permission(
    session: Annotated[AsyncSession, Depends(get_session)],
    current_user=Depends(get_current_user),
):
    return {"is_admin": await is_admin(current_user.id, session)}


@router.get("/funnel")
async def fetch_funnel_data(_: Annotated[object, Depends(require_admin)]):
    return await get_funnel_data()


@router.get("/ai-quality")
async def fetch_ai_quality_data(_: Annotated[object, Depends(require_admin)]):
    return await get_ai_quality_data()


@router.get("/editor-ux")
async def fetch_editor_ux_data(_: Annotated[object, Depends(require_admin)]):
    return await get_editor_ux_data()
