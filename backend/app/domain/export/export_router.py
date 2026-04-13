from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import json
import logging
import os
import re
import time
import unicodedata
import zlib
from typing import TypeVar
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ValidationError
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_410_GONE,
    HTTP_400_BAD_REQUEST,
    HTTP_502_BAD_GATEWAY,
    HTTP_504_GATEWAY_TIMEOUT,
)

from ...database import AsyncSessionFactory, get_session
from ...dependencies import get_current_user
from .browser_pdf_service import (
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
    render_experience_bank_pdf,
    render_resume_pdf,
)
from .schemas import (
    ExportDownloadLinkRead,
    ExperienceBankPdfExportRequest,
    ExperienceBankPdfRenderSnapshot,
    ExperienceBankRenderSnapshotRead,
    RenderSnapshotRead,
    ResumePdfExportRequest,
    ResumePdfRenderSnapshot,
)
from .snapshot_service import (
    SnapshotConsumedError,
    SnapshotExpiredError,
    SnapshotNotFoundError,
    SnapshotPayloadError,
    SnapshotTokenError,
    create_render_snapshot,
    get_render_snapshot_by_token,
    mark_render_snapshot_consumed,
)

router = APIRouter(prefix="/exports", tags=["exports"])
logger = logging.getLogger(__name__)
ExportRequestModelT = TypeVar("ExportRequestModelT", bound=BaseModel)
RECENT_RENDERED_PDF_TTL_SECONDS = 15


@dataclass(frozen=True)
class RecentRenderedPdf:
    pdf_bytes: bytes
    expires_at_monotonic: float


_recent_rendered_pdf_by_key: dict[str, RecentRenderedPdf] = {}
_rendered_pdf_tasks_by_key: dict[str, asyncio.Task[bytes]] = {}
_rendered_pdf_cache_lock = asyncio.Lock()


def _build_export_request_openapi(model_name: str) -> dict:
    return {
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {
                        "$ref": f"#/components/schemas/{model_name}",
                    }
                }
            },
        }
    }


def _build_sanitized_validation_errors(exc: ValidationError) -> list[dict]:
    return exc.errors(
        include_input=False,
        include_context=False,
        include_url=False,
    )


def _sanitize_download_filename(value: str | None) -> str:
    base_name = (value or "resume-export").strip() or "resume-export"
    forbidden_chars = '/\\:*?"<>|'
    sanitized = "".join(char for char in base_name if char not in forbidden_chars).strip()
    if not sanitized:
        sanitized = "resume-export"
    if not sanitized.lower().endswith(".pdf"):
        sanitized = f"{sanitized}.pdf"
    return sanitized


def _build_ascii_download_filename(value: str) -> str:
    stem, ext = os.path.splitext(value)
    normalized_stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode(
        "ascii"
    )
    ascii_stem = re.sub(r"[^A-Za-z0-9._ -]+", "-", normalized_stem)
    ascii_stem = re.sub(r"[-\s]+", "-", ascii_stem).strip("-. ")

    if not ascii_stem.isalpha() and not re.search(r"[A-Za-z]", ascii_stem):
        if stem.startswith("简历"):
            ascii_stem = f"resume-{ascii_stem}".strip("-")
        elif stem.startswith("经历库"):
            ascii_stem = f"experience-bank-{ascii_stem}".strip("-")

    if not ascii_stem:
        ascii_stem = "export"

    ascii_ext = ext if ext else ".pdf"
    return f"{ascii_stem}{ascii_ext}"


def _build_pdf_download_response(pdf_bytes: bytes, file_name: str | None) -> Response:
    sanitized_file_name = _sanitize_download_filename(file_name)
    ascii_file_name = _build_ascii_download_filename(sanitized_file_name)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_file_name}"; '
            f"filename*=UTF-8''{quote(sanitized_file_name)}"
        ),
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


def _build_rendered_pdf_cache_key(snapshot_id: str, token: str) -> str:
    return f"{snapshot_id}:{token}"


def _prune_recent_rendered_pdfs_locked() -> None:
    now_monotonic = time.monotonic()
    expired_keys = [
        key
        for key, cached_pdf in _recent_rendered_pdf_by_key.items()
        if cached_pdf.expires_at_monotonic <= now_monotonic
    ]
    for key in expired_keys:
        _recent_rendered_pdf_by_key.pop(key, None)


async def _get_recent_rendered_pdf(cache_key: str) -> bytes | None:
    async with _rendered_pdf_cache_lock:
        _prune_recent_rendered_pdfs_locked()
        cached_pdf = _recent_rendered_pdf_by_key.get(cache_key)
        if not cached_pdf:
            return None
        return cached_pdf.pdf_bytes


async def _cache_recent_rendered_pdf(cache_key: str, pdf_bytes: bytes) -> None:
    async with _rendered_pdf_cache_lock:
        _prune_recent_rendered_pdfs_locked()
        _recent_rendered_pdf_by_key[cache_key] = RecentRenderedPdf(
            pdf_bytes=pdf_bytes,
            expires_at_monotonic=time.monotonic() + RECENT_RENDERED_PDF_TTL_SECONDS,
        )


def _cleanup_rendered_pdf_task(cache_key: str, task: asyncio.Task[bytes]) -> None:
    if _rendered_pdf_tasks_by_key.get(cache_key) is task:
        _rendered_pdf_tasks_by_key.pop(cache_key, None)


async def _get_or_create_rendered_pdf_task(
    cache_key: str,
    render_pdf: Callable[[], Awaitable[bytes]],
) -> asyncio.Task[bytes]:
    async with _rendered_pdf_cache_lock:
        existing_task = _rendered_pdf_tasks_by_key.get(cache_key)
        if existing_task is not None:
            return existing_task

        task = asyncio.create_task(render_pdf())
        task.add_done_callback(
            lambda completed_task, key=cache_key: _cleanup_rendered_pdf_task(key, completed_task)
        )
        _rendered_pdf_tasks_by_key[cache_key] = task
        return task


async def _render_snapshot_pdf_response(
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot | ExperienceBankPdfRenderSnapshot,
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    record, token = await create_render_snapshot(session, user_id, snapshot)

    try:
        pdf_bytes = await renderer(str(record.id), token)
    except BrowserPdfRenderTimeoutError as exc:
        raise HTTPException(status_code=HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except BrowserPdfRenderError as exc:
        raise HTTPException(status_code=HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    await mark_render_snapshot_consumed(session, record)
    return _build_pdf_download_response(pdf_bytes, file_name)


def _build_download_url(
    request: Request,
    route_name: str,
    snapshot_id: str,
    token: str,
    file_name: str | None,
) -> str:
    path = request.app.url_path_for(route_name, snapshot_id=snapshot_id)
    query = urlencode(
        {
            "token": token,
            "fileName": _sanitize_download_filename(file_name),
        }
    )
    return f"{path}?{query}"


async def _create_download_link_response(
    request: Request,
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot | ExperienceBankPdfRenderSnapshot,
    file_name: str | None,
    route_name: str,
) -> ExportDownloadLinkRead:
    record, token = await create_render_snapshot(session, user_id, snapshot)
    sanitized_file_name = _sanitize_download_filename(file_name)
    return ExportDownloadLinkRead(
        downloadUrl=_build_download_url(
            request,
            route_name,
            str(record.id),
            token,
            sanitized_file_name,
        ),
        fileName=sanitized_file_name,
    )


async def _render_snapshot_pdf_download_response(
    snapshot_id: str,
    token: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    cache_key = _build_rendered_pdf_cache_key(snapshot_id, token)
    cached_pdf = await _get_recent_rendered_pdf(cache_key)
    if cached_pdf is not None:
        return _build_pdf_download_response(cached_pdf, file_name)

    async def render_pdf() -> bytes:
        async with AsyncSessionFactory() as task_session:
            try:
                record, _ = await get_render_snapshot_by_token(
                    task_session,
                    snapshot_id,
                    token,
                    snapshot_model,
                )
            except SnapshotTokenError as exc:
                raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail=str(exc)) from exc
            except SnapshotConsumedError as exc:
                raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
            except SnapshotExpiredError as exc:
                raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
            except SnapshotPayloadError as exc:
                raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
            except SnapshotNotFoundError as exc:
                raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc

            try:
                pdf_bytes = await renderer(str(record.id), token)
            except BrowserPdfRenderTimeoutError as exc:
                raise HTTPException(status_code=HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
            except BrowserPdfRenderError as exc:
                raise HTTPException(status_code=HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

            await mark_render_snapshot_consumed(task_session, record)
            await _cache_recent_rendered_pdf(cache_key, pdf_bytes)
            return pdf_bytes

    render_task = await _get_or_create_rendered_pdf_task(cache_key, render_pdf)

    pdf_bytes = await asyncio.shield(render_task)

    return _build_pdf_download_response(pdf_bytes, file_name)


async def _parse_export_request(
    request: Request,
    model_type: type[ExportRequestModelT],
) -> ExportRequestModelT:
    raw_body = await request.body()
    content_type = request.headers.get("content-type", "")
    content_encoding = request.headers.get("content-encoding", "")

    if not raw_body:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="导出请求体为空。",
        )

    body_bytes = raw_body
    normalized_content_encoding = content_encoding.lower().strip()
    if normalized_content_encoding in {"gzip", "x-gzip"}:
        try:
            body_bytes = zlib.decompress(raw_body, zlib.MAX_WBITS | 16)
        except zlib.error as exc:
            logger.warning(
                "[Export] Failed to decompress gzip body path=%s content_type=%s content_length=%s",
                request.url.path,
                content_type,
                len(raw_body),
            )
            raise HTTPException(
                status_code=HTTP_400_BAD_REQUEST,
                detail="导出请求体 gzip 解压失败。",
            ) from exc

    try:
        payload = json.loads(body_bytes)
    except UnicodeDecodeError as exc:
        logger.warning(
            "[Export] Body decode failed path=%s content_type=%s content_encoding=%s pos=%s content_length=%s",
            request.url.path,
            content_type,
            content_encoding,
            exc.start,
            len(body_bytes),
        )
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="导出请求体编码无法识别，请确认请求以 UTF-8 JSON 发送。",
        ) from exc
    except json.JSONDecodeError as exc:
        logger.warning(
            "[Export] Invalid JSON request path=%s content_type=%s content_encoding=%s pos=%s content_length=%s",
            request.url.path,
            content_type,
            content_encoding,
            exc.pos,
            len(body_bytes),
        )
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail=f"导出请求体不是合法 JSON：{exc.msg}",
        ) from exc

    try:
        return model_type.model_validate(payload)
    except ValidationError as exc:
        sanitized_errors = _build_sanitized_validation_errors(exc)
        logger.warning(
            "[Export] Validation failed path=%s errors=%s",
            request.url.path,
            sanitized_errors,
        )
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail={
                "message": "导出请求体字段不合法。",
                "errors": sanitized_errors,
            },
        ) from exc


@router.post(
    "/resume-pdf",
    openapi_extra=_build_export_request_openapi("ResumePdfExportRequest"),
)
async def export_resume_pdf(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    payload = await _parse_export_request(request, ResumePdfExportRequest)
    return await _render_snapshot_pdf_response(
        session,
        current_user.id,
        payload.snapshot,
        render_resume_pdf,
        payload.fileName or payload.snapshot.resumeName,
    )


@router.post(
    "/resume-pdf-link",
    response_model=ExportDownloadLinkRead,
    openapi_extra=_build_export_request_openapi("ResumePdfExportRequest"),
)
async def create_resume_pdf_download_link(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    payload = await _parse_export_request(request, ResumePdfExportRequest)
    return await _create_download_link_response(
        request,
        session,
        current_user.id,
        payload.snapshot,
        payload.fileName or payload.snapshot.resumeName,
        "download_resume_pdf",
    )


@router.post(
    "/experience-bank-pdf",
    openapi_extra=_build_export_request_openapi("ExperienceBankPdfExportRequest"),
)
async def export_experience_bank_pdf(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    payload = await _parse_export_request(request, ExperienceBankPdfExportRequest)
    return await _render_snapshot_pdf_response(
        session,
        current_user.id,
        payload.snapshot,
        render_experience_bank_pdf,
        payload.fileName or "experience-bank-export",
    )


@router.post(
    "/experience-bank-pdf-link",
    response_model=ExportDownloadLinkRead,
    openapi_extra=_build_export_request_openapi("ExperienceBankPdfExportRequest"),
)
async def create_experience_bank_pdf_download_link(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    payload = await _parse_export_request(request, ExperienceBankPdfExportRequest)
    return await _create_download_link_response(
        request,
        session,
        current_user.id,
        payload.snapshot,
        payload.fileName or "experience-bank-export",
        "download_experience_bank_pdf",
    )


@router.get("/download/resume-pdf/{snapshot_id}", name="download_resume_pdf")
async def download_resume_pdf(
    snapshot_id: str,
    token: str = Query(..., min_length=1),
    fileName: str | None = Query(default=None),
):
    return await _render_snapshot_pdf_download_response(
        snapshot_id,
        token,
        ResumePdfRenderSnapshot,
        render_resume_pdf,
        fileName,
    )


@router.get(
    "/download/experience-bank-pdf/{snapshot_id}",
    name="download_experience_bank_pdf",
)
async def download_experience_bank_pdf(
    snapshot_id: str,
    token: str = Query(..., min_length=1),
    fileName: str | None = Query(default=None),
):
    return await _render_snapshot_pdf_download_response(
        snapshot_id,
        token,
        ExperienceBankPdfRenderSnapshot,
        render_experience_bank_pdf,
        fileName,
    )


@router.get("/render-snapshots/{snapshot_id}", response_model=RenderSnapshotRead)
async def get_render_snapshot(
    snapshot_id: str,
    token: str = Query(..., min_length=1),
    session: AsyncSession = Depends(get_session),
):
    try:
        _, snapshot = await get_render_snapshot_by_token(
            session,
            snapshot_id,
            token,
            ResumePdfRenderSnapshot,
        )
    except SnapshotTokenError as exc:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except SnapshotConsumedError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotExpiredError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotPayloadError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return RenderSnapshotRead(snapshot=snapshot)


@router.get(
    "/experience-bank-render-snapshots/{snapshot_id}",
    response_model=ExperienceBankRenderSnapshotRead,
)
async def get_experience_bank_render_snapshot(
    snapshot_id: str,
    token: str = Query(..., min_length=1),
    session: AsyncSession = Depends(get_session),
):
    try:
        _, snapshot = await get_render_snapshot_by_token(
            session,
            snapshot_id,
            token,
            ExperienceBankPdfRenderSnapshot,
        )
    except SnapshotTokenError as exc:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except SnapshotConsumedError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotExpiredError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotPayloadError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return ExperienceBankRenderSnapshotRead(snapshot=snapshot)
