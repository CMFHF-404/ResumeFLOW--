from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

import httpx

from ...config import load_settings

DEFAULT_TIMEOUT_SECONDS = 10
CATEGORY_LABELS = {
    "bug": "问题/BUG",
    "suggestion": "建议",
    "other": "其他",
}


@dataclass(frozen=True)
class FeedbackNotification:
    feedback_id: str
    user_id: str
    category: str
    content: str
    contact: Optional[str]
    context: Dict[str, Any]
    created_at: datetime


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.strip()


def _format_context(context: Dict[str, Any]) -> str:
    if not context:
        return ""
    segments = []
    for key in ("view", "path", "url", "userAgent"):
        raw_value = context.get(key)
        if raw_value:
            segments.append(f"{key}: {raw_value}")
    return "\n".join(segments)


def _build_text_payload(notification: FeedbackNotification) -> Dict[str, Any]:
    contact = _normalize_text(notification.contact) or "未提供"
    context_text = _format_context(notification.context)
    category_label = CATEGORY_LABELS.get(notification.category, notification.category)
    lines = [
        "ResumeFlow 新反馈",
        f"ID: {notification.feedback_id}",
        f"时间: {notification.created_at.isoformat()}",
        f"用户: {notification.user_id}",
        f"类型: {category_label}",
        f"联系方式: {contact}",
        "内容:",
        notification.content,
    ]
    if context_text:
        lines.append("上下文:")
        lines.append(context_text)
    return {"msg_type": "text", "content": {"text": "\n".join(lines)}}


async def send_feishu_feedback(notification: FeedbackNotification) -> None:
    settings = load_settings()
    webhook_url = settings.feishu_webhook_url
    if not webhook_url:
        return

    payload = _build_text_payload(notification)
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, json=payload)
            response.raise_for_status()
    except Exception as exc:  # pragma: no cover - network/runtime error
        print(f"[Feedback] Feishu notify failed: {exc}")
