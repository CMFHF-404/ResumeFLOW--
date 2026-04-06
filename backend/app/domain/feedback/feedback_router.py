import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_201_CREATED, HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from .feedback_notifier import send_feishu_feedback
from .feedback_service import (
    MAX_IMAGE_COUNT,
    MAX_IMAGE_BYTES,
    build_feedback_notification,
    build_feedback_view,
    create_feedback,
)
from .schemas import FeedbackCreate, FeedbackRead

router = APIRouter(prefix="/feedback", tags=["feedback"])

# 接口改为接收 multipart/form-data，支持可选图片文件上传


@router.post("", response_model=FeedbackRead, status_code=HTTP_201_CREATED)
async def submit_feedback(
    background_tasks: BackgroundTasks,
    category: str = Form(...),
    content: str = Form(...),
    contact_type: Optional[str] = Form(default=None),
    contact: Optional[str] = Form(default=None),
    context_json: Optional[str] = Form(default=None),
    images: List[UploadFile] = File(default=[]),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    """
    提交反馈，支持可选图片附件（最多 3 张，每张 ≤ 2MB）。
    使用 multipart/form-data 格式，images 字段为文件列表。
    """
    parsed_context = _parse_context_json(context_json)
    payload = FeedbackCreate(
        category=category,
        content=content,
        contact_type=contact_type or None,
        contact=contact or None,
        context_json=parsed_context,
    )

    image_data = await _read_and_validate_images(images)

    try:
        feedback = await create_feedback(session, current_user.id, payload, image_data)
    except ValueError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    notification = build_feedback_notification(feedback)
    background_tasks.add_task(send_feishu_feedback, notification)

    view = build_feedback_view(feedback)
    return FeedbackRead(
        id=view.id,
        user_id=view.user_id,
        category=view.category,
        content=view.content,
        contact_type=view.contact_type,
        contact=view.contact,
        context_json=view.context_json,
        image_count=view.image_count,
        created_at=view.created_at,
    )


def _parse_context_json(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """安全解析 context_json 字符串，仅接受对象结构，异常或非对象时返回 None。"""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def _read_and_validate_images(
    uploads: List[UploadFile],
) -> Optional[list]:
    """
    读取上传文件并做基础校验（数量、类型、大小）。
    校验失败时抛出 HTTPException。
    返回 [(raw_bytes, mime_type), ...] 或 None（无上传文件）。
    """
    # 过滤掉空的占位文件（某些客户端会上传空 UploadFile）
    valid_uploads = [f for f in uploads if f.filename]
    if not valid_uploads:
        return None

    if len(valid_uploads) > MAX_IMAGE_COUNT:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail=f"最多上传 {MAX_IMAGE_COUNT} 张图片",
        )

    result = []
    for idx, upload in enumerate(valid_uploads):
        content_type = upload.content_type or ""
        if not content_type.startswith("image/"):
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail=f"第 {idx + 1} 个文件类型不支持: {content_type}",
            )
        raw_bytes = await upload.read()
        if len(raw_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail=f"第 {idx + 1} 张图片超过 2MB 限制",
            )
        result.append((raw_bytes, content_type))
    return result
