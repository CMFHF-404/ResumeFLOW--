import asyncio
import logging
from time import perf_counter
from typing import Any, Dict
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_400_BAD_REQUEST

from ...database import get_session
from ...dependencies import get_current_user
from ...utils.ndjson import ndjson_line as _ndjson_line
from ..billing import billing_service
from ..ai.runtime_budget import (
    BoundedAiRequestBodyRoute,
    TERMINAL_AI_RUNTIME_ERRORS,
    ai_deadline_scoped,
    ai_wall_clock_limited,
    build_public_stream_error_event,
    create_bounded_event_queue,
    finish_event_queue,
)
from ..ai.response_diagnostics import safe_body_log_summary
from ..ai.public_errors import (
    resolve_ai_public_response,
    translate_ai_public_exception,
)
from .errors import ResumeInputError
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
from .semantic_duplicate_detection import apply_semantic_duplicate_flags

router = APIRouter(
    prefix="/parser",
    tags=["parser"],
    route_class=BoundedAiRequestBodyRoute,
)
logger = logging.getLogger(__name__)
GENERIC_STREAM_PARSE_ERROR = "解析失败，请检查文件内容或稍后重试。"
@ai_wall_clock_limited
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
    enriched = await apply_semantic_duplicate_flags(
        enriched,
        existing,
        request_id=request_id,
    )
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
        "[ResumeParse] start request_id=%s filename_meta=%s content_type=%s",
        request_id,
        safe_body_log_summary(file.filename or ""),
        file.content_type or "",
    )
    try:
        async with billing_service.ai_billing_context(
            session,
            current_user.id,
            entrypoint="resume_parse",
            metadata={"route": "/parser/parse", "request_id": request_id},
        ):
            await billing_service.ensure_current_quota()
            response_payload = await resolve_ai_public_response(
                _build_parse_response(
                    file=file,
                    session=session,
                    user_id=current_user.id,
                    request_id=request_id,
                )
            )
    except TERMINAL_AI_RUNTIME_ERRORS:
        raise
    except ResumeInputError as exc:
        total_ms = (perf_counter() - total_start) * 1000
        logger.warning(
            "[ResumeParse] failed request_id=%s duration_ms=%.2f error_type=%s",
            request_id,
            total_ms,
            type(exc).__name__,
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
    enable_thinking: bool = Form(False),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    request_id = str(uuid.uuid4())
    total_start = perf_counter()
    logger.info(
        "[ResumeParse] stream start request_id=%s filename_meta=%s content_type=%s enable_thinking=%s",
        request_id,
        safe_body_log_summary(file.filename or ""),
        file.content_type or "",
        enable_thinking,
    )
    request_lease = await billing_service.begin_ai_request(
        session,
        current_user.id,
        entrypoint="resume_parse",
    )

    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(payload: Dict[str, Any]) -> None:
            await queue.put(payload)

        @ai_deadline_scoped
        async def run_parse_pipeline() -> None:
            try:
                async with billing_service.ai_billing_context(
                    session,
                    current_user.id,
                    entrypoint="resume_parse",
                    metadata={"route": "/parser/parse/stream", "request_id": request_id},
                    request_lease=request_lease,
                    release_request_lease_on_exit=False,
                ):
                    await emit(
                        {"type": "progress", "node": "receive_file", "title": "接收简历附件"}
                    )
                    file_data = await extract_text(file, request_id)
                    file_kind = _resolve_file_kind(file)
                    common_parse_kwargs = {
                        "file_data": file_data,
                        "filename": file.filename or "resume",
                        "file_mime_type": _resolve_file_mime(file, file_kind),
                        "request_id": request_id,
                        "progress_callback": emit,
                    }
                    if enable_thinking is True:
                        payload = await parse_resume_with_thoughts(
                            **common_parse_kwargs,
                            thought_callback=emit,
                        )
                    else:
                        payload = await parse_resume(**common_parse_kwargs)

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
                    enriched = await apply_semantic_duplicate_flags(
                        enriched,
                        existing,
                        request_id=request_id,
                    )
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
            except ResumeInputError as exc:
                total_ms = (perf_counter() - total_start) * 1000
                logger.warning(
                    "[ResumeParse] stream failed request_id=%s duration_ms=%.2f error_type=%s",
                    request_id,
                    total_ms,
                    type(exc).__name__,
                )
                await emit(
                    build_public_stream_error_event(
                        exc,
                        request_id=request_id,
                        preserve_value_error=True,
                    )
                )
            except TERMINAL_AI_RUNTIME_ERRORS as exc:
                total_ms = (perf_counter() - total_start) * 1000
                logger.warning(
                    "[ResumeParse] stream terminal failure request_id=%s duration_ms=%.2f error_type=%s",
                    request_id,
                    total_ms,
                    type(exc).__name__,
                )
                await emit(
                    build_public_stream_error_event(
                        exc,
                        request_id=request_id,
                    )
                )
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
                translated = translate_ai_public_exception(exc)
                if translated is None:
                    logger.error(
                        "[ResumeParse] stream error request_id=%s duration_ms=%.2f error_type=%s",
                        request_id,
                        total_ms,
                        type(exc).__name__,
                    )
                    event = build_public_stream_error_event(
                        RuntimeError("parser stream failed"),
                        request_id=request_id,
                        preserve_value_error=False,
                    )
                    event["message"] = GENERIC_STREAM_PARSE_ERROR
                else:
                    logger.warning(
                        "[ResumeParse] stream upstream failure request_id=%s duration_ms=%.2f error_type=%s",
                        request_id,
                        total_ms,
                        type(exc).__name__,
                    )
                    event = build_public_stream_error_event(
                        translated,
                        request_id=request_id,
                        preserve_exceptions=(HTTPException,),
                    )
                await emit(event)
            finally:
                await finish_event_queue(queue)

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
            if request_lease is not None:
                await request_lease.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
