from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional
import base64

from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Feedback
from ...utils.time_utils import utc_now
from .feedback_notifier import FeedbackNotification
from .schemas import FeedbackCreate

MAX_CONTENT_LENGTH = 500
MAX_IMAGE_COUNT = 3
MAX_IMAGE_BYTES = 2 * 1024 * 1024  # 2MB
DEFAULT_CATEGORY = "other"
ALLOWED_CATEGORIES = {"bug", "suggestion", "other"}
ALLOWED_IMAGE_MIME_PREFIXES = ("image/jpeg", "image/png", "image/webp", "image/gif")


@dataclass(frozen=True)
class FeedbackView:
    id: str
    user_id: str
    category: str
    content: str
    contact: Optional[str]
    context_json: Dict[str, Any]
    image_count: int
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


def _validate_and_encode_images(
    images: List[tuple[bytes, str]]
) -> List[str]:
    """
    校验图片列表并转换为 base64 data URI 字符串列表。

    参数:
        images: [(raw_bytes, mime_type), ...] 列表
    返回:
        ["data:<mime>;base64,<b64>", ...] 字符串列表
    异常:
        ValueError: 图片数量超限、类型不合法、或单张超过大小限制
    """
    if len(images) > MAX_IMAGE_COUNT:
        raise ValueError(f"最多上传 {MAX_IMAGE_COUNT} 张图片")

    encoded: List[str] = []
    for idx, (raw_bytes, mime_type) in enumerate(images):
        if not any(mime_type.startswith(p) for p in ALLOWED_IMAGE_MIME_PREFIXES):
            raise ValueError(f"第 {idx + 1} 张图片类型不支持: {mime_type}")
        if len(raw_bytes) > MAX_IMAGE_BYTES:
            raise ValueError(f"第 {idx + 1} 张图片超过 2MB 限制")
        b64 = base64.b64encode(raw_bytes).decode("ascii")
        encoded.append(f"data:{mime_type};base64,{b64}")
    return encoded


def build_feedback_view(feedback: Feedback) -> FeedbackView:
    return FeedbackView(
        id=str(feedback.id),
        user_id=feedback.user_id,
        category=feedback.category,
        content=feedback.content,
        contact=feedback.contact,
        context_json=feedback.context_json or {},
        image_count=len(feedback.image_base64_list or []),
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
        image_base64_list=list(feedback.image_base64_list or []),
        created_at=feedback.created_at,
    )


async def create_feedback(
    session: AsyncSession,
    user_id: str,
    payload: FeedbackCreate,
    images: Optional[List[tuple[bytes, str]]] = None,
) -> Feedback:
    """
    创建反馈记录。

    参数:
        session: 数据库会话
        user_id: 当前用户 ID
        payload: 反馈表单数据
        images: 可选，[(raw_bytes, mime_type), ...] 格式的图片列表
    """
    content = _normalize_text(payload.content) or ""
    _ensure_valid_content(content)
    category = _normalize_category(payload.category)
    contact = _normalize_text(payload.contact)
    context_json = _normalize_context(payload.context_json)
    image_base64_list = _validate_and_encode_images(images) if images else []

    feedback = Feedback(
        user_id=user_id,
        category=category,
        content=content,
        contact=contact,
        context_json=context_json,
        image_base64_list=image_base64_list,
        created_at=utc_now(),
    )
    session.add(feedback)
    await session.commit()
    await session.refresh(feedback)
    return feedback
