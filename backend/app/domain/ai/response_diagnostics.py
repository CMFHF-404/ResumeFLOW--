from __future__ import annotations

import hashlib
from typing import Any


def body_log_metadata(body: bytes | str) -> tuple[int, str]:
    encoded = body.encode("utf-8", errors="replace") if isinstance(body, str) else body
    return len(encoded), hashlib.sha256(encoded).hexdigest()[:16]


def safe_body_log_summary(body: bytes | str) -> str:
    body_bytes, body_sha256 = body_log_metadata(body)
    return f"bytes={body_bytes} sha256={body_sha256}"


def response_body_log_metadata(
    response: Any,
    body: bytes | None = None,
) -> tuple[str, int | str, str]:
    headers = getattr(response, "headers", {}) or {}
    content_type = str(headers.get("content-type") or "").lower()
    resolved_body = body
    if resolved_body is None:
        try:
            candidate = response.content
        except Exception:
            candidate = None
        if isinstance(candidate, bytes):
            resolved_body = candidate

    if resolved_body is not None:
        body_bytes, body_sha256 = body_log_metadata(resolved_body)
        return (
            content_type,
            body_bytes,
            body_sha256,
        )

    declared_length = headers.get("content-length")
    return content_type, str(declared_length or "unread"), "unavailable"
