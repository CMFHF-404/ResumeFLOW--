from __future__ import annotations

from collections.abc import Awaitable, Callable
import json
import logging
import math
import zlib
from typing import TypeVar

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, ValidationError
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_410_GONE,
    HTTP_400_BAD_REQUEST,
    HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    HTTP_429_TOO_MANY_REQUESTS,
    HTTP_502_BAD_GATEWAY,
)

from ...database import AsyncSessionFactory, get_session
from ...dependencies import get_current_user
from . import snapshot_download_service
from .download_http import (
    SNAPSHOT_BEARER_PREFIX as SNAPSHOT_BEARER_PREFIX,
    EXPORT_NO_STORE_HEADERS as EXPORT_NO_STORE_HEADERS,
    PDF_DOWNLOAD_RESPONSES as PDF_DOWNLOAD_RESPONSES,
    _set_no_store_headers as _set_no_store_headers,
    _with_no_store_headers as _with_no_store_headers,
    _snapshot_http_exception as _snapshot_http_exception,
    _read_export_mode as _read_export_mode,
    _read_snapshot_bearer_token as _read_snapshot_bearer_token,
    _read_snapshot_access_token as _read_snapshot_access_token,
    _read_legacy_download_token as _read_legacy_download_token,
    _sanitize_download_filename as _sanitize_download_filename,
    _decode_download_filename_header as _decode_download_filename_header,
    _build_ascii_download_filename as _build_ascii_download_filename,
    _build_pdf_download_response as _build_pdf_download_response,
    _get_persisted_rendered_pdf as _get_persisted_rendered_pdf,
)
from .browser_pdf_service import (
    BrowserPdfRenderError as BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError as BrowserPdfRenderTimeoutError,
    render_experience_bank_pdf,
    render_resume_pdf,
)
from .download_contract import (
    EXPORT_MODE_HEADER,
    MAX_EXPORT_FILE_NAME_CHARACTERS,
    MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
    build_versioned_download_url,
)
from .limits import MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS
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
    DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
    DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS,
    SnapshotCapacityExceededError,
    SnapshotConsumedError,
    SnapshotExpiredError,
    SnapshotNotFoundError,
    SnapshotPayloadError,
    SnapshotRenderedPdfError,
    SnapshotTokenError,
    build_render_snapshot_token,
    claim_render_snapshot_by_owner,
    claim_render_snapshot_by_token,
    create_render_snapshot,
    delete_temporary_render_snapshot,
    finalize_render_snapshot_claim,
    get_render_snapshot_by_owner,
    get_render_snapshot_by_token,
    release_render_snapshot_claim,
    renew_render_snapshot_claim,
)

router = APIRouter(prefix="/exports", tags=["exports"])
logger = logging.getLogger(__name__)
ExportRequestModelT = TypeVar("ExportRequestModelT", bound=BaseModel)
RECENT_RENDERED_PDF_TTL_SECONDS = DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS
RENDER_CLAIM_LEASE_SECONDS = DEFAULT_RENDER_CLAIM_LEASE_SECONDS
RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS = 20
# Export snapshots can contain an encoded avatar, so retain practical headroom while
# bounding both network input and gzip expansion independently.
MAX_EXPORT_REQUEST_BODY_BYTES = 8 * 1024 * 1024
MAX_EXPORT_DECOMPRESSED_BODY_BYTES = 16 * 1024 * 1024


class _ExportRequestBodyTooLargeError(Exception):
    pass


class _InvalidGzipBodyError(Exception):
    pass


class _InvalidJsonConstantError(ValueError):
    pass


class _InvalidJsonNumberError(ValueError):
    pass


class _InvalidJsonStructureError(ValueError):
    pass


def _reject_non_finite_json_constant(value: str):
    raise _InvalidJsonConstantError(f"non-finite JSON constant: {value}")


def _parse_bounded_json_int(value: str) -> int:
    if len(value) > 128:
        raise _InvalidJsonNumberError("JSON integer is too long")
    return int(value)


def _parse_bounded_json_float(value: str) -> float:
    if len(value) > 128:
        raise _InvalidJsonNumberError("JSON float is too long")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise _InvalidJsonNumberError("JSON float must be finite")
    return parsed


def _validate_json_structure_depth(value: object, *, maximum_depth: int = 128) -> None:
    """Reject pathological JSON nesting without recursive Python calls."""
    pending: list[tuple[object, int]] = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > maximum_depth:
            raise _InvalidJsonStructureError("JSON nesting exceeds the export limit")
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)


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


def _download_operations() -> snapshot_download_service.SnapshotDownloadOperations:
    # Resolve route-local dependency names at call time to retain existing overrides.
    return snapshot_download_service.SnapshotDownloadOperations(
        session_factory=AsyncSessionFactory,
        create_render_snapshot=create_render_snapshot,
        claim_render_snapshot_by_owner=claim_render_snapshot_by_owner,
        claim_render_snapshot_by_token=claim_render_snapshot_by_token,
        delete_temporary_render_snapshot=delete_temporary_render_snapshot,
        finalize_render_snapshot_claim=finalize_render_snapshot_claim,
        get_render_snapshot_by_owner=get_render_snapshot_by_owner,
        get_render_snapshot_by_token=get_render_snapshot_by_token,
        release_render_snapshot_claim=release_render_snapshot_claim,
        renew_render_snapshot_claim=renew_render_snapshot_claim,
        build_render_snapshot_token=build_render_snapshot_token,
        recent_rendered_pdf_ttl_seconds=RECENT_RENDERED_PDF_TTL_SECONDS,
        render_claim_lease_seconds=RENDER_CLAIM_LEASE_SECONDS,
        render_claim_heartbeat_interval_seconds=RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS,
    )


async def _render_snapshot_pdf_response(
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot | ExperienceBankPdfRenderSnapshot,
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    return await snapshot_download_service._render_snapshot_pdf_response(
        session,
        user_id,
        snapshot,
        renderer,
        file_name,
        operations=_download_operations(),
        render_claim=_render_and_finalize_claimed_snapshot,
    )


async def _release_claim_without_masking_error(
    snapshot_id: str,
    claim_id,
    *,
    persistence_session: AsyncSession | None = None,
) -> None:
    return await snapshot_download_service._release_claim_without_masking_error(
        snapshot_id,
        claim_id,
        persistence_session=persistence_session,
        operations=_download_operations(),
    )


async def _renew_render_claim_until_cancelled(
    snapshot_id: str,
    claim_id,
) -> None:
    return await snapshot_download_service._renew_render_claim_until_cancelled(
        snapshot_id,
        claim_id,
        operations=_download_operations(),
    )


async def _render_with_claim_heartbeat(
    record,
    claim_id,
    token: str,
    renderer: Callable[[str, str], Awaitable[bytes]],
) -> bytes:
    return await snapshot_download_service._render_with_claim_heartbeat(
        record,
        claim_id,
        token,
        renderer,
        operations=_download_operations(),
        renew_claim=_renew_render_claim_until_cancelled,
    )


async def _render_and_finalize_claimed_snapshot(
    record,
    claim_id,
    token: str,
    renderer: Callable[[str, str], Awaitable[bytes]],
    *,
    persistence_session: AsyncSession | None = None,
    snapshot=None,
) -> bytes:
    return await snapshot_download_service._render_and_finalize_claimed_snapshot(
        record,
        claim_id,
        token,
        renderer,
        persistence_session=persistence_session,
        snapshot=snapshot,
        operations=_download_operations(),
        render_pdf=_render_with_claim_heartbeat,
        release_claim=_release_claim_without_masking_error,
    )


def _build_download_url(
    request: Request,
    route_name: str,
    snapshot_id: str,
    token: str,
    file_name: str,
    export_mode: str,
) -> str:
    path = request.app.url_path_for(route_name, snapshot_id=snapshot_id)
    return build_versioned_download_url(
        str(path),
        mode=export_mode,
        token=token,
        file_name=file_name,
    )


async def _create_download_link_response(
    request: Request,
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot | ExperienceBankPdfRenderSnapshot,
    file_name: str | None,
    route_name: str,
    export_mode: str,
) -> ExportDownloadLinkRead:
    try:
        record, token = await create_render_snapshot(session, user_id, snapshot)
    except SnapshotCapacityExceededError as exc:
        raise _snapshot_http_exception(
            HTTP_429_TOO_MANY_REQUESTS,
            str(exc),
        ) from exc
    sanitized_file_name = _sanitize_download_filename(file_name)
    return ExportDownloadLinkRead(
        downloadUrl=_build_download_url(
            request,
            route_name,
            str(record.id),
            token,
            sanitized_file_name,
            export_mode,
        ),
        fileName=sanitized_file_name,
    )


async def render_owned_snapshot_pdf_download_response(
    snapshot_id: str,
    user_id: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    return await snapshot_download_service.render_owned_snapshot_pdf_download_response(
        snapshot_id,
        user_id,
        snapshot_model,
        renderer,
        file_name,
        operations=_download_operations(),
        render_claim=_render_and_finalize_claimed_snapshot,
    )


async def render_legacy_snapshot_pdf_download_response(
    snapshot_id: str,
    token: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    return await snapshot_download_service.render_legacy_snapshot_pdf_download_response(
        snapshot_id,
        token,
        snapshot_model,
        renderer,
        file_name,
        operations=_download_operations(),
        render_claim=_render_and_finalize_claimed_snapshot,
    )


async def _read_export_request_body(
    request: Request,
    *,
    gzip_encoded: bool,
) -> tuple[bytes, int]:
    body_parts: list[bytes] = []
    raw_body_size = 0
    decoded_body_size = 0
    decompressor = (
        zlib.decompressobj(zlib.MAX_WBITS | 16) if gzip_encoded else None
    )

    try:
        async for raw_chunk in request.stream():
            if not raw_chunk:
                continue

            raw_body_size += len(raw_chunk)
            if raw_body_size > MAX_EXPORT_REQUEST_BODY_BYTES:
                raise _ExportRequestBodyTooLargeError

            if decompressor is None:
                body_parts.append(raw_chunk)
                continue

            pending = raw_chunk
            while pending:
                remaining_budget = (
                    MAX_EXPORT_DECOMPRESSED_BODY_BYTES - decoded_body_size
                )
                pending_size = len(pending)
                decoded_chunk = decompressor.decompress(
                    pending,
                    remaining_budget + 1,
                )
                pending = decompressor.unconsumed_tail

                if len(decoded_chunk) > remaining_budget:
                    raise _ExportRequestBodyTooLargeError
                if decoded_chunk:
                    body_parts.append(decoded_chunk)
                    decoded_body_size += len(decoded_chunk)
                if decompressor.unused_data:
                    raise _InvalidGzipBodyError
                if pending and len(pending) >= pending_size and not decoded_chunk:
                    raise _InvalidGzipBodyError

        if decompressor is None:
            return b"".join(body_parts), raw_body_size

        if not decompressor.eof or decompressor.unused_data:
            raise _InvalidGzipBodyError

        remaining_budget = MAX_EXPORT_DECOMPRESSED_BODY_BYTES - decoded_body_size
        decoded_tail = decompressor.flush(remaining_budget + 1)
        if len(decoded_tail) > remaining_budget:
            raise _ExportRequestBodyTooLargeError
        if decoded_tail:
            body_parts.append(decoded_tail)

        return b"".join(body_parts), raw_body_size
    except zlib.error as exc:
        raise _InvalidGzipBodyError from exc


async def _parse_export_request(
    request: Request,
    model_type: type[ExportRequestModelT],
) -> ExportRequestModelT:
    content_type = request.headers.get("content-type", "")
    content_encoding = request.headers.get("content-encoding", "")
    normalized_content_encoding = content_encoding.lower().strip()

    try:
        body_bytes, raw_body_size = await _read_export_request_body(
            request,
            gzip_encoded=normalized_content_encoding in {"gzip", "x-gzip"},
        )
    except _ExportRequestBodyTooLargeError as exc:
        logger.warning(
            "[Export] Body too large path=%s content_type=%s content_encoding=%s",
            request.url.path,
            content_type,
            content_encoding,
        )
        raise HTTPException(
            status_code=HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="导出请求体过大。",
        ) from exc
    except _InvalidGzipBodyError as exc:
        logger.warning(
            "[Export] Failed to decompress gzip body path=%s content_type=%s",
            request.url.path,
            content_type,
        )
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="导出请求体 gzip 解压失败。",
        ) from exc

    if raw_body_size == 0:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="导出请求体为空。",
        )

    try:
        payload = json.loads(
            body_bytes,
            parse_constant=_reject_non_finite_json_constant,
            parse_int=_parse_bounded_json_int,
            parse_float=_parse_bounded_json_float,
        )
        _validate_json_structure_depth(payload)
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
    except (
        _InvalidJsonConstantError,
        _InvalidJsonNumberError,
        _InvalidJsonStructureError,
        RecursionError,
    ) as exc:
        logger.warning(
            "[Export] Rejected non-finite or excessively nested JSON path=%s content_type=%s content_encoding=%s content_length=%s",
            request.url.path,
            content_type,
            content_encoding,
            len(body_bytes),
        )
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail="导出请求体不是可安全处理的 JSON。",
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
    response: Response,
    export_mode_header: str | None = Header(
        default=None,
        alias=EXPORT_MODE_HEADER,
        description="Export link contract version. Defaults to legacy-v1.",
    ),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        del export_mode_header  # OpenAPI declaration; duplicate values are read from Request.
        export_mode = _read_export_mode(request)
        payload = await _parse_export_request(request, ResumePdfExportRequest)
        result = await _create_download_link_response(
            request,
            session,
            current_user.id,
            payload.snapshot,
            payload.fileName or payload.snapshot.resumeName,
            "download_resume_pdf",
            export_mode,
        )
    except HTTPException as exc:
        _with_no_store_headers(exc)
        raise
    _set_no_store_headers(response)
    return result


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
    response: Response,
    export_mode_header: str | None = Header(
        default=None,
        alias=EXPORT_MODE_HEADER,
        description="Export link contract version. Defaults to legacy-v1.",
    ),
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    try:
        del export_mode_header  # OpenAPI declaration; duplicate values are read from Request.
        export_mode = _read_export_mode(request)
        payload = await _parse_export_request(request, ExperienceBankPdfExportRequest)
        result = await _create_download_link_response(
            request,
            session,
            current_user.id,
            payload.snapshot,
            payload.fileName or "experience-bank-export",
            "download_experience_bank_pdf",
            export_mode,
        )
    except HTTPException as exc:
        _with_no_store_headers(exc)
        raise
    _set_no_store_headers(response)
    return result


@router.get(
    "/download/resume-pdf/{snapshot_id}",
    name="download_resume_pdf",
    response_class=Response,
    responses=PDF_DOWNLOAD_RESPONSES,
)
async def download_resume_pdf(
    request: Request,
    snapshot_id: str,
    token: str | None = Query(
        default=None,
        max_length=MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
        description="Legacy signed-link compatibility token. New clients use Logto auth.",
        deprecated=True,
    ),
    fileName: str | None = Query(
        default=None,
        max_length=MAX_EXPORT_FILE_NAME_CHARACTERS,
        description="Legacy download filename. New clients use X-ResumeFlow-File-Name.",
        deprecated=True,
    ),
    file_name: str | None = Header(
        default=None,
        alias="X-ResumeFlow-File-Name",
        max_length=MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
    ),
) -> Response:
    legacy_token = _read_legacy_download_token(request, token)
    if legacy_token is not None:
        return await render_legacy_snapshot_pdf_download_response(
            snapshot_id,
            legacy_token,
            ResumePdfRenderSnapshot,
            render_resume_pdf,
            fileName,
        )
    current_user = get_current_user(request)
    return await render_owned_snapshot_pdf_download_response(
        snapshot_id,
        current_user.id,
        ResumePdfRenderSnapshot,
        render_resume_pdf,
        _decode_download_filename_header(file_name),
    )


@router.get(
    "/download/experience-bank-pdf/{snapshot_id}",
    name="download_experience_bank_pdf",
    response_class=Response,
    responses=PDF_DOWNLOAD_RESPONSES,
)
async def download_experience_bank_pdf(
    request: Request,
    snapshot_id: str,
    token: str | None = Query(
        default=None,
        max_length=MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
        description="Legacy signed-link compatibility token. New clients use Logto auth.",
        deprecated=True,
    ),
    fileName: str | None = Query(
        default=None,
        max_length=MAX_EXPORT_FILE_NAME_CHARACTERS,
        description="Legacy download filename. New clients use X-ResumeFlow-File-Name.",
        deprecated=True,
    ),
    file_name: str | None = Header(
        default=None,
        alias="X-ResumeFlow-File-Name",
        max_length=MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
    ),
) -> Response:
    legacy_token = _read_legacy_download_token(request, token)
    if legacy_token is not None:
        return await render_legacy_snapshot_pdf_download_response(
            snapshot_id,
            legacy_token,
            ExperienceBankPdfRenderSnapshot,
            render_experience_bank_pdf,
            fileName,
        )
    current_user = get_current_user(request)
    return await render_owned_snapshot_pdf_download_response(
        snapshot_id,
        current_user.id,
        ExperienceBankPdfRenderSnapshot,
        render_experience_bank_pdf,
        _decode_download_filename_header(file_name),
    )


@router.get("/render-snapshots/{snapshot_id}", response_model=RenderSnapshotRead)
async def get_render_snapshot(
    request: Request,
    snapshot_id: str,
    response: Response,
    authorization: str | None = Header(default=None),
    legacy_token: str | None = Query(
        default=None,
        alias="token",
        max_length=MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
        description="Legacy snapshot token. Internal rendering uses Authorization Bearer.",
        deprecated=True,
    ),
    session: AsyncSession = Depends(get_session),
):
    del legacy_token  # Declared for the compatibility contract and OpenAPI only.
    token = _read_snapshot_access_token(request, authorization)
    try:
        _, snapshot = await get_render_snapshot_by_token(
            session,
            snapshot_id,
            token,
            ResumePdfRenderSnapshot,
        )
    except SnapshotTokenError as exc:
        raise _snapshot_http_exception(HTTP_403_FORBIDDEN, str(exc)) from exc
    except SnapshotConsumedError as exc:
        raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
    except SnapshotExpiredError as exc:
        raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
    except SnapshotRenderedPdfError as exc:
        raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SnapshotPayloadError as exc:
        raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
    except SnapshotNotFoundError as exc:
        raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

    _set_no_store_headers(response)
    return RenderSnapshotRead(snapshot=snapshot)


@router.get(
    "/experience-bank-render-snapshots/{snapshot_id}",
    response_model=ExperienceBankRenderSnapshotRead,
)
async def get_experience_bank_render_snapshot(
    request: Request,
    snapshot_id: str,
    response: Response,
    authorization: str | None = Header(default=None),
    legacy_token: str | None = Query(
        default=None,
        alias="token",
        max_length=MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
        description="Legacy snapshot token. Internal rendering uses Authorization Bearer.",
        deprecated=True,
    ),
    session: AsyncSession = Depends(get_session),
):
    del legacy_token  # Declared for the compatibility contract and OpenAPI only.
    token = _read_snapshot_access_token(request, authorization)
    try:
        _, snapshot = await get_render_snapshot_by_token(
            session,
            snapshot_id,
            token,
            ExperienceBankPdfRenderSnapshot,
        )
    except SnapshotTokenError as exc:
        raise _snapshot_http_exception(HTTP_403_FORBIDDEN, str(exc)) from exc
    except SnapshotConsumedError as exc:
        raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
    except SnapshotExpiredError as exc:
        raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
    except SnapshotRenderedPdfError as exc:
        raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SnapshotPayloadError as exc:
        raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
    except SnapshotNotFoundError as exc:
        raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

    _set_no_store_headers(response)
    return ExperienceBankRenderSnapshotRead(snapshot=snapshot)
