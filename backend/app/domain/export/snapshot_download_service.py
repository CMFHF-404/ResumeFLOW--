from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
import logging

from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import (
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
    HTTP_409_CONFLICT,
    HTTP_410_GONE,
    HTTP_429_TOO_MANY_REQUESTS,
    HTTP_502_BAD_GATEWAY,
    HTTP_504_GATEWAY_TIMEOUT,
)

from ...database import AsyncSessionFactory
from .browser_pdf_service import BrowserPdfRenderError, BrowserPdfRenderTimeoutError
from .download_http import (
    _build_pdf_download_response,
    _enforce_snapshot_page_constraint,
    _get_persisted_rendered_pdf,
    _snapshot_http_exception,
)
from .schemas import ExperienceBankPdfRenderSnapshot, ResumePdfRenderSnapshot
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

logger = logging.getLogger(__name__)
RECENT_RENDERED_PDF_TTL_SECONDS = DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS
RENDER_CLAIM_LEASE_SECONDS = DEFAULT_RENDER_CLAIM_LEASE_SECONDS
RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS = 20


@dataclass(frozen=True)
class SnapshotDownloadOperations:
    """Per-request dependencies; the service never needs to import a router."""

    session_factory: Callable
    create_render_snapshot: Callable[..., Awaitable]
    claim_render_snapshot_by_owner: Callable[..., Awaitable]
    claim_render_snapshot_by_token: Callable[..., Awaitable]
    delete_temporary_render_snapshot: Callable[..., Awaitable]
    finalize_render_snapshot_claim: Callable[..., Awaitable]
    get_render_snapshot_by_owner: Callable[..., Awaitable]
    get_render_snapshot_by_token: Callable[..., Awaitable]
    release_render_snapshot_claim: Callable[..., Awaitable]
    renew_render_snapshot_claim: Callable[..., Awaitable]
    build_render_snapshot_token: Callable
    recent_rendered_pdf_ttl_seconds: int
    render_claim_lease_seconds: int
    render_claim_heartbeat_interval_seconds: int


def default_download_operations() -> SnapshotDownloadOperations:
    return SnapshotDownloadOperations(
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
    *,
    operations: SnapshotDownloadOperations | None = None,
    render_claim: Callable[..., Awaitable] | None = None,
):
    operations = operations or default_download_operations()
    render_claim = render_claim or partial(_render_and_finalize_claimed_snapshot, operations=operations)
    record = None
    claim_id = None
    try:
        try:
            record, token = await operations.create_render_snapshot(session, user_id, snapshot)
            claim, _, claim_id = await operations.claim_render_snapshot_by_owner(
                session,
                str(record.id),
                user_id,
                type(snapshot),
                lease_seconds=operations.render_claim_lease_seconds,
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

        pdf_bytes = await render_claim(
            claim,
            claim_id,
            token,
            renderer,
            persistence_session=session,
            snapshot=snapshot,
        )
        return _build_pdf_download_response(pdf_bytes, file_name)
    finally:
        if record is not None:
            try:
                await operations.delete_temporary_render_snapshot(
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
    operations: SnapshotDownloadOperations | None = None,
) -> None:
    operations = operations or default_download_operations()
    try:
        if persistence_session is not None:
            await operations.release_render_snapshot_claim(
                persistence_session,
                snapshot_id,
                claim_id,
            )
            return
        async with operations.session_factory() as release_session:
            await operations.release_render_snapshot_claim(
                release_session,
                snapshot_id,
                claim_id,
            )
    except Exception:
        logger.exception("Failed to release export render snapshot claim.")


async def _renew_render_claim_until_cancelled(
    snapshot_id: str,
    claim_id,
    *,
    operations: SnapshotDownloadOperations | None = None,
) -> None:
    operations = operations or default_download_operations()
    while True:
        await asyncio.sleep(operations.render_claim_heartbeat_interval_seconds)
        async with operations.session_factory() as heartbeat_session:
            await operations.renew_render_snapshot_claim(
                heartbeat_session,
                snapshot_id,
                claim_id,
                lease_seconds=operations.render_claim_lease_seconds,
            )


async def _render_with_claim_heartbeat(
    record,
    claim_id,
    token: str,
    renderer: Callable[[str, str], Awaitable[bytes]],
    *,
    operations: SnapshotDownloadOperations | None = None,
    renew_claim: Callable[..., Awaitable] | None = None,
) -> bytes:
    operations = operations or default_download_operations()
    renew_claim = renew_claim or partial(_renew_render_claim_until_cancelled, operations=operations)
    render_task = asyncio.create_task(renderer(str(record.id), token))
    heartbeat_task = asyncio.create_task(
        renew_claim(str(record.id), claim_id)
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
    snapshot=None,
    operations: SnapshotDownloadOperations | None = None,
    render_pdf: Callable[..., Awaitable] | None = None,
    release_claim: Callable[..., Awaitable] | None = None,
) -> bytes:
    operations = operations or default_download_operations()
    render_pdf = render_pdf or partial(_render_with_claim_heartbeat, operations=operations)
    release_claim = release_claim or partial(_release_claim_without_masking_error, operations=operations)
    try:
        pdf_bytes = await render_pdf(
            record,
            claim_id,
            token,
            renderer,
        )
        _enforce_snapshot_page_constraint(pdf_bytes, snapshot)
        if persistence_session is not None:
            await operations.finalize_render_snapshot_claim(
                persistence_session,
                str(record.id),
                claim_id,
                pdf_bytes,
                retry_ttl_seconds=operations.recent_rendered_pdf_ttl_seconds,
            )
        else:
            async with operations.session_factory() as finalize_session:
                await operations.finalize_render_snapshot_claim(
                    finalize_session,
                    str(record.id),
                    claim_id,
                    pdf_bytes,
                    retry_ttl_seconds=operations.recent_rendered_pdf_ttl_seconds,
                )
    except BaseException as exc:
        await release_claim(
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


async def render_owned_snapshot_pdf_download_response(
    snapshot_id: str,
    user_id: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
    *,
    operations: SnapshotDownloadOperations | None = None,
    render_claim: Callable[..., Awaitable] | None = None,
):
    operations = operations or default_download_operations()
    render_claim = render_claim or partial(_render_and_finalize_claimed_snapshot, operations=operations)
    async with operations.session_factory() as lookup_session:
        try:
            lookup_record, lookup_snapshot = await operations.get_render_snapshot_by_owner(
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
        _enforce_snapshot_page_constraint(persisted_pdf, lookup_snapshot)
        return _build_pdf_download_response(persisted_pdf, resolved_file_name)
    if lookup_record.consumed_at is not None:
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            "导出快照已失效，请重新导出。",
        )

    claim_consumed_error: SnapshotConsumedError | None = None
    async with operations.session_factory() as claim_session:
        try:
            record, _, claim_id = await operations.claim_render_snapshot_by_owner(
                claim_session,
                snapshot_id,
                user_id,
                snapshot_model,
                lease_seconds=operations.render_claim_lease_seconds,
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
        async with operations.session_factory() as recovery_session:
            try:
                recovery_record, recovery_snapshot = await operations.get_render_snapshot_by_owner(
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
            _enforce_snapshot_page_constraint(recovered_pdf, recovery_snapshot)
            return _build_pdf_download_response(recovered_pdf, resolved_file_name)
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            str(claim_consumed_error),
        ) from claim_consumed_error

    token = operations.build_render_snapshot_token(record)
    pdf_bytes = await render_claim(
        record,
        claim_id,
        token,
        renderer,
        snapshot=lookup_snapshot,
    )

    return _build_pdf_download_response(pdf_bytes, resolved_file_name)


async def render_legacy_snapshot_pdf_download_response(
    snapshot_id: str,
    token: str,
    snapshot_model: type[ResumePdfRenderSnapshot] | type[ExperienceBankPdfRenderSnapshot],
    renderer: Callable[[str, str], Awaitable[bytes]],
    file_name: str | None,
    *,
    operations: SnapshotDownloadOperations | None = None,
    render_claim: Callable[..., Awaitable] | None = None,
):
    operations = operations or default_download_operations()
    render_claim = render_claim or partial(_render_and_finalize_claimed_snapshot, operations=operations)
    async with operations.session_factory() as lookup_session:
        try:
            lookup_record, lookup_snapshot = await operations.get_render_snapshot_by_token(
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
        _enforce_snapshot_page_constraint(persisted_pdf, lookup_snapshot)
        return _build_pdf_download_response(persisted_pdf, resolved_file_name)
    if lookup_record.consumed_at is not None:
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            "导出快照已失效，请重新导出。",
        )

    claim_consumed_error: SnapshotConsumedError | None = None
    async with operations.session_factory() as claim_session:
        try:
            record, _, claim_id = await operations.claim_render_snapshot_by_token(
                claim_session,
                snapshot_id,
                token,
                snapshot_model,
                lease_seconds=operations.render_claim_lease_seconds,
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
        async with operations.session_factory() as recovery_session:
            try:
                recovery_record, recovery_snapshot = await operations.get_render_snapshot_by_token(
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
            _enforce_snapshot_page_constraint(recovered_pdf, recovery_snapshot)
            return _build_pdf_download_response(recovered_pdf, resolved_file_name)
        raise _snapshot_http_exception(
            HTTP_410_GONE,
            str(claim_consumed_error),
        ) from claim_consumed_error

    pdf_bytes = await render_claim(
        record,
        claim_id,
        token,
        renderer,
        snapshot=lookup_snapshot,
    )
    return _build_pdf_download_response(pdf_bytes, resolved_file_name)
