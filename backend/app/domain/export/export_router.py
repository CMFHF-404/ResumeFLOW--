from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
import hmac
import json
import logging
import math
import os
import re
import unicodedata
import zlib
from typing import TypeVar
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, ValidationError
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_409_CONFLICT,
    HTTP_410_GONE,
    HTTP_400_BAD_REQUEST,
    HTTP_413_REQUEST_ENTITY_TOO_LARGE,
    HTTP_429_TOO_MANY_REQUESTS,
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
from .download_contract import (
    EXPORT_MODE_HEADER,
    ExportModeError,
    MAX_EXPORT_FILE_NAME_CHARACTERS,
    MAX_EXPORT_FILE_NAME_ENCODED_CHARACTERS,
    build_versioned_download_url,
    limit_export_file_name,
    resolve_export_mode,
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
from .pdf_payload import RenderedPdfValidationError, validate_rendered_pdf_bytes
from .snapshot_service import (
    DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
    DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS,
    SnapshotClaimedError,
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
SNAPSHOT_BEARER_PREFIX = "Bearer "
# Export snapshots can contain an encoded avatar, so retain practical headroom while
# bounding both network input and gzip expansion independently.
MAX_EXPORT_REQUEST_BODY_BYTES = 8 * 1024 * 1024
MAX_EXPORT_DECOMPRESSED_BODY_BYTES = 16 * 1024 * 1024
EXPORT_NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
}
PDF_DOWNLOAD_RESPONSES = {
    200: {
        "description": "PDF download",
        "content": {
            "application/pdf": {
                "schema": {"type": "string", "format": "binary"},
            }
        },
    }
}


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


def _set_no_store_headers(response: Response) -> None:
    response.headers.update(EXPORT_NO_STORE_HEADERS)


def _with_no_store_headers(exc: HTTPException) -> HTTPException:
    headers = dict(exc.headers or {})
    headers.update(EXPORT_NO_STORE_HEADERS)
    exc.headers = headers
    return exc


def _snapshot_http_exception(status_code: int, detail: str) -> HTTPException:
    headers = dict(EXPORT_NO_STORE_HEADERS)
    if status_code == HTTP_429_TOO_MANY_REQUESTS:
        headers["Retry-After"] = "60"
    return HTTPException(
        status_code=status_code,
        detail=detail,
        headers=headers,
    )


def _read_export_mode(request: Request) -> str:
    request_headers = getattr(request, "headers", None)
    header_values = (
        request_headers.getlist(EXPORT_MODE_HEADER)
        if request_headers is not None and hasattr(request_headers, "getlist")
        else []
    )
    try:
        return resolve_export_mode(header_values)
    except ExportModeError as exc:
        raise HTTPException(status_code=HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _read_snapshot_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith(SNAPSHOT_BEARER_PREFIX):
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    token = authorization[len(SNAPSHOT_BEARER_PREFIX) :].strip()
    if not token or len(token) > MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    return token


def _read_snapshot_access_token(
    request: Request,
    authorization: str | None,
) -> str:
    query_tokens = request.query_params.getlist("token")
    if len(query_tokens) > 1:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )

    query_token = query_tokens[0].strip() if query_tokens else ""
    if len(query_token) > MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    header_token = (
        _read_snapshot_bearer_token(authorization)
        if authorization is not None
        else ""
    )
    if header_token and query_token and not hmac.compare_digest(header_token, query_token):
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌冲突。",
        )

    token = header_token or query_token
    if not token:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    return token


def _read_legacy_download_token(request: Request, token: str | None) -> str | None:
    query_tokens = request.query_params.getlist("token")
    if len(query_tokens) > 1:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    if token is None or not token.strip():
        return None
    resolved_token = token.strip()
    if len(resolved_token) > MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS:
        raise _snapshot_http_exception(
            HTTP_403_FORBIDDEN,
            "导出快照令牌无效。",
        )
    return resolved_token


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
    sanitized = "".join(
        char
        for char in base_name
        if char not in forbidden_chars and ord(char) >= 32 and ord(char) != 127
    ).strip()
    if not sanitized:
        sanitized = "resume-export"
    has_pdf_extension = sanitized.lower().endswith(".pdf")
    extension = sanitized[-4:] if has_pdf_extension else ".pdf"
    stem = sanitized[:-4] if has_pdf_extension else sanitized
    max_stem_length = MAX_EXPORT_FILE_NAME_CHARACTERS - len(extension)
    bounded_stem = limit_export_file_name(stem)[:max_stem_length].rstrip()
    if not bounded_stem:
        bounded_stem = "resume-export"
    return f"{bounded_stem}{extension}"


def _decode_download_filename_header(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return unquote(value)
    except (UnicodeDecodeError, ValueError):
        return value


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
    try:
        validated_pdf = validate_rendered_pdf_bytes(pdf_bytes)
    except RenderedPdfValidationError as exc:
        raise _snapshot_http_exception(
            HTTP_502_BAD_GATEWAY,
            "PDF 导出结果无效。",
        ) from exc
    sanitized_file_name = _sanitize_download_filename(file_name)
    ascii_file_name = _build_ascii_download_filename(sanitized_file_name)
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_file_name}"; '
            f"filename*=UTF-8''{quote(sanitized_file_name)}"
        ),
        **EXPORT_NO_STORE_HEADERS,
    }
    return Response(content=validated_pdf, media_type="application/pdf", headers=headers)


def _get_persisted_rendered_pdf(record) -> bytes | None:
    pdf_bytes = getattr(record, "rendered_pdf", None)
    expires_at = getattr(record, "rendered_pdf_expires_at", None)
    if pdf_bytes is None or expires_at is None:
        return None
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    else:
        expires_at = expires_at.astimezone(timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    try:
        return validate_rendered_pdf_bytes(pdf_bytes)
    except RenderedPdfValidationError as exc:
        raise _snapshot_http_exception(
            HTTP_502_BAD_GATEWAY,
            "缓存的 PDF 导出结果无效。",
        ) from exc


async def _render_snapshot_pdf_response(
    session: AsyncSession,
    user_id: str,
    snapshot: ResumePdfRenderSnapshot | ExperienceBankPdfRenderSnapshot,
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    record = None
    claim_id = None
    try:
        try:
            record, token = await create_render_snapshot(session, user_id, snapshot)
            claim, _, claim_id = await claim_render_snapshot_by_owner(
                session,
                str(record.id),
                user_id,
                type(snapshot),
                lease_seconds=RENDER_CLAIM_LEASE_SECONDS,
            )
        except SnapshotClaimedError as exc:
            raise _snapshot_http_exception(HTTP_409_CONFLICT, str(exc)) from exc
        except SnapshotCapacityExceededError as exc:
            raise _snapshot_http_exception(
                HTTP_429_TOO_MANY_REQUESTS,
                str(exc),
            ) from exc
        except SnapshotConsumedError as exc:
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        except SnapshotExpiredError as exc:
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        except SnapshotPayloadError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        except SnapshotNotFoundError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

        pdf_bytes = await _render_and_finalize_claimed_snapshot(
            claim,
            claim_id,
            token,
            renderer,
            persistence_session=session,
        )
        return _build_pdf_download_response(pdf_bytes, file_name)
    finally:
        if record is not None:
            try:
                await delete_temporary_render_snapshot(
                    session,
                    str(record.id),
                    user_id,
                    claim_id=claim_id,
                )
            except Exception:
                logger.exception("Failed to delete temporary export render snapshot.")


async def _release_claim_without_masking_error(
    snapshot_id: str,
    claim_id,
    *,
    persistence_session: AsyncSession | None = None,
) -> None:
    try:
        if persistence_session is not None:
            await release_render_snapshot_claim(
                persistence_session,
                snapshot_id,
                claim_id,
            )
            return
        async with AsyncSessionFactory() as release_session:
            await release_render_snapshot_claim(
                release_session,
                snapshot_id,
                claim_id,
            )
    except Exception:
        logger.exception("Failed to release export render snapshot claim.")


async def _renew_render_claim_until_cancelled(
    snapshot_id: str,
    claim_id,
) -> None:
    while True:
        await asyncio.sleep(RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS)
        async with AsyncSessionFactory() as heartbeat_session:
            await renew_render_snapshot_claim(
                heartbeat_session,
                snapshot_id,
                claim_id,
                lease_seconds=RENDER_CLAIM_LEASE_SECONDS,
            )


async def _render_with_claim_heartbeat(
    record,
    claim_id,
    token: str,
    renderer: Callable[[str, str], Awaitable[bytes]],
) -> bytes:
    render_task = asyncio.create_task(renderer(str(record.id), token))
    heartbeat_task = asyncio.create_task(
        _renew_render_claim_until_cancelled(str(record.id), claim_id)
    )
    tasks = (render_task, heartbeat_task)
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if heartbeat_task in done:
            heartbeat_error = heartbeat_task.exception()
            if heartbeat_error is None:
                raise SnapshotClaimedError("导出快照生成权已失效，请重新导出。")
            raise heartbeat_error
        return await render_task
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _render_and_finalize_claimed_snapshot(
    record,
    claim_id,
    token: str,
    renderer: Callable[[str, str], Awaitable[bytes]],
    *,
    persistence_session: AsyncSession | None = None,
) -> bytes:
    try:
        pdf_bytes = await _render_with_claim_heartbeat(
            record,
            claim_id,
            token,
            renderer,
        )
        if persistence_session is not None:
            await finalize_render_snapshot_claim(
                persistence_session,
                str(record.id),
                claim_id,
                pdf_bytes,
                retry_ttl_seconds=RECENT_RENDERED_PDF_TTL_SECONDS,
            )
        else:
            async with AsyncSessionFactory() as finalize_session:
                await finalize_render_snapshot_claim(
                    finalize_session,
                    str(record.id),
                    claim_id,
                    pdf_bytes,
                    retry_ttl_seconds=RECENT_RENDERED_PDF_TTL_SECONDS,
                )
    except BaseException as exc:
        await _release_claim_without_masking_error(
            str(record.id),
            claim_id,
            persistence_session=persistence_session,
        )
        if isinstance(exc, BrowserPdfRenderTimeoutError):
            raise _snapshot_http_exception(HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc
        if isinstance(exc, BrowserPdfRenderError):
            raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
        if isinstance(exc, SnapshotClaimedError):
            raise _snapshot_http_exception(HTTP_409_CONFLICT, str(exc)) from exc
        if isinstance(exc, SnapshotCapacityExceededError):
            raise _snapshot_http_exception(
                HTTP_429_TOO_MANY_REQUESTS,
                str(exc),
            ) from exc
        if isinstance(exc, SnapshotConsumedError):
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        if isinstance(exc, SnapshotExpiredError):
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        if isinstance(exc, SnapshotNotFoundError):
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        if isinstance(exc, SnapshotRenderedPdfError):
            raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
        raise
    return pdf_bytes


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
    async with AsyncSessionFactory() as lookup_session:
        try:
            lookup_record, lookup_snapshot = await get_render_snapshot_by_owner(
                lookup_session,
                snapshot_id,
                user_id,
                snapshot_model,
                allow_consumed=True,
            )
        except SnapshotExpiredError as exc:
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        except SnapshotRenderedPdfError as exc:
            raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
        except SnapshotPayloadError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        except SnapshotNotFoundError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

    resolved_file_name = file_name or getattr(lookup_snapshot, "resumeName", None)
    persisted_pdf = _get_persisted_rendered_pdf(lookup_record)
    if persisted_pdf is not None:
        return _build_pdf_download_response(persisted_pdf, resolved_file_name)
    if lookup_record.consumed_at is not None:
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            "导出快照已失效，请重新导出。",
        )

    claim_consumed_error: SnapshotConsumedError | None = None
    async with AsyncSessionFactory() as claim_session:
        try:
            record, _, claim_id = await claim_render_snapshot_by_owner(
                claim_session,
                snapshot_id,
                user_id,
                snapshot_model,
                lease_seconds=RENDER_CLAIM_LEASE_SECONDS,
            )
        except SnapshotClaimedError as exc:
            raise _snapshot_http_exception(HTTP_409_CONFLICT, str(exc)) from exc
        except SnapshotCapacityExceededError as exc:
            raise _snapshot_http_exception(
                HTTP_429_TOO_MANY_REQUESTS,
                str(exc),
            ) from exc
        except SnapshotConsumedError as exc:
            claim_consumed_error = exc
        except SnapshotExpiredError as exc:
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        except SnapshotPayloadError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        except SnapshotNotFoundError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

    if claim_consumed_error is not None:
        async with AsyncSessionFactory() as recovery_session:
            try:
                recovery_record, _ = await get_render_snapshot_by_owner(
                    recovery_session,
                    snapshot_id,
                    user_id,
                    snapshot_model,
                    allow_consumed=True,
                )
            except SnapshotExpiredError as exc:
                raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
            except SnapshotRenderedPdfError as exc:
                raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
            except SnapshotPayloadError as exc:
                raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
            except SnapshotNotFoundError as exc:
                raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        recovered_pdf = _get_persisted_rendered_pdf(recovery_record)
        if recovered_pdf is not None:
            return _build_pdf_download_response(recovered_pdf, resolved_file_name)
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            str(claim_consumed_error),
        ) from claim_consumed_error

    token = build_render_snapshot_token(record)
    pdf_bytes = await _render_and_finalize_claimed_snapshot(
        record,
        claim_id,
        token,
        renderer,
    )

    return _build_pdf_download_response(pdf_bytes, resolved_file_name)


async def render_legacy_snapshot_pdf_download_response(
    snapshot_id: str,
    token: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
):
    async with AsyncSessionFactory() as lookup_session:
        try:
            lookup_record, lookup_snapshot = await get_render_snapshot_by_token(
                lookup_session,
                snapshot_id,
                token,
                snapshot_model,
                allow_consumed=True,
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

    resolved_file_name = file_name or getattr(lookup_snapshot, "resumeName", None)
    persisted_pdf = _get_persisted_rendered_pdf(lookup_record)
    if persisted_pdf is not None:
        return _build_pdf_download_response(persisted_pdf, resolved_file_name)
    if lookup_record.consumed_at is not None:
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            "导出快照已失效，请重新导出。",
        )

    claim_consumed_error: SnapshotConsumedError | None = None
    async with AsyncSessionFactory() as claim_session:
        try:
            record, _, claim_id = await claim_render_snapshot_by_token(
                claim_session,
                snapshot_id,
                token,
                snapshot_model,
                lease_seconds=RENDER_CLAIM_LEASE_SECONDS,
            )
        except SnapshotClaimedError as exc:
            raise _snapshot_http_exception(HTTP_409_CONFLICT, str(exc)) from exc
        except SnapshotCapacityExceededError as exc:
            raise _snapshot_http_exception(
                HTTP_429_TOO_MANY_REQUESTS,
                str(exc),
            ) from exc
        except SnapshotTokenError as exc:
            raise _snapshot_http_exception(HTTP_403_FORBIDDEN, str(exc)) from exc
        except SnapshotConsumedError as exc:
            claim_consumed_error = exc
        except SnapshotExpiredError as exc:
            raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
        except SnapshotPayloadError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        except SnapshotNotFoundError as exc:
            raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc

    if claim_consumed_error is not None:
        async with AsyncSessionFactory() as recovery_session:
            try:
                recovery_record, _ = await get_render_snapshot_by_token(
                    recovery_session,
                    snapshot_id,
                    token,
                    snapshot_model,
                    allow_consumed=True,
                )
            except SnapshotTokenError as exc:
                raise _snapshot_http_exception(HTTP_403_FORBIDDEN, str(exc)) from exc
            except SnapshotExpiredError as exc:
                raise _snapshot_http_exception(HTTP_410_GONE, str(exc)) from exc
            except SnapshotRenderedPdfError as exc:
                raise _snapshot_http_exception(HTTP_502_BAD_GATEWAY, str(exc)) from exc
            except SnapshotPayloadError as exc:
                raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
            except SnapshotNotFoundError as exc:
                raise _snapshot_http_exception(HTTP_404_NOT_FOUND, str(exc)) from exc
        recovered_pdf = _get_persisted_rendered_pdf(recovery_record)
        if recovered_pdf is not None:
            return _build_pdf_download_response(recovered_pdf, resolved_file_name)
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            str(claim_consumed_error),
        ) from claim_consumed_error

    pdf_bytes = await _render_and_finalize_claimed_snapshot(
        record,
        claim_id,
        token,
        renderer,
    )
    return _build_pdf_download_response(pdf_bytes, resolved_file_name)


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
