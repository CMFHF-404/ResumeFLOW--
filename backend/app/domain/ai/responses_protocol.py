"""Pure encoding and decoding for Qwen/OpenAI Responses payloads."""

import json
from typing import Any, Callable, Dict, List, Optional

from .public_errors import AiProviderPayloadError


class _ResponsesCompatibilityError(AiProviderPayloadError):
    """The configured endpoint does not expose a compatible Responses stream."""

    pass


def _convert_user_part_to_qwen_responses_content(
    part: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if "text" in part and isinstance(part.get("text"), str):
        return {"type": "input_text", "text": part["text"]}
    if part.get("type") == "input_text" and isinstance(part.get("text"), str):
        return {"type": "input_text", "text": part["text"]}

    image_url = part.get("image_url")
    if part.get("type") == "input_image" and isinstance(image_url, str):
        response_part: Dict[str, Any] = {
            "type": "input_image",
            "image_url": image_url,
        }
        detail = part.get("detail")
        if isinstance(detail, str) and detail.strip():
            response_part["detail"] = detail
        return response_part
    if part.get("type") == "image_url" and isinstance(image_url, dict):
        url = image_url.get("url")
        if isinstance(url, str) and url.strip():
            response_part = {
                "type": "input_image",
                "image_url": url,
            }
            detail = image_url.get("detail")
            if isinstance(detail, str) and detail.strip():
                response_part["detail"] = detail
            return response_part

    inline_data = part.get("inlineData")
    if isinstance(inline_data, dict):
        mime_type = str(inline_data.get("mimeType") or "").strip()
        data = str(inline_data.get("data") or "").strip()
        if mime_type and data:
            return {
                "type": "input_image",
                "image_url": f"data:{mime_type};base64,{data}",
            }
    return None


def _build_qwen_responses_input_messages(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    convert_content: Callable[
        [Dict[str, Any]], Optional[Dict[str, Any]]
    ] = _convert_user_part_to_qwen_responses_content,
) -> List[Dict[str, Any]]:
    content_parts = [
        converted
        for converted in (
            convert_content(part) for part in user_parts
        )
        if converted is not None
    ]
    if not content_parts:
        content: Any = ""
    elif len(content_parts) == 1 and content_parts[0]["type"] == "input_text":
        content = content_parts[0]["text"]
    else:
        content = content_parts
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content},
    ]


def _extract_qwen_responses_message_text(item: Dict[str, Any]) -> str:
    content = item.get("content")
    if not isinstance(content, list):
        return ""
    text_parts = [
        part.get("text")
        for part in content
        if isinstance(part, dict)
        and part.get("type") in {"output_text", "text"}
        and isinstance(part.get("text"), str)
    ]
    return "".join(text_parts)


def _extract_qwen_responses_output_text(
    response_payload: Dict[str, Any],
    *,
    extract_message_text: Callable[
        [Dict[str, Any]], str
    ] = _extract_qwen_responses_message_text,
) -> str:
    output = response_payload.get("output")
    if not isinstance(output, list):
        return ""
    text_parts = [
        extract_message_text(item)
        for item in output
        if isinstance(item, dict) and item.get("type") == "message"
    ]
    return "".join(part for part in text_parts if part)


_RESPONSES_STATUS_VALUES = {
    "completed",
    "failed",
    "in_progress",
    "cancelled",
    "queued",
    "incomplete",
}


def _parse_non_sse_responses_payload(body: bytes) -> Dict[str, Any]:
    """Parse a relay's non-streaming representation of a Responses result."""
    try:
        decoded = body.decode("utf-8")
        payload = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _ResponsesCompatibilityError(
            "Responses endpoint returned malformed non-streaming JSON."
        ) from exc

    if not isinstance(payload, dict) or payload.get("object") != "response":
        raise _ResponsesCompatibilityError(
            "Responses endpoint returned an incompatible non-streaming payload."
        )
    status = payload.get("status")
    if (
        not isinstance(status, str)
        or status not in _RESPONSES_STATUS_VALUES
        or not isinstance(payload.get("output"), list)
    ):
        raise _ResponsesCompatibilityError(
            "Responses endpoint returned an invalid Response object."
        )
    usage = payload.get("usage")
    if usage is not None and not isinstance(usage, dict):
        raise _ResponsesCompatibilityError(
            "Responses endpoint returned an invalid usage payload."
        )
    return payload


def _iter_qwen_responses_summary_texts(item: Dict[str, Any]):
    summary_items = item.get("summary")
    if not isinstance(summary_items, list):
        return
    for summary_item in summary_items:
        if not isinstance(summary_item, dict):
            continue
        text = summary_item.get("text")
        if isinstance(text, str) and text.strip():
            yield text
