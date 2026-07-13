import asyncio
import json
import logging
import re
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
from ..billing import billing_service
from ..ai import jd_attachment_service
from ..ai.ai_service import (
    _normalize_selected_experiences,
    _normalize_selected_resume,
    run_assistant_turn,
    run_assistant_turn_with_thoughts,
)
from ..certifications.certification_service import list_certifications
from ..experience.experience_service import (
    NotFoundError as ExperienceNotFoundError,
    get_experience_detail,
    list_experiences,
)
from ..profile.profile_service import get_profile_if_exists
from ..skills.skill_service import list_user_skills
from .assistant_context_service import (
    BANK_CONTEXT_FETCH_BATCH_SIZE,
    MAX_BANK_CERT_DESCRIPTION_CHARS,
    MAX_BANK_EXPERIENCE_SUMMARY_CHARS,
    MAX_BANK_PROFILE_SUMMARY_CHARS,
    MAX_BANK_STAR_FIELD_CHARS,
    MAX_BANK_TEXT_LENGTH,
    BankContextSources,
    _build_star_snapshot,
    _normalize_bank_text,
    _serialize_optional_date,
    build_bank_context,
)
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
logger = logging.getLogger("uvicorn.error")
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
    def _sanitize_attachment_preview(value: Any) -> Dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        return {
            key: payload
            for key, payload in value.items()
            if key not in {"imageB64", "text"}
        }

    attachment = _sanitize_attachment_preview(content_json.get("attachment"))
    if attachment:
        sanitized["attachment"] = attachment
    elif "attachment" in sanitized:
        sanitized.pop("attachment", None)

    raw_attachments = content_json.get("attachments")
    if isinstance(raw_attachments, list):
        sanitized_attachments = [
            preview
            for preview in (_sanitize_attachment_preview(item) for item in raw_attachments)
            if preview
        ]
        if sanitized_attachments:
            sanitized["attachments"] = sanitized_attachments
            sanitized["attachment"] = sanitized_attachments[0]
        elif "attachments" in sanitized:
            sanitized.pop("attachments", None)
    selected_experiences = _normalize_selected_experiences(content_json.get("selected_experiences"))
    if selected_experiences:
        sanitized["selected_experiences"] = selected_experiences
    elif "selected_experiences" in sanitized:
        sanitized.pop("selected_experiences", None)
    selected_resume = _normalize_selected_resume(content_json.get("selected_resume"))
    if selected_resume:
        sanitized["selected_resume"] = selected_resume
    elif "selected_resume" in sanitized:
        sanitized.pop("selected_resume", None)
    return sanitized


def _to_message_read(message) -> AssistantMessageRead:
    return AssistantMessageRead(
        id=str(message.id),
        role=message.role,
        message_type=message.message_type,
        content_json=_sanitize_message_content_json(message.content_json),
        created_at=message.created_at,
    )


def _read_apply_navigation(message) -> Dict[str, Any] | None:
    content_json = getattr(message, "content_json", None)
    if not isinstance(content_json, dict):
        return None
    navigation = content_json.get("apply_navigation")
    return navigation if isinstance(navigation, dict) else None


def _clip_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit].rstrip()}\n...(内容已截断)"


def _format_attachment_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _parse_form_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if not isinstance(value, str):
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _build_full_star_snapshot(raw_star: Any) -> Dict[str, str]:
    if not isinstance(raw_star, dict):
        return {}
    snapshot: Dict[str, str] = {}
    for key in ("s", "t", "a", "r"):
        value = raw_star.get(key)
        if isinstance(value, str) and value.strip():
            snapshot[key] = value.strip()
    return snapshot


def _collect_source_star_snapshots(
    *,
    context_json: Dict[str, Any],
    selected_experiences: list[Dict[str, Any]],
    target_latest_star: Dict[str, str] | None = None,
) -> list[Dict[str, str]]:
    sources: list[Dict[str, str]] = []

    context_star = _build_full_star_snapshot(context_json.get("star"))
    if context_star:
        sources.append(context_star)

    for item in selected_experiences:
        selected_star = _build_full_star_snapshot(item.get("star"))
        if selected_star:
            sources.append(selected_star)

    if target_latest_star:
        sources.append(target_latest_star)

    return sources


async def _load_context_target_star(
    session: AsyncSession,
    *,
    user_id: str,
    context_json: Dict[str, Any],
) -> Dict[str, str] | None:
    master_id = str(context_json.get("masterId") or "").strip()
    if not master_id:
        return None
    try:
        _, latest_version, _ = await get_experience_detail(session, user_id, master_id)
    except ExperienceNotFoundError:
        return None
    return _build_full_star_snapshot(getattr(latest_version, "star", None))


async def _hydrate_selected_experiences_for_ai(
    session: AsyncSession,
    *,
    user_id: str,
    selected_experiences: list[Dict[str, Any]],
) -> list[Dict[str, Any]]:
    hydrated_items: list[Dict[str, Any]] = []
    for item in selected_experiences:
        hydrated = dict(item)
        master_id = str(item.get("masterId") or "").strip()
        if master_id:
            try:
                _, latest_version, _ = await get_experience_detail(session, user_id, master_id)
            except ExperienceNotFoundError:
                latest_version = None
            if latest_version is not None:
                full_star = _build_full_star_snapshot(getattr(latest_version, "star", None))
                if full_star:
                    hydrated["star"] = full_star
        hydrated_items.append(hydrated)
    return hydrated_items


async def _build_bank_context(
    session: AsyncSession,
    *,
    user_id: str,
) -> Dict[str, Any]:
    return await build_bank_context(
        session,
        user_id=user_id,
        sources=BankContextSources(
            get_profile_if_exists=get_profile_if_exists,
            list_experiences=list_experiences,
            list_certifications=list_certifications,
            list_user_skills=list_user_skills,
        ),
        fetch_batch_size=BANK_CONTEXT_FETCH_BATCH_SIZE,
    )


async def _parse_stream_payload(
    request: Request,
) -> tuple[AssistantSessionStreamRequest, list[UploadFile]]:
    content_type = (request.headers.get("content-type") or "").lower()
    attachment_files: list[UploadFile] = []

    if "multipart/form-data" in content_type:
        form = await request.form()
        raw_candidates = []
        if hasattr(form, "getlist"):
            raw_candidates.extend(form.getlist("files"))
        if not raw_candidates:
            raw_candidates.append(form.get("file"))
        for candidate in raw_candidates:
            if isinstance(candidate, UploadFile) and candidate.filename:
                attachment_files.append(candidate)
            elif hasattr(candidate, "filename") and hasattr(candidate, "read") and getattr(candidate, "filename", None):
                attachment_files.append(candidate)
        raw_selected_experiences = form.get("selected_experiences")
        selected_experiences: list[Dict[str, Any]] = []
        if isinstance(raw_selected_experiences, str) and raw_selected_experiences.strip():
            try:
                parsed_selected_experiences = json.loads(raw_selected_experiences)
                if isinstance(parsed_selected_experiences, list):
                    selected_experiences = [item for item in parsed_selected_experiences if isinstance(item, dict)]
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="所选经历参数不是有效 JSON。") from exc
        raw_selected_resume = form.get("selected_resume")
        selected_resume: Dict[str, Any] | None = None
        if isinstance(raw_selected_resume, str) and raw_selected_resume.strip():
            try:
                parsed_selected_resume = json.loads(raw_selected_resume)
                if isinstance(parsed_selected_resume, dict):
                    selected_resume = parsed_selected_resume
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="所选简历参数不是有效 JSON。") from exc
        payload_dict = {
            "user_message": str(form.get("user_message") or ""),
            "display_message": str(form.get("display_message") or ""),
            "mode": str(form.get("mode") or "") or None,
            "skill_id": str(form.get("skill_id") or "") or None,
            "enable_thinking": _parse_form_bool(form.get("enable_thinking")),
            "selected_experiences": selected_experiences,
            "selected_resume": selected_resume,
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
    payload = payload.model_copy(
        update={
            "selected_experiences": _normalize_selected_experiences(payload.selected_experiences),
            "selected_resume": _normalize_selected_resume(payload.selected_resume),
        }
    )
    if (
        not payload.user_message.strip()
        and not attachment_files
        and not payload.selected_experiences
        and payload.selected_resume is None
    ):
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail="请输入消息、选择简历或上传附件后再发送。")
    return payload, attachment_files


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
    prepared_attachment: Any | None = None,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    attachment = prepared_attachment or await _prepare_attachment_result(file)
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
        "sizeLabel": _format_attachment_size(getattr(file, "size", 0) or 0),
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


async def _build_attachment_payloads(
    session: AsyncSession,
    *,
    assistant_session_id: UUID,
    files: list[UploadFile],
    prepared_attachments: list[Any] | None = None,
) -> tuple[list[Dict[str, Any]], list[Dict[str, Any]]]:
    prompt_payloads: list[Dict[str, Any]] = []
    persisted_payloads: list[Dict[str, Any]] = []
    prepared_items = prepared_attachments or []
    for index, file in enumerate(files):
        prompt_payload, persisted_payload = await _build_attachment_payload(
            session,
            assistant_session_id=assistant_session_id,
            file=file,
            prepared_attachment=prepared_items[index] if index < len(prepared_items) else None,
        )
        prompt_payload["id"] = prompt_payload.get("id") or f"{assistant_session_id}-{index}"
        persisted_payload["id"] = persisted_payload.get("id") or prompt_payload["id"]
        prompt_payloads.append(prompt_payload)
        persisted_payloads.append(persisted_payload)
    return prompt_payloads, persisted_payloads


async def _validate_attachment_file(file: UploadFile) -> None:
    file_bytes = await file.read()
    await file.seek(0)
    if not file_bytes:
        raise ValueError("上传的附件为空，请重新选择文件。")
    if len(file_bytes) > MAX_ASSISTANT_ATTACHMENT_BYTES:
        max_mb = MAX_ASSISTANT_ATTACHMENT_BYTES / (1024 * 1024)
        raise ValueError(f"附件过大，请上传不超过 {max_mb:.0f}MB 的文件。")


async def _prepare_attachment_result(file: UploadFile) -> Any:
    await _validate_attachment_file(file)
    attachment = await jd_attachment_service.extract_jd_from_attachment(file)
    if not attachment.is_image:
        full_text_content = (attachment.text or "").strip()
        if len(full_text_content) > MAX_ASSISTANT_ATTACHMENT_TEXT_CHARS:
            raise ValueError(
                f"附件正文过长，当前对话上传最多支持约 {MAX_ASSISTANT_ATTACHMENT_TEXT_CHARS} 个字符。"
                "请拆分文件后重试，或只上传需要讨论的部分。"
            )
    return attachment


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
    logger.info(
        "Applying assistant draft: user_id=%s session_id=%s message_id=%s skip_apply=%s",
        current_user.id,
        session_id,
        message_id,
        skip_apply,
    )
    try:
        message = await mark_message_applied(
            session,
            current_user.id,
            session_id,
            message_id,
            skip_apply=skip_apply,
        )
    except NotFoundError as exc:
        logger.warning(
            "Assistant draft apply not found: user_id=%s session_id=%s message_id=%s skip_apply=%s error=%s",
            current_user.id,
            session_id,
            message_id,
            skip_apply,
            exc,
        )
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidMessageError as exc:
        logger.warning(
            "Assistant draft apply rejected: user_id=%s session_id=%s message_id=%s skip_apply=%s error=%s",
            current_user.id,
            session_id,
            message_id,
            skip_apply,
            exc,
        )
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Assistant draft apply crashed: user_id=%s session_id=%s message_id=%s skip_apply=%s",
            current_user.id,
            session_id,
            message_id,
            skip_apply,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Assistant draft apply failed: {type(exc).__name__}",
        ) from exc
    logger.info(
        "Assistant draft applied: user_id=%s session_id=%s message_id=%s",
        current_user.id,
        session_id,
        message_id,
    )
    return AssistantMessageApplyRead(
        message=_to_message_read(message),
        navigation=_read_apply_navigation(message),
    )


@router.post("/sessions/{session_id}/stream")
async def stream_assistant_session_turn(
    session_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    current_user=Depends(get_current_user),
):
    payload, raw_attachment_files = await _parse_stream_payload(request)
    await billing_service.ensure_quota_available(session, current_user.id)
    attachment_files = (
        raw_attachment_files
        if isinstance(raw_attachment_files, list)
        else [raw_attachment_files] if raw_attachment_files is not None else []
    )

    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()
        assistant_thinking_summaries: list[str] = []

        def record_assistant_thinking(event: Dict[str, Any]) -> None:
            event_type = event.get("type")
            if event_type == "thought_reset":
                assistant_thinking_summaries.clear()
                return
            if event_type != "thought":
                return
            summary = event.get("summary")
            if not isinstance(summary, str):
                return
            normalized = re.sub(r"\s+", " ", summary).strip()
            if not normalized:
                return
            if assistant_thinking_summaries and assistant_thinking_summaries[-1] == normalized:
                return
            assistant_thinking_summaries.append(normalized)

        async def emit(event: Dict[str, Any]) -> None:
            record_assistant_thinking(event)
            await queue.put(event)

        async def run_turn() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="ai_assistant",
                    metadata={"route": f"/api/assistant/sessions/{session_id}/stream"},
                ):
                    assistant_session = await get_assistant_session(session, current_user.id, session_id)
                    messages = (await get_session_detail(session, current_user.id, session_id))[1]
                    attachment_payloads: list[Dict[str, Any]] = []
                    persisted_attachments: list[Dict[str, Any]] = []
                    prepared_attachments: list[Any] = []
                    if attachment_files:
                        await emit({"type": "progress", "node": "read_attachment", "title": "解析对话附件"})
                        for attachment_file in attachment_files:
                            prepared_attachments.append(await _prepare_attachment_result(attachment_file))
                    await emit({"type": "progress", "node": "prepare_context", "title": "准备对话上下文"})
                    bank_context = await _build_bank_context(session, user_id=current_user.id)
                    if attachment_files:
                        attachment_payloads, persisted_attachments = await _build_attachment_payloads(
                            session,
                            assistant_session_id=assistant_session.id,
                            files=attachment_files,
                            prepared_attachments=prepared_attachments,
                        )
                    selected_experiences_for_ai = await _hydrate_selected_experiences_for_ai(
                        session,
                        user_id=current_user.id,
                        selected_experiences=payload.selected_experiences,
                    )
                    target_latest_star = await _load_context_target_star(
                        session,
                        user_id=current_user.id,
                        context_json=assistant_session.context_json or {},
                    )
                    source_stars = _collect_source_star_snapshots(
                        context_json=assistant_session.context_json or {},
                        selected_experiences=selected_experiences_for_ai,
                        target_latest_star=target_latest_star,
                    )
                    await emit({"type": "progress", "node": "request_ai", "title": "调用 AI 助理"})
                    turn_kwargs = {
                        "mode": payload.mode or assistant_session.mode,
                        "user_message": payload.user_message,
                        "session_title": assistant_session.title,
                        "entry_source": assistant_session.entry_source,
                        "context_json": assistant_session.context_json,
                        "bank_context": bank_context,
                        "selected_experiences": selected_experiences_for_ai,
                        "selected_resume": payload.selected_resume,
                        "skill_id": payload.skill_id,
                        "history": _build_history_messages(messages),
                        "attachments": attachment_payloads,
                        "source_stars": source_stars,
                        "attachment_hydrator": lambda attachments: _hydrate_attachment_payloads(
                            session,
                            assistant_session_id=assistant_session.id,
                            attachments=attachments,
                        ),
                    }
                    if payload.enable_thinking:
                        result = await run_assistant_turn_with_thoughts(
                            **turn_kwargs,
                            thought_callback=emit,
                            assistant_text_callback=emit,
                        )
                    else:
                        result = await run_assistant_turn(
                            **turn_kwargs,
                            assistant_text_callback=emit,
                        )
                    await persist_assistant_turn(
                        session,
                        assistant_session,
                        user_message=payload.user_message,
                        display_message=payload.display_message,
                        user_attachments=persisted_attachments,
                        user_selected_experiences=payload.selected_experiences,
                        user_selected_resume=payload.selected_resume,
                        user_skill_id=payload.skill_id,
                        assistant_text=result["assistantText"],
                        draft_card=result.get("draftCard"),
                        assistant_thinking="\n".join(assistant_thinking_summaries),
                        suggested_followups=result.get("suggestedFollowups"),
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
