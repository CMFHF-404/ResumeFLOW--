from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from ...config import load_settings

DEFAULT_TIMEOUT_SECONDS = 10
FEISHU_APP_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
FEISHU_UPLOAD_IMAGE_URL = "https://open.feishu.cn/open-apis/im/v1/images"
CATEGORY_LABELS = {
    "bug": "问题/BUG",
    "suggestion": "建议",
    "other": "其他",
}
CONTACT_TYPE_LABELS = {
    "email": "邮箱",
    "wechat": "微信",
    "phone": "电话",
    "qq": "QQ",
}


@dataclass(frozen=True)
class FeedbackNotification:
    feedback_id: str
    user_id: str
    category: str
    content: str
    contact_type: Optional[str]
    contact: Optional[str]
    context: Dict[str, Any]
    image_base64_list: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# 文本格式化工具
# ---------------------------------------------------------------------------

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


def _truncate_text(value: str, limit: int = 300) -> str:
    normalized = (value or "").strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit]}..."


def _format_contact(contact_type: Optional[str], contact: Optional[str]) -> str:
    normalized_contact = _normalize_text(contact)
    if not normalized_contact:
        return "未提供"
    normalized_contact_type = _normalize_text(contact_type).lower() if contact_type else ""
    contact_type_label = CONTACT_TYPE_LABELS.get(normalized_contact_type, "")
    if contact_type_label:
        return f"{contact_type_label}: {normalized_contact}"
    return normalized_contact


def _extract_feishu_error(payload: Dict[str, Any]) -> Optional[str]:
    """
    提取飞书返回中的业务错误。
    飞书开放平台接口通常使用 code/msg，自定义机器人 webhook 常见 StatusCode/StatusMessage。
    """
    if "code" in payload and payload.get("code") not in (None, 0):
        return f"code={payload.get('code')}, msg={payload.get('msg')}"
    if "StatusCode" in payload and payload.get("StatusCode") not in (None, 0):
        return f"StatusCode={payload.get('StatusCode')}, StatusMessage={payload.get('StatusMessage')}"
    return None


# ---------------------------------------------------------------------------
# 飞书 App Token 获取
# ---------------------------------------------------------------------------

async def _get_feishu_app_token(client: httpx.AsyncClient, app_id: str, app_secret: str) -> Optional[str]:
    """
    获取飞书租户级 App Token，用于调用需要应用身份的接口（如图片上传）。
    失败时返回 None，不影响主流程。
    """
    try:
        response = await client.post(
            FEISHU_APP_TOKEN_URL,
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        error = _extract_feishu_error(data)
        if error:
            print(f"[Feedback] Failed to get Feishu app token: {error}")
            return None

        token = data.get("tenant_access_token")
        if not token:
            print(
                "[Feedback] Failed to get Feishu app token: missing tenant_access_token, "
                f"response={_truncate_text(response.text)}"
            )
            return None
        return token
    except Exception as exc:
        print(f"[Feedback] Failed to get Feishu app token: {type(exc).__name__}: {exc!r}")
        return None


# ---------------------------------------------------------------------------
# 飞书图片上传
# ---------------------------------------------------------------------------

def _decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    """
    将 data URI （data:<mime>;base64,<b64>）解码为 (raw_bytes, mime_type)。
    """
    if not data_uri.startswith("data:") or "," not in data_uri:
        raise ValueError("invalid data URI")

    header, encoded = data_uri.split(",", 1)
    mime_type = header.split(";")[0].replace("data:", "").strip()
    if not mime_type.startswith("image/"):
        raise ValueError(f"unsupported mime type: {mime_type or 'unknown'}")
    return base64.b64decode(encoded, validate=True), mime_type


async def _upload_image_to_feishu(
    client: httpx.AsyncClient,
    app_token: str,
    data_uri: str,
) -> Optional[str]:
    """
    将单张图片上传到飞书，返回飞书的 image_key。
    上传失败时返回 None，跳过该图片。
    """
    try:
        raw_bytes, mime_type = _decode_data_uri(data_uri)
        ext = mime_type.split("/")[-1]
        files = {"image": (f"attachment.{ext}", raw_bytes, mime_type)}
        data = {"image_type": "message"}
        headers = {"Authorization": f"Bearer {app_token}"}
        response = await client.post(
            FEISHU_UPLOAD_IMAGE_URL,
            headers=headers,
            data=data,
            files=files,
            timeout=DEFAULT_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        result = response.json()
        error = _extract_feishu_error(result)
        if error:
            print(
                "[Feedback] Failed to upload image to Feishu: "
                f"{error}, mime={mime_type}, bytes={len(raw_bytes)}"
            )
            return None

        image_key = result.get("data", {}).get("image_key")
        if not image_key:
            print(
                "[Feedback] Failed to upload image to Feishu: missing image_key, "
                f"mime={mime_type}, bytes={len(raw_bytes)}, response={_truncate_text(response.text)}"
            )
            return None
        return image_key
    except Exception as exc:
        print(
            "[Feedback] Failed to upload image to Feishu: "
            f"{type(exc).__name__}: {exc!r}"
        )
        return None


async def _collect_image_keys(
    client: httpx.AsyncClient,
    app_token: str,
    image_base64_list: List[str],
) -> List[str]:
    """上传所有图片，收集成功的 image_key 列表，失败的跳过。"""
    keys: List[str] = []
    for data_uri in image_base64_list:
        key = await _upload_image_to_feishu(client, app_token, data_uri)
        if key:
            keys.append(key)
    return keys


# ---------------------------------------------------------------------------
# 飞书消息构建
# ---------------------------------------------------------------------------

def _build_rich_post_payload(
    notification: FeedbackNotification,
    image_keys: List[str],
) -> Dict[str, Any]:
    """
    构建飞书富文本（post 类型）消息，支持图片内联展示。
    消息结构：标题 + 文字段落 + 图片行（每张一行）。
    """
    contact = _format_contact(notification.contact_type, notification.contact)
    context_text = _format_context(notification.context)
    category_label = CATEGORY_LABELS.get(notification.category, notification.category)

    # 文字段落
    info_rows: List[List[Dict[str, Any]]] = [
        [{"tag": "text", "text": f"ID: {notification.feedback_id}"}],
        [{"tag": "text", "text": f"时间: {notification.created_at.isoformat()}"}],
        [{"tag": "text", "text": f"用户: {notification.user_id}"}],
        [{"tag": "text", "text": f"类型: {category_label}"}],
        [{"tag": "text", "text": f"联系方式: {contact}"}],
        [{"tag": "text", "text": "内容:"}],
        [{"tag": "text", "text": notification.content}],
    ]

    if context_text:
        info_rows.append([{"tag": "text", "text": f"上下文:\n{context_text}"}])

    # 图片行（每张图片占一行）
    image_rows: List[List[Dict[str, Any]]] = [
        [{"tag": "img", "image_key": key}] for key in image_keys
    ]

    return {
        "msg_type": "post",
        "content": {
            "post": {
                "zh_cn": {
                    "title": "ResumeFlow 新反馈",
                    "content": info_rows + image_rows,
                }
            }
        },
    }


def _build_text_payload(
    notification: FeedbackNotification,
    image_count_hint: int = 0,
) -> Dict[str, Any]:
    """构建纯文字消息（无图，或图片上传失败时的降级方案）。"""
    contact = _format_contact(notification.contact_type, notification.contact)
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
    if image_count_hint > 0:
        lines.append(f"[附图 {image_count_hint} 张，请至后台查看]")

    return {"msg_type": "text", "content": {"text": "\n".join(lines)}}


# ---------------------------------------------------------------------------
# 对外接口
# ---------------------------------------------------------------------------

async def send_feishu_feedback(notification: FeedbackNotification) -> None:
    """
    发送飞书反馈通知。

    策略：
    1. 若配置了 App 凭证且通知含图片 → 上传图片 → 发送富文本卡片
    2. 否则降级为纯文字消息（附图数量提示）
    """
    settings = load_settings()
    webhook_url = settings.feishu_webhook_url
    if not webhook_url:
        return

    image_count = len(notification.image_base64_list)
    has_app_credentials = bool(settings.feishu_app_id and settings.feishu_app_secret)
    should_upload_images = image_count > 0 and has_app_credentials

    async with httpx.AsyncClient() as client:
        if should_upload_images:
            payload = await _build_rich_payload_with_images(
                client, settings, notification
            )
        else:
            payload = _build_text_payload(notification, image_count_hint=image_count)

        await _post_to_feishu_webhook(client, webhook_url, payload)


async def _build_rich_payload_with_images(
    client: httpx.AsyncClient,
    settings: Any,
    notification: FeedbackNotification,
) -> Dict[str, Any]:
    """
    上传图片并构建富文本消息。
    若 token 获取失败或所有图片上传失败，降级为文字消息。
    """
    app_token = await _get_feishu_app_token(
        client, settings.feishu_app_id, settings.feishu_app_secret
    )
    if not app_token:
        return _build_text_payload(
            notification, image_count_hint=len(notification.image_base64_list)
        )

    image_keys = await _collect_image_keys(
        client, app_token, notification.image_base64_list
    )

    if not image_keys:
        return _build_text_payload(
            notification, image_count_hint=len(notification.image_base64_list)
        )

    return _build_rich_post_payload(notification, image_keys)


async def _post_to_feishu_webhook(
    client: httpx.AsyncClient,
    webhook_url: str,
    payload: Dict[str, Any],
) -> None:
    """向飞书 Webhook 发送最终消息，失败时仅打印日志，不抛出异常。"""
    try:
        response = await client.post(
            webhook_url, json=payload, timeout=DEFAULT_TIMEOUT_SECONDS
        )
        response.raise_for_status()
        if response.headers.get("content-type", "").startswith("application/json"):
            result = response.json()
            error = _extract_feishu_error(result)
            if error:
                print(f"[Feedback] Feishu webhook rejected payload: {error}")
    except Exception as exc:  # pragma: no cover - network/runtime error
        print(f"[Feedback] Feishu notify failed: {type(exc).__name__}: {exc!r}")
