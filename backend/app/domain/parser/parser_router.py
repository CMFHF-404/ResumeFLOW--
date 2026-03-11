import asyncio
import logging
from time import perf_counter
from typing import Any, Dict
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from .parser_service import (
    apply_duplicate_flags,
    build_resume_items,
    extract_text,
    fetch_existing_experiences,
    normalize_certifications,
    normalize_personal_info,
    _resolve_file_kind,
    _resolve_file_mime,
    normalize_skill_groups,
    parse_resume,
    parse_resume_with_thoughts,
)
from .schemas import ResumeParseResponse

router = APIRouter(prefix="/parser", tags=["parser"])
logger = logging.getLogger(__name__)


def _ndjson_line(payload: Dict[str, Any]) -> str:
    import json as _json

    return _json.dumps(payload, ensure_ascii=False) + "\n"


async def _build_parse_response(
    *,
    file: UploadFile,
    session: AsyncSession,
    user_id: str,
    request_id: str,
) -> ResumeParseResponse:
    file_data = await extract_text(file, request_id)
    file_kind = _resolve_file_kind(file)
    payload = await parse_resume(
        file_data=file_data,
        filename=file.filename or "resume",
        file_mime_type=_resolve_file_mime(file, file_kind),
        request_id=request_id,
    )

    build_start = perf_counter()
    items = build_resume_items(payload)
    build_ms = (perf_counter() - build_start) * 1000

    dedupe_start = perf_counter()
    existing = await fetch_existing_experiences(session, user_id)
    enriched = apply_duplicate_flags(items, existing)
    dedupe_ms = (perf_counter() - dedupe_start) * 1000

    logger.info(
        "[ResumeParse] post_process request_id=%s build_ms=%.2f dedupe_ms=%.2f",
        request_id,
        build_ms,
        dedupe_ms,
    )
    personal_info = normalize_personal_info(payload)
    certifications = normalize_certifications(payload)
    skills = normalize_skill_groups(payload)
    return ResumeParseResponse(
        items=enriched,
        personal_info=personal_info,
        certifications=certifications,
        skills=skills,
    )


@router.post("/parse", response_model=ResumeParseResponse)
async def parse_resume_endpoint(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_id = str(uuid.uuid4())
    total_start = perf_counter()
    logger.info(
        "[ResumeParse] start request_id=%s filename=%s content_type=%s",
        request_id,
        file.filename or "",
        file.content_type or "",
    )
    try:
        response_payload = await _build_parse_response(
            file=file,
            session=session,
            user_id=current_user.id,
            request_id=request_id,
        )
    except ValueError as exc:
        total_ms = (perf_counter() - total_start) * 1000
        logger.warning(
            "[ResumeParse] failed request_id=%s duration_ms=%.2f error=%s",
            request_id,
            total_ms,
            str(exc),
        )
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    total_ms = (perf_counter() - total_start) * 1000
    logger.info(
        "[ResumeParse] complete request_id=%s duration_ms=%.2f",
        request_id,
        total_ms,
    )
    return response_payload


@router.post("/parse/stream")
async def parse_resume_stream_endpoint(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_id = str(uuid.uuid4())
    total_start = perf_counter()
    logger.info(
        "[ResumeParse] stream start request_id=%s filename=%s content_type=%s",
        request_id,
        file.filename or "",
        file.content_type or "",
    )

    async def event_stream():
        queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        async def run_parse_pipeline() -> None:
            try:
                await emit(
                    {"type": "progress", "node": "receive_file", "title": "接收简历附件"}
                )
                file_data = await extract_text(file, request_id)
                file_kind = _resolve_file_kind(file)
                payload = await parse_resume_with_thoughts(
                    file_data=file_data,
                    filename=file.filename or "resume",
                    file_mime_type=_resolve_file_mime(file, file_kind),
                    request_id=request_id,
                    progress_callback=emit,
                    thought_callback=emit,
                )

                build_start = perf_counter()
                items = build_resume_items(payload)
                build_ms = (perf_counter() - build_start) * 1000

                await emit(
                    {
                        "type": "progress",
                        "node": "dedupe_result",
                        "title": "匹配并标记重复经历",
                    }
                )
                dedupe_start = perf_counter()
                existing = await fetch_existing_experiences(session, current_user.id)
                enriched = apply_duplicate_flags(items, existing)
                dedupe_ms = (perf_counter() - dedupe_start) * 1000

                response_payload = ResumeParseResponse(
                    items=enriched,
                    personal_info=normalize_personal_info(payload),
                    certifications=normalize_certifications(payload),
                    skills=normalize_skill_groups(payload),
                )
                await emit(
                    {"type": "progress", "node": "finalize", "title": "生成可导入结果"}
                )
                await emit(
                    {
                        "type": "final",
                        "result": response_payload.model_dump(),
                    }
                )
                total_ms = (perf_counter() - total_start) * 1000
                logger.info(
                    "[ResumeParse] stream complete request_id=%s duration_ms=%.2f build_ms=%.2f dedupe_ms=%.2f",
                    request_id,
                    total_ms,
                    build_ms,
                    dedupe_ms,
                )
            except ValueError as exc:
                total_ms = (perf_counter() - total_start) * 1000
                logger.warning(
                    "[ResumeParse] stream failed request_id=%s duration_ms=%.2f error=%s",
                    request_id,
                    total_ms,
                    str(exc),
                )
                await emit({"type": "error", "message": str(exc)})
            except asyncio.CancelledError:
                total_ms = (perf_counter() - total_start) * 1000
                logger.info(
                    "[ResumeParse] stream cancelled request_id=%s duration_ms=%.2f",
                    request_id,
                    total_ms,
                )
                raise
            except Exception as exc:
                total_ms = (perf_counter() - total_start) * 1000
                logger.exception(
                    "[ResumeParse] stream error request_id=%s duration_ms=%.2f",
                    request_id,
                    total_ms,
                )
                await emit({"type": "error", "message": str(exc)})
            finally:
                await queue.put(None)

        producer = asyncio.create_task(run_parse_pipeline())
        try:
            while True:
                payload = await queue.get()
                if payload is None:
                    break
                yield _ndjson_line(payload)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
