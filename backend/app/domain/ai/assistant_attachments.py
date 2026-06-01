import hashlib
import json
from typing import Any, Dict, List, Optional

from .assistant_context import (
    _normalize_selected_experiences,
    _normalize_selected_resume,
)

MAX_ASSISTANT_REUSED_ATTACHMENTS = 3

def _build_assistant_attachment_context(
    attachment: Dict[str, Any],
    *,
    include_attachment_content: bool,
) -> Dict[str, Any]:
    context: Dict[str, Any] = {}
    base_fields = (
        ("name", "name"),
        ("kind", "kind"),
        ("contentType", "contentType"),
        ("textExcerpt", "textExcerpt"),
    )
    content_fields = (
        ("text", "text"),
    )
    for source_key, target_key in (*base_fields, *(content_fields if include_attachment_content else ())):
        value = attachment.get(source_key)
        if isinstance(value, str) and value.strip():
            context[target_key] = value.strip()
    return context


def _read_attachment_image_payload(attachment: Dict[str, Any]) -> str:
    image_b64 = attachment.get("imageB64")
    if isinstance(image_b64, str) and image_b64.strip():
        return image_b64.strip()
    return ""


def _normalize_assistant_history(
    history: List[Dict[str, Any]],
    *,
    include_attachment_content: bool,
) -> List[Dict[str, Any]]:
    normalized_history: List[Dict[str, Any]] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        normalized_message = {**message}
        content_json = message.get("content_json")
        if isinstance(content_json, dict):
            normalized_content_json = {**content_json}
            attachment_signatures: set[tuple[str, str, str, str]] = set()
            raw_attachments = content_json.get("attachments")
            if isinstance(raw_attachments, list):
                attachment_contexts = [
                    _build_assistant_attachment_context(
                        attachment,
                        include_attachment_content=include_attachment_content,
                    )
                    for attachment in raw_attachments
                    if isinstance(attachment, dict)
                ]
                attachment_signatures = {
                    _attachment_signature(attachment)
                    for attachment in raw_attachments
                    if isinstance(attachment, dict)
                }
                if attachment_contexts:
                    normalized_content_json["attachments"] = attachment_contexts
                elif "attachments" in normalized_content_json:
                    normalized_content_json.pop("attachments", None)
            attachment = content_json.get("attachment")
            if isinstance(attachment, dict) and _attachment_signature(attachment) not in attachment_signatures:
                normalized_content_json["attachment"] = _build_assistant_attachment_context(
                    attachment,
                    include_attachment_content=include_attachment_content,
                )
            elif "attachment" in normalized_content_json and attachment_signatures:
                normalized_content_json.pop("attachment", None)
            selected_experiences = _normalize_selected_experiences(
                content_json.get("selected_experiences")
            )
            if selected_experiences:
                normalized_content_json["selected_experiences"] = selected_experiences
            elif "selected_experiences" in normalized_content_json:
                normalized_content_json.pop("selected_experiences", None)
            selected_resume = _normalize_selected_resume(
                content_json.get("selected_resume")
            )
            if selected_resume:
                normalized_content_json["selected_resume"] = selected_resume
            elif "selected_resume" in normalized_content_json:
                normalized_content_json.pop("selected_resume", None)
            normalized_message["content_json"] = normalized_content_json
        normalized_history.append(normalized_message)
    return normalized_history


def _message_explicitly_references_attachment(
    user_message: str,
    attachment: Dict[str, Any],
) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    attachment_name = str(attachment.get("name") or "").strip().lower()
    return bool(attachment_name and attachment_name in normalized_message)


def _message_references_attachment_generically(user_message: str, attachment: Dict[str, Any]) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    kind = str(attachment.get("kind") or "").strip().lower()
    if kind == "image":
        attachment_terms = ("附件", "图片", "图", "截图", "照片", "海报", "image", "photo", "screenshot")
    else:
        attachment_terms = ("附件", "文档", "文件", "pdf", "doc", "docx", "简历", "材料", "document", "file")
    return any(term in normalized_message for term in attachment_terms)


def _message_is_attachment_follow_up(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    new_content_terms = (
        "下面这段",
        "下面这句话",
        "以下这段",
        "以下内容",
        "如下内容",
        "这段文案",
        "这段文字",
        "这句话",
        "这一段",
        "下一段",
        "我刚写的",
        "刚写的这段",
        "贴给你一段",
        "贴一下这段",
        "发给你一段",
    )
    if any(term in normalized_message for term in new_content_terms):
        return False

    inline_text_reference_terms = (
        "这段",
        "这句话",
        "这一句",
        "下面",
        "以下",
        "如下",
        "刚写",
        "我写的",
        "贴的",
        "粘贴",
    )
    if any(term in normalized_message for term in inline_text_reference_terms):
        return False

    explicit_attachment_terms = (
        "这个附件",
        "这个文档",
        "这个文件",
        "这个图片",
        "这张图",
        "这份附件",
        "这份文档",
        "这份文件",
    )
    if any(term in normalized_message for term in explicit_attachment_terms):
        return True

    continuation_markers = (
        "继续",
        "接着",
        "基于",
        "根据",
        "结合",
        "围绕",
        "针对",
        "在这个基础上",
        "在此基础上",
        "顺着这个",
        "沿着这个",
        "保持这个",
        "用这个",
        "按这个",
        "照这个",
        "基于刚才",
        "基于上面",
    )
    transformation_terms = (
        "换成",
        "改成",
        "改写",
        "重写",
        "润色",
        "优化",
        "细化",
        "展开",
        "扩写",
        "缩写",
        "压缩",
        "精简",
        "提炼",
        "总结",
        "归纳",
        "翻译",
        "改为英文",
        "英文版",
        "中文版",
        "star",
        "bullet",
        "translate",
        "summarize",
        "summarise",
        "summary",
        "polish",
        "rewrite",
        "optimize",
        "optimise",
        "refine",
        "expand",
        "shorten",
        "compress",
        "condense",
        "extract",
        "convert",
        "english version",
        "chinese version",
        "to english",
        "to chinese",
    )
    has_transformation = any(term in normalized_message for term in transformation_terms)
    has_continuation_marker = any(term in normalized_message for term in continuation_markers)
    if has_transformation and (
        has_continuation_marker
        or any(
            term in normalized_message
            for term in ("这个", "这份", "这张", "上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
        )
    ):
        return True
    return has_continuation_marker and any(
        term in normalized_message
        for term in ("这个", "这份", "这张", "上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
    )


def _message_is_short_transformation_command(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    if any(
        term in normalized_message
        for term in (
            "这段",
            "这句话",
            "这一句",
            "下面",
            "以下",
            "如下",
            "刚写",
            "我写的",
            "贴的",
            "粘贴",
            "这个附件",
            "这个文档",
            "这个文件",
            "这个图片",
            "这张图",
            "这份附件",
            "这份文档",
            "这份文件",
            "继续",
            "接着",
            "基于",
            "根据",
            "结合",
            "围绕",
            "针对",
        )
    ):
        return False

    return len(normalized_message) <= 40 and any(
        term in normalized_message
        for term in (
            "换成",
            "改成",
            "改写",
            "重写",
            "润色",
            "优化",
            "细化",
            "展开",
            "扩写",
            "缩写",
            "压缩",
            "精简",
            "提炼",
            "总结",
            "归纳",
            "翻译",
            "改为英文",
            "英文版",
            "中文版",
            "star",
            "bullet",
            "translate",
            "summarize",
            "summarise",
            "summary",
            "polish",
            "rewrite",
            "optimize",
            "optimise",
            "refine",
            "expand",
            "shorten",
            "compress",
            "condense",
            "extract",
            "convert",
            "english version",
            "chinese version",
            "to english",
            "to chinese",
        )
    )


def _message_requests_multi_attachment_context(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    comparison_terms = (
        "比较",
        "对比",
        "区别",
        "差异",
        "异同",
        "不同",
        "相同",
    )
    grouping_terms = (
        "另一份",
        "另一张",
        "另一个附件",
        "另一个文档",
        "另一个文件",
        "另一个图片",
        "这份和另一份",
        "这一份和另一份",
        "这张和另一张",
        "这一张和另一张",
        "结合前两",
        "结合这两",
        "前两份",
        "前两个",
        "前两张",
        "两份",
        "两张",
        "两个",
        "多个",
        "几份",
        "几张",
    )
    return any(term in normalized_message for term in comparison_terms) or any(
        term in normalized_message for term in grouping_terms
    )


def _message_uses_relative_attachment_reference(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    relative_reference_terms = (
        "另一份",
        "另一张",
        "另一个附件",
        "另一个文档",
        "另一个文件",
        "另一个图片",
        "这份和另一份",
        "这一份和另一份",
        "这张和另一张",
        "这一张和另一张",
        "这两份",
        "这两张",
        "这两个",
        "前两份",
        "前两张",
        "前两个",
        "结合前两",
        "结合这两",
        "上一份",
        "前一份",
        "上一张",
        "前一张",
        "上一个",
        "前一个",
    )
    return any(term in normalized_message for term in relative_reference_terms)


def _infer_requested_attachment_count(user_message: str) -> int:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return MAX_ASSISTANT_REUSED_ATTACHMENTS

    count_terms = (
        (
            2,
            (
                "两份",
                "两张",
                "两个",
                "前两份",
                "前两张",
                "前两个",
                "这两份",
                "这两张",
                "这两个",
                "这份和另一份",
                "这一份和另一份",
                "这张和另一张",
                "这一张和另一张",
            ),
        ),
        (3, ("三份", "三张", "三个", "前三份", "前三张", "前三个", "这三份", "这三张", "这三个")),
    )
    for count, terms in count_terms:
        if any(term in normalized_message for term in terms):
            return count
    return MAX_ASSISTANT_REUSED_ATTACHMENTS


def _resolve_relative_attachment_reference(
    history_attachments: List[Dict[str, Any]],
    user_message: str,
) -> List[Dict[str, Any]]:
    if not history_attachments:
        return []

    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return []

    previous_reference_terms = ("上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
    if any(term in normalized_message for term in previous_reference_terms):
        if len(history_attachments) >= 2:
            return [history_attachments[-2]]
        return [history_attachments[-1]]

    return []


def _attachment_signature(attachment: Dict[str, Any]) -> tuple[str, str, str, str]:
    content_fingerprint = ""
    if isinstance(attachment.get("text"), str) and attachment.get("text", "").strip():
        content_fingerprint = hashlib.sha1(attachment["text"].encode("utf-8")).hexdigest()
    else:
        image_blob_id = attachment.get("imageBlobId")
        if isinstance(image_blob_id, str) and image_blob_id.strip():
            content_fingerprint = f"imageBlobId:{image_blob_id.strip()}"
        elif image_payload := _read_attachment_image_payload(attachment):
            content_fingerprint = hashlib.sha1(image_payload.encode("ascii")).hexdigest()
    if not content_fingerprint and isinstance(attachment.get("textExcerpt"), str) and attachment.get("textExcerpt", "").strip():
        content_fingerprint = hashlib.sha1(attachment["textExcerpt"].encode("utf-8")).hexdigest()
    return (
        str(attachment.get("name") or "").strip(),
        str(attachment.get("kind") or "").strip(),
        str(attachment.get("contentType") or "").strip(),
        content_fingerprint,
    )


def _collect_history_attachments(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    for message in history:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content_json = message.get("content_json")
        if not isinstance(content_json, dict):
            continue
        raw_attachments = content_json.get("attachments")
        message_signatures: set[tuple[str, str, str, str]] = set()
        if isinstance(raw_attachments, list):
            for attachment in raw_attachments:
                if not isinstance(attachment, dict):
                    continue
                attachments.append(attachment)
                message_signatures.add(_attachment_signature(attachment))
        attachment = content_json.get("attachment")
        if isinstance(attachment, dict) and _attachment_signature(attachment) not in message_signatures:
            attachments.append(attachment)
    return attachments


def _collect_message_attachments(content_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    raw_attachments = content_json.get("attachments")
    if isinstance(raw_attachments, list):
        attachments.extend(
            attachment
            for attachment in raw_attachments
            if isinstance(attachment, dict)
        )
    attachment = content_json.get("attachment")
    if isinstance(attachment, dict):
        attachments.append(attachment)
    return _unique_attachments(attachments)


def _unique_attachments(attachments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for attachment in attachments:
        signature = _attachment_signature(attachment)
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(attachment)
    return unique


def _complete_multi_attachment_selection(
    history_attachments: List[Dict[str, Any]],
    selected_attachments: List[Dict[str, Any]],
    requested_attachment_count: int,
    user_message: str,
) -> List[Dict[str, Any]]:
    selected_unique = _unique_attachments(selected_attachments)
    if len(selected_unique) >= requested_attachment_count:
        return selected_unique[-requested_attachment_count:]

    normalized_message = user_message.strip().lower()
    target_signatures = {_attachment_signature(attachment) for attachment in selected_unique}
    previous_reference_terms = ("上一份", "前一份", "上一张", "前一张", "上一个", "前一个")

    if selected_unique and any(term in normalized_message for term in previous_reference_terms):
        anchor_signature = _attachment_signature(selected_unique[-1])
        anchor_index = next(
            (
                index
                for index in range(len(history_attachments) - 1, -1, -1)
                if _attachment_signature(history_attachments[index]) == anchor_signature
            ),
            -1,
        )
        for index in range(anchor_index - 1, -1, -1):
            signature = _attachment_signature(history_attachments[index])
            if signature in target_signatures:
                continue
            target_signatures.add(signature)
            if len(target_signatures) >= requested_attachment_count:
                break

    if len(target_signatures) < requested_attachment_count:
        for attachment in reversed(history_attachments):
            signature = _attachment_signature(attachment)
            if signature in target_signatures:
                continue
            target_signatures.add(signature)
            if len(target_signatures) >= requested_attachment_count:
                break

    completed: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for attachment in history_attachments:
        signature = _attachment_signature(attachment)
        if signature not in target_signatures or signature in seen:
            continue
        completed.append(attachment)
        seen.add(signature)
    return completed[-requested_attachment_count:]


def _resolve_relevant_attachments(
    history: List[Dict[str, Any]],
    current_attachments: Optional[List[Dict[str, Any]]] = None,
    user_message: str = "",
) -> List[Dict[str, Any]]:
    history_attachments = _collect_history_attachments(history)
    normalized_current_attachments = _unique_attachments(
        [attachment for attachment in (current_attachments or []) if isinstance(attachment, dict)]
    )
    requested_attachment_count = min(
        _infer_requested_attachment_count(user_message),
        MAX_ASSISTANT_REUSED_ATTACHMENTS,
    )
    if normalized_current_attachments:
        if _message_requests_multi_attachment_context(user_message):
            companion_count = max(requested_attachment_count - len(normalized_current_attachments), 0)
            explicit_history_matches = [
                attachment
                for attachment in history_attachments
                if _message_explicitly_references_attachment(user_message, attachment)
            ]
            if companion_count <= 0 or len(normalized_current_attachments) >= requested_attachment_count:
                return normalized_current_attachments[-requested_attachment_count:]
            if explicit_history_matches:
                selected_history = _complete_multi_attachment_selection(
                    history_attachments,
                    explicit_history_matches,
                    companion_count,
                    user_message,
                )
                return _unique_attachments([*selected_history, *normalized_current_attachments])[-requested_attachment_count:]
            recent_history = history_attachments[-companion_count:]
            return _unique_attachments([*recent_history, *normalized_current_attachments])[-requested_attachment_count:]
        return normalized_current_attachments

    if not history_attachments:
        return []

    explicit_matches = [
        attachment
        for attachment in history_attachments
        if _message_explicitly_references_attachment(user_message, attachment)
    ]
    if explicit_matches:
        if _message_requests_multi_attachment_context(user_message):
            return _complete_multi_attachment_selection(
                history_attachments,
                explicit_matches,
                requested_attachment_count,
                user_message,
            )
        return [explicit_matches[-1]]

    if _message_requests_multi_attachment_context(user_message):
        if _message_uses_relative_attachment_reference(user_message):
            return history_attachments[-requested_attachment_count:]
        if _message_is_attachment_follow_up(user_message) or any(
            _message_references_attachment_generically(user_message, attachment)
            for attachment in history_attachments[-requested_attachment_count:]
        ):
            return history_attachments[-requested_attachment_count:]
        return []

    relative_attachment = _resolve_relative_attachment_reference(history_attachments, user_message)
    if relative_attachment:
        return relative_attachment

    latest_attachment = history_attachments[-1]
    latest_user_attachments = next(
        (
            _collect_message_attachments(content_json)
            for message in reversed(history)
            if isinstance(message, dict)
            and message.get("role") == "user"
            and isinstance((content_json := message.get("content_json")), dict)
        ),
        [],
    )
    latest_user_attachment_signatures = {
        _attachment_signature(attachment)
        for attachment in latest_user_attachments
    }
    if _attachment_signature(latest_attachment) in latest_user_attachment_signatures:
        if _message_is_short_transformation_command(user_message):
            return [latest_attachment]

    if _message_references_attachment_generically(user_message, latest_attachment) or _message_is_attachment_follow_up(user_message):
        return [latest_attachment]
    return []


def _build_assistant_user_message(
    payload: Dict[str, Any],
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    payload_text = json.dumps(payload, ensure_ascii=False)
    image_parts = []
    for attachment in attachments or []:
        attachment_mime = attachment.get("mimeType")
        attachment_image = _read_attachment_image_payload(attachment)
        if not isinstance(attachment_mime, str):
            continue
        if not attachment_mime.strip() or not attachment_image:
            continue
        image_parts.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{attachment_mime};base64,{attachment_image}"
                },
            }
        )
    if image_parts:
        return {
            "role": "user",
            "content": [*image_parts, {"type": "text", "text": payload_text}],
        }
    return {"role": "user", "content": payload_text}


def _build_assistant_user_parts(
    payload: Dict[str, Any],
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    payload_text = json.dumps(payload, ensure_ascii=False)
    image_parts = []
    for attachment in attachments or []:
        attachment_mime = attachment.get("mimeType")
        attachment_image = _read_attachment_image_payload(attachment)
        if not isinstance(attachment_mime, str):
            continue
        if not attachment_mime.strip() or not attachment_image:
            continue
        image_parts.append(
            {
                "inlineData": {
                    "mimeType": attachment_mime,
                    "data": attachment_image,
                }
            },
        )
    if image_parts:
        return [*image_parts, {"text": payload_text}]
    return [{"text": payload_text}]


