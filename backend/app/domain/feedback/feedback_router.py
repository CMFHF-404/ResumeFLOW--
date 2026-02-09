from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_201_CREATED, HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from .feedback_notifier import send_feishu_feedback
from .feedback_service import (
    build_feedback_notification,
    build_feedback_view,
    create_feedback,
)
from .schemas import FeedbackCreate, FeedbackRead

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackRead, status_code=HTTP_201_CREATED)
async def submit_feedback(
    payload: FeedbackCreate,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        feedback = await create_feedback(session, current_user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    notification = build_feedback_notification(feedback)
    background_tasks.add_task(send_feishu_feedback, notification)
    return FeedbackRead(**build_feedback_view(feedback).__dict__)
