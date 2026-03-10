import logging
from time import perf_counter
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
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
)
from .schemas import ResumeParseResponse

router = APIRouter(prefix="/parser", tags=["parser"])
logger = logging.getLogger(__name__)


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
        file_data = await extract_text(file, request_id)
        file_kind = _resolve_file_kind(file)
        payload = await parse_resume(
            file_data=file_data,
            filename=file.filename or "resume",
            file_mime_type=_resolve_file_mime(file, file_kind),
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

    build_start = perf_counter()
    items = build_resume_items(payload)
    build_ms = (perf_counter() - build_start) * 1000

    dedupe_start = perf_counter()
    existing = await fetch_existing_experiences(session, current_user.id)
    enriched = apply_duplicate_flags(items, existing)
    dedupe_ms = (perf_counter() - dedupe_start) * 1000

    total_ms = (perf_counter() - total_start) * 1000
    logger.info(
        "[ResumeParse] complete request_id=%s duration_ms=%.2f build_ms=%.2f dedupe_ms=%.2f",
        request_id,
        total_ms,
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
