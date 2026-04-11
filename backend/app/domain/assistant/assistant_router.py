import asyncio
import json
from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_204_NO_CONTENT, HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND

from ...database import get_session as get_db_session
from ...dependencies import get_current_user
from ...models import AIAssistantImageBlob
from ..ai import jd_attachment_service
from ..ai.ai_service import run_assistant_turn_with_thoughts
from .assistant_service import (
    InvalidMessageError,
    NotFoundError,
    create_session,
    delete_session,
    get_session_detail,
    get_session as get_assistant_session,
    list_sessions,
    mark_message_applied,
    persist_assistant_turn,
    update_session,
)
from .schemas import (
    AssistantMessageApplyRead,
    AssistantMessageRead,
    AssistantSessionCreate,
    AssistantSessionDetail,
    AssistantSessionRead,
    AssistantSessionStreamRequest,
    AssistantSessionUpdate,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])
MAX_ASSISTANT_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_ASSISTANT_ATTACHMENT_TEXT_CHARS = 12_000
MAX_ASSISTANT_ATTACHMENT_EXCERPT_CHARS = 1_200


def _ndjson_line(payload: Dict[str, Any]) -> str:
    import json as _json

    return _json.dumps(payload, ensure_ascii=False) + "\n"


def _to_session_read(session) -> AssistantSessionRead:
    return AssistantSessionRead(
        id=str(session.id),
        user_id=session.user_id,
        title=session.title,
        mode=session.mode,
        entry_source=session.entry_source,
        context_json=session.context_json,
        latest_preview=session.latest_preview,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def _sanitize_message_content_json(content_json: Dict[str, Any] | None) -> Dict[str, Any]:
    if not isinstance(content_json, dict):
        return {}

    sanitized = {**content_json}
    attachment = content_json.get("attachment")
    if not isinstance(attachment, dict):
        return sanitized

    sanitized_attachment = {
        key: value
        for key, value in attachment.items()
        if key not in {"imageB64", "text"}
    }
    sanitized["attachment"] = sanitized_attachment
    return sanitized


def _to_message_read(message) -> AssistantMessageRead:
    return AssistantMessageRead(
        id=str(message.id),
        role=message.role,
        message_type=message.message_type,
        content_json=_sanitize_message_content_json(message.content_json),
        created_at=message.created_at,
    )


def _clip_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit].rstrip()}\n...(内容已截断)"


async def _parse_stream_payload(
    request: Request,
) -> tuple[AssistantSessionStreamRequest, UploadFile | None]:
    content_type = (request.headers.get("content-type") or "").lower()
    attachment_file: UploadFile | None = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        candidate = form.get("file")
        if isinstance(candidate, UploadFile) and candidate.filename:
            attachment_file = candidate
        elif hasattr(candidate, "filename") and hasattr(candidate, "read") and getattr(candidate, "filename", None):
            attachment_file = candidate
        payload_dict = {
            "user_message": str(form.get("user_message") or ""),
            "display_message": str(form.get("display_message") or ""),
            "mode": str(form.get("mode") or "") or None,
        }
    else:
        try:
            payload_dict = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="请求体不是有效的 JSON。") from exc

    try:
        payload = AssistantSessionStreamRequest.model_validate(payload_dict)
    except ValidationError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="请求参数格式不正确。") from exc
    if not payload.user_message.strip() and attachment_file is None:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="请输入消息或上传附件后再发送。")
    return payload, attachment_file


async def _persist_image_blob(
    session: AsyncSession,
    *,
    session_id: UUID,
    mime_type: str,
    image_b64: str,
) -> str:
    cleaned_payload = image_b64.strip()
    if not cleaned_payload:
        return ""

    blob = AIAssistantImageBlob(
        session_id=session_id,
        mime_type=mime_type.strip(),
        payload_base64=cleaned_payload,
    )
    session.add(blob)
    await session.flush()
    return str(blob.id)


def _build_history_messages(messages: list) -> list[Dict[str, Any]]:
    return [
        {
            "role": message.role,
            "message_type": message.message_type,
            "content_json": message.content_json,
        }
        for message in messages
    ]


async def _hydrate_attachment_payloads(
    session: AsyncSession,
    *,
    assistant_session_id: UUID,
    attachments: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    blob_ids: list[UUID] = []
    blob_ids_seen: set[UUID] = set()
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        blob_id = attachment.get("imageBlobId")
        if not isinstance(blob_id, str) or not blob_id.strip():
            continue
        try:
            parsed_blob_id = UUID(blob_id)
        except ValueError:
            continue
        if parsed_blob_id in blob_ids_seen:
            continue
        blob_ids_seen.add(parsed_blob_id)
        blob_ids.append(parsed_blob_id)

    blobs_by_id: dict[str, AIAssistantImageBlob] = {}
    if blob_ids:
        result = await session.execute(
            select(AIAssistantImageBlob).where(
                AIAssistantImageBlob.id.in_(blob_ids),
                AIAssistantImageBlob.session_id == assistant_session_id,
            )
        )
        blobs_by_id = {str(blob.id): blob for blob in result.scalars().all()}

    hydrated_attachments: list[Dict[str, Any]] = []
    for attachment in attachments:
        hydrated_attachment = dict(attachment)
        blob_id = hydrated_attachment.get("imageBlobId")
        blob = blobs_by_id.get(blob_id) if isinstance(blob_id, str) else None
        if blob and blob.payload_base64.strip():
            hydrated_attachment["imageB64"] = blob.payload_base64.strip()
        hydrated_attachments.append(hydrated_attachment)
    return hydrated_attachments


async def _build_attachment_payload(
    session: AsyncSession,
    *,
    assistant_session_id: UUID,
    file: UploadFile,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    file_bytes = await file.read()
    await file.seek(0)
    if not file_bytes:
        raise ValueError("上传的附件为空，请重新选择文件。")
    if len(file_bytes) > MAX_ASSISTANT_ATTACHMENT_BYTES:
        max_mb = MAX_ASSISTANT_ATTACHMENT_BYTES / (1024 * 1024)
        raise ValueError(f"附件过大，请上传不超过 {max_mb:.0f}MB 的文件。")

    attachment = await jd_attachment_service.extract_jd_from_attachment(file)
    attachment_name = file.filename or "附件"
    prompt_payload: Dict[str, Any] = {
        "name": attachment_name,
        "kind": "image" if attachment.is_image else "document",
        "contentType": file.content_type or "",
    }
    persisted_payload: Dict[str, Any] = {
        "name": attachment_name,
        "kind": prompt_payload["kind"],
        "contentType": prompt_payload["contentType"],
    }

    if attachment.is_image:
        image_b64 = attachment.image_b64 or ""
        prompt_payload["mimeType"] = attachment.mime_type or (file.content_type or "")
        prompt_payload["imageB64"] = image_b64
        persisted_payload["mimeType"] = prompt_payload["mimeType"]
        blob_id = await _persist_image_blob(
            session,
            session_id=assistant_session_id,
            mime_type=prompt_payload["mimeType"],
            image_b64=image_b64,
        )
        if blob_id:
            persisted_payload["imageBlobId"] = blob_id
        return prompt_payload, persisted_payload

    full_text_content = (attachment.text or "").strip()
    if len(full_text_content) > MAX_ASSISTANT_ATTACHMENT_TEXT_CHARS:
        raise ValueError(
            f"附件正文过长，当前对话上传最多支持约 {MAX_ASSISTANT_ATTACHMENT_TEXT_CHARS} 个字符。"
            "请拆分文件后重试，或只上传需要讨论的部分。"
        )
    prompt_payload["text"] = full_text_content
    persisted_payload["text"] = full_text_content
    persisted_payload["textExcerpt"] = _clip_text(full_text_content, MAX_ASSISTANT_ATTACHMENT_EXCERPT_CHARS)
    return prompt_payload, persisted_payload


@router.get("/sessions", response_model=list[AssistantSessionRead])
async def list_assistant_sessions(
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    rows = await list_sessions(session, current_user.id)
    return [_to_session_read(row) for row in rows]


@router.post("/sessions", response_model=AssistantSessionRead)
async def create_assistant_session(
    payload: AssistantSessionCreate,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    created = await create_session(session, current_user.id, payload)
    return _to_session_read(created)


@router.get("/sessions/{session_id}", response_model=AssistantSessionDetail)
async def get_assistant_session_detail(
    session_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        assistant_session, messages = await get_session_detail(
            session,
            current_user.id,
            session_id,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return AssistantSessionDetail(
        session=_to_session_read(assistant_session),
        messages=[_to_message_read(message) for message in messages],
    )


@router.delete("/sessions/{session_id}", status_code=HTTP_204_NO_CONTENT)
async def delete_assistant_session(
    session_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        await delete_session(session, current_user.id, session_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/sessions/{session_id}", response_model=AssistantSessionRead)
async def update_assistant_session(
    session_id: UUID,
    payload: AssistantSessionUpdate,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        updated = await update_session(session, current_user.id, session_id, payload)
        return _to_session_read(updated)
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/sessions/{session_id}/messages/{message_id}/apply",
    response_model=AssistantMessageApplyRead,
)
async def mark_assistant_message_applied(
    session_id: UUID,
    message_id: UUID,
    skip_apply: bool = False,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    try:
        message = await mark_message_applied(
            session,
            current_user.id,
            session_id,
            message_id,
            skip_apply=skip_apply,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidMessageError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return AssistantMessageApplyRead(message=_to_message_read(message))


@router.post("/sessions/{session_id}/stream")
async def stream_assistant_session_turn(
    session_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    payload, attachment_file = await _parse_stream_payload(request)

    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(event: Dict[str, Any]) -> None:
            await queue.put(event)

        async def run_turn() -> None:
            try:
                assistant_session = await get_assistant_session(session, current_user.id, session_id)
                messages = (await get_session_detail(session, current_user.id, session_id))[1]
                attachment_payload: Dict[str, Any] | None = None
                persisted_attachment: Dict[str, Any] | None = None
                if attachment_file is not None:
                    await emit({"type": "progress", "node": "read_attachment", "title": "解析对话附件"})
                    attachment_payload, persisted_attachment = await _build_attachment_payload(
                        session,
                        assistant_session_id=assistant_session.id,
                        file=attachment_file,
                    )
                await emit({"type": "progress", "node": "prepare_context", "title": "准备对话上下文"})
                await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 助理"})
                result = await run_assistant_turn_with_thoughts(
                    mode=payload.mode or assistant_session.mode,
                    user_message=payload.user_message,
                    session_title=assistant_session.title,
                    entry_source=assistant_session.entry_source,
                    context_json=assistant_session.context_json,
                    history=_build_history_messages(messages),
                    attachment=attachment_payload,
                    thought_callback=emit,
                    attachment_hydrator=lambda attachments: _hydrate_attachment_payloads(
                        session,
                        assistant_session_id=assistant_session.id,
                        attachments=attachments,
                    ),
                )
                await persist_assistant_turn(
                    session,
                    assistant_session,
                    user_message=payload.user_message,
                    display_message=payload.display_message,
                    user_attachment=persisted_attachment,
                    assistant_text=result["assistantText"],
                    draft_card=result.get("draftCard"),
                    title=result.get("title"),
                )
                await emit({"type": "progress", "node": "persist_result", "title": "保存会话记录"})
                await emit({"type": "final", "result": result})
            except NotFoundError as exc:
                await emit({"type": "error", "message": str(exc)})
            except Exception as exc:
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

        producer = asyncio.create_task(run_turn())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield _ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
