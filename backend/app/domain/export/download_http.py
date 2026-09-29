from __future__ import annotations

from datetime import datetime, timezone
import hmac
import os
import re
import unicodedata
from urllib.parse import quote, unquote

from fastapi import HTTPException, Request, Response
from starlette.status import (
    HTTP_400_BAD_REQUEST,
    HTTP_403_FORBIDDEN,
    HTTP_429_TOO_MANY_REQUESTS,
    HTTP_502_BAD_GATEWAY,
)

from .download_contract import (
    EXPORT_MODE_HEADER,
    ExportModeError,
    MAX_EXPORT_FILE_NAME_CHARACTERS,
    limit_export_file_name,
    resolve_export_mode,
)
from .limits import MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS
from .pdf_payload import (
    RenderedPdfValidationError,
    validate_rendered_pdf_bytes,
)

SNAPSHOT_BEARER_PREFIX = "Bearer "

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
