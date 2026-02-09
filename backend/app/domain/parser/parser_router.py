import logging
import re
from time import perf_counter
from typing import Any, Dict, List, Optional
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
    parse_resume,
)
from .schemas import ResumeParseResponse

router = APIRouter(prefix="/parser", tags=["parser"])
logger = logging.getLogger(__name__)

LINK_SPLIT_PATTERN = re.compile(r"[\s,;，；]+")
PERSONAL_INFO_FIELDS = ("full_name", "email", "phone", "location")

def _normalize_personal_links(value: Any) -> List[str]:
    if not value:
        return []
    items: List[str] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str):
                items.extend(LINK_SPLIT_PATTERN.split(item))
    elif isinstance(value, str):
        items.extend(LINK_SPLIT_PATTERN.split(value))
    else:
        return []
    return [item.strip() for item in items if isinstance(item, str) and item.strip()]


def _normalize_personal_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _extract_personal_info(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    personal_info = payload.get("personal_info")
    if not isinstance(personal_info, dict):
        return None
    normalized: Dict[str, Any] = {}
    for field in PERSONAL_INFO_FIELDS:
        value = _normalize_personal_value(personal_info.get(field))
        if value:
            normalized[field] = value
    links = _normalize_personal_links(personal_info.get("links"))
    if links:
        normalized["links"] = links
    return normalized or None


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
        text = await extract_text(file, request_id)
        payload = await parse_resume(text, request_id)
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
    personal_info = _extract_personal_info(payload)
    return ResumeParseResponse(items=enriched, personal_info=personal_info)
