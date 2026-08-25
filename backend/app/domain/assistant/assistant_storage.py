from __future__ import annotations

import base64
import binascii
import json
import math
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from sqlalchemy import Text, cast, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import AIAssistantImageBlob, AIAssistantMessage, AIAssistantSession


MAX_ASSISTANT_SESSION_TITLE_CHARS = 200
MAX_ASSISTANT_SESSION_CONTEXT_BYTES = 256 * 1024
MAX_ASSISTANT_MESSAGE_CONTENT_BYTES = 8 * 1024 * 1024
MAX_ASSISTANT_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_ASSISTANT_IMAGE_BLOB_BASE64_BYTES = (
    (MAX_ASSISTANT_ATTACHMENT_BYTES + 2) // 3
) * 4
MAX_ASSISTANT_IMAGE_MIME_TYPE_CHARS = 255
MAX_ASSISTANT_FILES_PER_TURN = 5

MAX_USER_ASSISTANT_SESSIONS = 200
MAX_USER_ASSISTANT_SESSION_JSON_BYTES = 16 * 1024 * 1024
MAX_USER_ASSISTANT_MESSAGES = 20_000
MAX_USER_ASSISTANT_MESSAGE_BYTES = 64 * 1024 * 1024
MAX_USER_ASSISTANT_IMAGE_BLOBS = 100
MAX_USER_ASSISTANT_IMAGE_BLOB_BYTES = 64 * 1024 * 1024
MAX_ASSISTANT_SESSION_MESSAGES = 1_000
MAX_ASSISTANT_SESSION_MESSAGE_BYTES = 8 * 1024 * 1024

MAX_JSON_DEPTH = 20
MAX_JSON_NODES = 20_000
ASSISTANT_STORAGE_CONSTRAINTS = {
    "ck_ai_assistant_sessions_title_length",
    "ck_ai_assistant_sessions_context_object",
    "ck_ai_assistant_sessions_context_size",
    "ck_ai_assistant_messages_content_object",
    "ck_ai_assistant_messages_content_size",
    "ck_ai_assistant_image_blobs_payload_size",
    "ck_ai_assistant_image_blobs_mime_length",
}


class AssistantStorageQuotaExceeded(HTTPException):
    def __init__(self, metric: str):
        self.metric = metric
        super().__init__(
            status_code=429,
            detail="AI 助理存储空间已达上限，请删除旧会话后重试。",
        )


def _integrity_constraint_name(exc: IntegrityError) -> str | None:
    candidates = [
        getattr(exc, "orig", None),
        getattr(getattr(exc, "orig", None), "__cause__", None),
    ]
    for candidate in candidates:
        direct = getattr(candidate, "constraint_name", None)
        if isinstance(direct, str):
            return direct
        diagnostic = getattr(candidate, "diag", None)
        name = getattr(diagnostic, "constraint_name", None)
        if isinstance(name, str):
            return name
    return None


async def commit_assistant_storage(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        constraint_name = _integrity_constraint_name(exc)
        rollback = getattr(session, "rollback", None)
        if callable(rollback):
            await rollback()
        if constraint_name in ASSISTANT_STORAGE_CONSTRAINTS:
            raise AssistantStorageQuotaExceeded(constraint_name or "database") from exc
        raise


def compact_json_utf8_size(value: Any) -> int:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (
        TypeError,
        ValueError,
        OverflowError,
        RecursionError,
        UnicodeEncodeError,
    ) as exc:
        raise ValueError("payload must contain only finite JSON values") from exc
    return len(encoded)


def storage_json_utf8_size(value: Any) -> int:
    """Return a conservative byte count for PostgreSQL ``jsonb::text``."""

    try:
        serialized = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(", ", ": "),
            sort_keys=True,
        )
    except (
        TypeError,
        ValueError,
        OverflowError,
        RecursionError,
        UnicodeEncodeError,
    ) as exc:
        raise ValueError("payload must contain only finite JSON values") from exc

    numeric_expansion = 0

    def visit(item: Any) -> None:
        nonlocal numeric_expansion
        if isinstance(item, float) and math.isfinite(item):
            rendered = json.dumps(item, allow_nan=False)
            try:
                expanded = format(Decimal(rendered), "f")
            except (InvalidOperation, ValueError):
                expanded = rendered
            numeric_expansion += max(0, len(expanded) - len(rendered))
            return
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        if isinstance(item, dict):
            for child in item.values():
                visit(child)

    visit(value)
    return len(serialized.encode("utf-8")) + numeric_expansion


def _validate_json_value(
    value: Any,
    *,
    field_name: str,
    depth: int,
    node_counter: list[int],
) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ValueError(f"{field_name} nesting is too deep")
    node_counter[0] += 1
    if node_counter[0] > MAX_JSON_NODES:
        raise ValueError(f"{field_name} contains too many values")

    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError(f"{field_name} contains a NUL character")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{field_name} contains a non-finite number")
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(
                item,
                field_name=field_name,
                depth=depth + 1,
                node_counter=node_counter,
            )
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{field_name} keys must be strings")
            if "\x00" in key:
                raise ValueError(f"{field_name} contains a NUL character")
            _validate_json_value(
                item,
                field_name=field_name,
                depth=depth + 1,
                node_counter=node_counter,
            )
        return
    raise ValueError(f"{field_name} contains a non-JSON value")


def validate_json_object(
    value: Any,
    *,
    field_name: str,
    max_bytes: int,
) -> dict[str, Any]:
    if type(value) is not dict:
        raise ValueError(f"{field_name} must be a JSON object")
    _validate_json_value(
        value,
        field_name=field_name,
        depth=0,
        node_counter=[0],
    )
    if compact_json_utf8_size(value) > max_bytes:
        raise ValueError(f"{field_name} exceeds its storage limit")
    if storage_json_utf8_size(value) > max_bytes:
        raise ValueError(f"{field_name} exceeds its storage limit")
    return value


def validate_session_context(value: Any) -> dict[str, Any]:
    return validate_json_object(
        value,
        field_name="context_json",
        max_bytes=MAX_ASSISTANT_SESSION_CONTEXT_BYTES,
    )


def validate_message_content(value: Any) -> dict[str, Any]:
    return validate_json_object(
        value,
        field_name="content_json",
        max_bytes=MAX_ASSISTANT_MESSAGE_CONTENT_BYTES,
    )


def fit_message_optional_text(
    content: dict[str, Any],
    *,
    field_name: str,
    truncated_flag: str,
) -> dict[str, Any]:
    """Fit an optional text field without truncating the primary message text."""

    value = content.get(field_name)
    if not isinstance(value, str):
        return validate_message_content(content)
    try:
        return validate_message_content(content)
    except ValueError:
        pass

    base = dict(content)
    base.pop(field_name, None)
    base[truncated_flag] = True
    validate_message_content(base)

    low = 0
    high = len(value)
    while low < high:
        midpoint = (low + high + 1) // 2
        candidate = dict(base)
        candidate[field_name] = value[:midpoint]
        try:
            validate_message_content(candidate)
        except ValueError:
            high = midpoint - 1
        else:
            low = midpoint

    fitted = dict(base)
    fitted[field_name] = value[:low]
    return validate_message_content(fitted)


def normalize_session_title(value: str, *, allow_blank: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError("title must be a string")
    normalized = value.strip()
    if not normalized and not allow_blank:
        raise ValueError("title must not be blank")
    if len(normalized) > MAX_ASSISTANT_SESSION_TITLE_CHARS:
        raise ValueError(
            f"title must contain at most {MAX_ASSISTANT_SESSION_TITLE_CHARS} characters"
        )
    return normalized


def normalize_image_blob_payload(image_b64: Any) -> tuple[str, int]:
    if not isinstance(image_b64, str):
        raise ValueError("image payload must be base64 text")
    cleaned = image_b64.strip()
    encoded_size = len(cleaned.encode("ascii", errors="strict"))
    if not cleaned:
        raise ValueError("image payload must not be empty")
    if encoded_size > MAX_ASSISTANT_IMAGE_BLOB_BASE64_BYTES:
        raise ValueError("image attachment exceeds its storage limit")
    try:
        decoded = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image payload is not valid base64") from exc
    if len(decoded) > MAX_ASSISTANT_ATTACHMENT_BYTES:
        raise ValueError("image attachment exceeds its storage limit")
    return cleaned, encoded_size


def normalize_image_mime_type(value: Any) -> tuple[str, int]:
    if not isinstance(value, str):
        raise ValueError("image MIME type must be text")
    normalized = value.strip()
    try:
        encoded = normalized.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError("image MIME type must be ASCII") from exc
    if len(normalized) > MAX_ASSISTANT_IMAGE_MIME_TYPE_CHARS:
        raise ValueError("image MIME type exceeds its storage limit")
    return normalized, len(encoded)


def _dialect_name(session: AsyncSession) -> str | None:
    try:
        bind = session.get_bind()
    except (AttributeError, RuntimeError):
        bind = getattr(session, "bind", None)
    return getattr(getattr(bind, "dialect", None), "name", None)


async def _lock_user_storage(session: AsyncSession, user_id: str, dialect: str) -> None:
    if dialect != "postgresql":
        return
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"ai-assistant-storage:{user_id}"},
    )


async def lock_user_storage_writer(session: AsyncSession, *, user_id: str) -> None:
    dialect = _dialect_name(session)
    if dialect is not None:
        await _lock_user_storage(session, user_id, dialect)


def _stored_length_expression(column: Any, dialect: str) -> Any:
    serialized = cast(column, Text)
    if dialect == "postgresql":
        return func.octet_length(serialized)
    return func.length(serialized)


async def _read_user_storage_usage(
    session: AsyncSession,
    *,
    user_id: str,
    dialect: str,
) -> dict[str, int]:
    session_context_length = _stored_length_expression(
        AIAssistantSession.context_json,
        dialect,
    )
    session_preview_length = _stored_length_expression(
        AIAssistantSession.latest_preview,
        dialect,
    )
    session_result = await session.execute(
        select(
            func.count(AIAssistantSession.id),
            func.coalesce(
                func.sum(session_context_length + session_preview_length),
                0,
            ),
        ).where(AIAssistantSession.user_id == user_id)
    )
    session_count, session_json_bytes = session_result.one()

    message_length = _stored_length_expression(AIAssistantMessage.content_json, dialect)
    message_result = await session.execute(
        select(
            func.count(AIAssistantMessage.id),
            func.coalesce(func.sum(message_length), 0),
        )
        .select_from(AIAssistantMessage)
        .join(
            AIAssistantSession,
            AIAssistantSession.id == AIAssistantMessage.session_id,
        )
        .where(AIAssistantSession.user_id == user_id)
    )
    message_count, message_bytes = message_result.one()

    image_length = _stored_length_expression(
        AIAssistantImageBlob.payload_base64,
        dialect,
    ) + _stored_length_expression(AIAssistantImageBlob.mime_type, dialect)
    image_result = await session.execute(
        select(
            func.count(AIAssistantImageBlob.id),
            func.coalesce(func.sum(image_length), 0),
        )
        .select_from(AIAssistantImageBlob)
        .join(
            AIAssistantSession,
            AIAssistantSession.id == AIAssistantImageBlob.session_id,
        )
        .where(
            AIAssistantSession.user_id == user_id,
        )
    )
    image_count, image_bytes = image_result.one()

    return {
        "sessions": int(session_count or 0),
        "session_json_bytes": int(session_json_bytes or 0),
        "messages": int(message_count or 0),
        "message_bytes": int(message_bytes or 0),
        "image_blobs": int(image_count or 0),
        "image_blob_bytes": int(image_bytes or 0),
    }


async def _read_session_message_usage(
    session: AsyncSession,
    *,
    assistant_session_id: Any,
    dialect: str,
) -> tuple[int, int]:
    message_length = _stored_length_expression(AIAssistantMessage.content_json, dialect)
    result = await session.execute(
        select(
            func.count(AIAssistantMessage.id),
            func.coalesce(func.sum(message_length), 0),
        ).where(AIAssistantMessage.session_id == assistant_session_id)
    )
    message_count, message_bytes = result.one()
    return int(message_count or 0), int(message_bytes or 0)


async def ensure_user_storage_capacity(
    session: AsyncSession,
    *,
    user_id: str,
    projected_sessions: int = 0,
    projected_session_json_bytes: int = 0,
    projected_messages: int = 0,
    projected_message_bytes: int = 0,
    projected_image_blobs: int = 0,
    projected_image_blob_bytes: int = 0,
    assistant_session_id: Any | None = None,
) -> None:
    """Serialize PostgreSQL writers and reject a projected per-user overflow.

    Unknown test doubles intentionally skip database accounting. Real non-PostgreSQL
    sessions still receive best-effort count/byte enforcement without PostgreSQL's
    advisory-lock guarantee.
    """

    dialect = _dialect_name(session)
    if dialect is None:
        return
    await _lock_user_storage(session, user_id, dialect)
    usage = await _read_user_storage_usage(
        session,
        user_id=user_id,
        dialect=dialect,
    )
    projected = {
        "sessions": usage["sessions"] + projected_sessions,
        "session_json_bytes": usage["session_json_bytes"]
        + projected_session_json_bytes,
        "messages": usage["messages"] + projected_messages,
        "message_bytes": usage["message_bytes"] + projected_message_bytes,
        "image_blobs": usage["image_blobs"] + projected_image_blobs,
        "image_blob_bytes": usage["image_blob_bytes"]
        + projected_image_blob_bytes,
    }
    limits = {
        "sessions": MAX_USER_ASSISTANT_SESSIONS,
        "session_json_bytes": MAX_USER_ASSISTANT_SESSION_JSON_BYTES,
        "messages": MAX_USER_ASSISTANT_MESSAGES,
        "message_bytes": MAX_USER_ASSISTANT_MESSAGE_BYTES,
        "image_blobs": MAX_USER_ASSISTANT_IMAGE_BLOBS,
        "image_blob_bytes": MAX_USER_ASSISTANT_IMAGE_BLOB_BYTES,
    }
    for metric, limit in limits.items():
        if projected[metric] > limit:
            raise AssistantStorageQuotaExceeded(metric)
    if assistant_session_id is not None:
        session_message_count, session_message_bytes = (
            await _read_session_message_usage(
                session,
                assistant_session_id=assistant_session_id,
                dialect=dialect,
            )
        )
        if session_message_count + projected_messages > MAX_ASSISTANT_SESSION_MESSAGES:
            raise AssistantStorageQuotaExceeded("session_messages")
        if (
            session_message_bytes + projected_message_bytes
            > MAX_ASSISTANT_SESSION_MESSAGE_BYTES
        ):
            raise AssistantStorageQuotaExceeded("session_message_bytes")
