from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Feedback
from ...utils.time_utils import utc_now
from .feedback_notifier import FeedbackNotification
from .schemas import FeedbackCreate

MAX_CONTENT_LENGTH = 500
DEFAULT_CATEGORY = "other"
ALLOWED_CATEGORIES = {"bug", "suggestion", "other"}


@dataclass(frozen=True)
class FeedbackView:
    id: str
    user_id: str
    category: str
    content: str
    contact: Optional[str]
    context_json: Dict[str, Any]
    created_at: datetime


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalize_category(value: str) -> str:
    normalized = value.strip().lower()
    return normalized if normalized in ALLOWED_CATEGORIES else DEFAULT_CATEGORY


def _ensure_valid_content(content: str) -> None:
    if not content:
        raise ValueError("content is required")
    if len(content) > MAX_CONTENT_LENGTH:
        raise ValueError(f"content length exceeds {MAX_CONTENT_LENGTH}")


def _normalize_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(context, dict):
        return {}
    return context


def build_feedback_view(feedback: Feedback) -> FeedbackView:
    return FeedbackView(
        id=str(feedback.id),
        user_id=feedback.user_id,
        category=feedback.category,
        content=feedback.content,
        contact=feedback.contact,
        context_json=feedback.context_json or {},
        created_at=feedback.created_at,
    )


def build_feedback_notification(feedback: Feedback) -> FeedbackNotification:
    return FeedbackNotification(
        feedback_id=str(feedback.id),
        user_id=feedback.user_id,
        category=feedback.category,
        content=feedback.content,
        contact=feedback.contact,
        context=feedback.context_json or {},
        created_at=feedback.created_at,
    )


async def create_feedback(
    session: AsyncSession, user_id: str, payload: FeedbackCreate
) -> Feedback:
    content = _normalize_text(payload.content) or ""
    _ensure_valid_content(content)
    category = _normalize_category(payload.category)
    contact = _normalize_text(payload.contact)
    context_json = _normalize_context(payload.context_json)
    feedback = Feedback(
        user_id=user_id,
        category=category,
        content=content,
        contact=contact,
        context_json=context_json,
        created_at=utc_now(),
    )
    session.add(feedback)
    await session.commit()
    await session.refresh(feedback)
    return feedback
