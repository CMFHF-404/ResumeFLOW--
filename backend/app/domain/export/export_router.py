from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_410_GONE,
    HTTP_502_BAD_GATEWAY,
    HTTP_504_GATEWAY_TIMEOUT,
)

from ...database import get_session
from ...dependencies import get_current_user
from .browser_pdf_service import (
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
    render_resume_pdf,
)
from .schemas import RenderSnapshotRead, ResumePdfExportRequest
from .snapshot_service import (
    SnapshotConsumedError,
    SnapshotExpiredError,
    SnapshotNotFoundError,
    SnapshotTokenError,
    create_render_snapshot,
    get_render_snapshot_by_token,
    mark_render_snapshot_consumed,
)

router = APIRouter(prefix="/exports", tags=["exports"])


def _sanitize_download_filename(value: str | None) -> str:
    base_name = (value or "resume-export").strip() or "resume-export"
    forbidden_chars = '/\\:*?"<>|'
    sanitized = "".join(char for char in base_name if char not in forbidden_chars).strip()
    if not sanitized:
        sanitized = "resume-export"
    if not sanitized.lower().endswith(".pdf"):
        sanitized = f"{sanitized}.pdf"
    return sanitized


@router.post("/resume-pdf")
async def export_resume_pdf(
    payload: ResumePdfExportRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    record, token = await create_render_snapshot(session, current_user.id, payload.snapshot)

    try:
        pdf_bytes = await render_resume_pdf(str(record.id), token)
    except BrowserPdfRenderTimeoutError as exc:
        raise HTTPException(status_code=HTTP_504_GATEWAY_TIMEOUT, detail=str(exc)) from exc
    except BrowserPdfRenderError as exc:
        raise HTTPException(status_code=HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    await mark_render_snapshot_consumed(session, record)

    file_name = _sanitize_download_filename(payload.fileName or payload.snapshot.resumeName)
    headers = {
        "Content-Disposition": (
            'attachment; filename="resume-export.pdf"; '
            f"filename*=UTF-8''{quote(file_name)}"
        ),
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.get("/render-snapshots/{snapshot_id}", response_model=RenderSnapshotRead)
async def get_render_snapshot(
    snapshot_id: str,
    token: str = Query(..., min_length=1),
    session: AsyncSession = Depends(get_session),
):
    try:
        _, snapshot = await get_render_snapshot_by_token(session, snapshot_id, token)
    except SnapshotTokenError as exc:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except SnapshotConsumedError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotExpiredError as exc:
        raise HTTPException(status_code=HTTP_410_GONE, detail=str(exc)) from exc
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return RenderSnapshotRead(snapshot=snapshot)
