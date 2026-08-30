from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional, Protocol, TypeVar

from jose import ExpiredSignatureError, JWTError, jwt
from pydantic import BaseModel, ValidationError
from sqlalchemy import Text, cast, delete, func, or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import load_settings
from ...models import ExportRenderSnapshot
from ...utils.time_utils import utc_now_aware as _utc_now_aware
from .limits import (
    MAX_ACTIVE_EXPORT_RENDER_CLAIMS_PER_USER,
    MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER,
    MAX_EXPORT_PERSISTED_BYTES_PER_USER,
    MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
    MAX_EXPORT_SNAPSHOT_PAYLOAD_BYTES_PER_USER,
)
from .pdf_payload import RenderedPdfValidationError, validate_rendered_pdf_bytes

TOKEN_ALGORITHM = "HS256"
TOKEN_SCOPE = "export_render_snapshot"
DEFAULT_RENDER_CLAIM_LEASE_SECONDS = 60
DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS = 15
EXPORT_USER_ADVISORY_LOCK_SEED = 0x52464C4F57
SnapshotModelT = TypeVar("SnapshotModelT", bound=BaseModel)


class RenderSnapshotTokenSource(Protocol):
    id: uuid.UUID
    user_id: str
    expires_at: datetime


@dataclass(frozen=True)
class RenderSnapshotReference:
    """Detached scalar identity returned after the create transaction commits."""

    id: uuid.UUID
    user_id: str
    expires_at: datetime


@dataclass(frozen=True)
class RenderSnapshotState(RenderSnapshotReference):
    """Detached read state safe to use after the lookup session closes."""

    consumed_at: datetime | None
    rendered_pdf: bytes | None
    rendered_pdf_expires_at: datetime | None


@dataclass(frozen=True)
class RenderSnapshotClaim(RenderSnapshotReference):
    """Detached claim identity safe to retain while the renderer is running."""

    claim_id: uuid.UUID


class SnapshotError(Exception):
    pass


class SnapshotNotFoundError(SnapshotError):
    pass


class SnapshotExpiredError(SnapshotError):
    pass


class SnapshotTokenError(SnapshotError):
    pass


class SnapshotConsumedError(SnapshotError):
    pass


class SnapshotPayloadError(SnapshotError):
    pass


class SnapshotClaimedError(SnapshotError):
    pass


class SnapshotRenderedPdfError(SnapshotError):
    pass


class SnapshotCapacityExceededError(SnapshotError):
    pass


def _as_utc_timestamp(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return int(value.timestamp())


def _as_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _positive_seconds(value: int, *, field_name: str) -> int:
    resolved = int(value)
    if resolved <= 0:
        raise ValueError(f"{field_name} must be greater than zero")
    return resolved


def _detach_snapshot_state(record: ExportRenderSnapshot) -> RenderSnapshotState:
    rendered_pdf = getattr(record, "rendered_pdf", None)
    try:
        validated_pdf = (
            validate_rendered_pdf_bytes(rendered_pdf)
            if rendered_pdf is not None
            else None
        )
    except RenderedPdfValidationError as exc:
        raise SnapshotRenderedPdfError("缓存的 PDF 导出结果无效。") from exc
    return RenderSnapshotState(
        id=record.id,
        user_id=record.user_id,
        expires_at=record.expires_at,
        consumed_at=record.consumed_at,
        rendered_pdf=validated_pdf,
        rendered_pdf_expires_at=getattr(record, "rendered_pdf_expires_at", None),
    )


async def _acquire_export_user_advisory_lock(
    session: AsyncSession,
    user_id: str,
) -> None:
    await session.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(user_id, EXPORT_USER_ADVISORY_LOCK_SEED)
            )
        )
    )


async def _apply_expired_snapshot_cleanup(
    session: AsyncSession,
    *,
    user_id: str | None = None,
) -> None:
    database_now = func.now()
    expired_pdf_statement = update(ExportRenderSnapshot).where(
        ExportRenderSnapshot.rendered_pdf.is_not(None),
        ExportRenderSnapshot.rendered_pdf_expires_at.is_not(None),
        ExportRenderSnapshot.rendered_pdf_expires_at <= database_now,
    )
    expired_snapshot_statement = delete(ExportRenderSnapshot).where(
        ExportRenderSnapshot.expires_at < database_now,
        or_(
            ExportRenderSnapshot.render_claim_id.is_(None),
            ExportRenderSnapshot.render_claim_expires_at.is_(None),
            ExportRenderSnapshot.render_claim_expires_at <= database_now,
        ),
    )
    if user_id is not None:
        expired_pdf_statement = expired_pdf_statement.where(
            ExportRenderSnapshot.user_id == user_id
        )
        expired_snapshot_statement = expired_snapshot_statement.where(
            ExportRenderSnapshot.user_id == user_id
        )
    await session.execute(
        expired_pdf_statement.values(
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
    )
    await session.execute(expired_snapshot_statement)


async def cleanup_expired_snapshots(session: AsyncSession) -> None:
    await _apply_expired_snapshot_cleanup(session)
    await session.commit()


def _build_snapshot_token(
    snapshot_id: uuid.UUID,
    user_id: str,
    expires_at: datetime,
) -> str:
    settings = load_settings()
    payload = {
        "sub": str(snapshot_id),
        "uid": user_id,
        "scope": TOKEN_SCOPE,
        "exp": _as_utc_timestamp(expires_at),
    }
    return jwt.encode(payload, settings.export_token_secret, algorithm=TOKEN_ALGORITHM)


def build_render_snapshot_token(record: RenderSnapshotTokenSource) -> str:
    return _build_snapshot_token(record.id, record.user_id, record.expires_at)


def _decode_snapshot_token(token: str) -> dict:
    if not token or len(token) > MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS:
        raise SnapshotTokenError("导出快照令牌无效。")
    settings = load_settings()
    try:
        payload = jwt.decode(
            token,
            settings.export_token_secret,
            algorithms=[TOKEN_ALGORITHM],
        )
    except ExpiredSignatureError as exc:
        raise SnapshotExpiredError("导出快照已过期，请重新导出。") from exc
    except JWTError as exc:
        raise SnapshotTokenError("导出快照令牌无效。") from exc

    if payload.get("scope") != TOKEN_SCOPE:
        raise SnapshotTokenError("导出快照令牌无效。")
    return payload


async def _read_user_snapshot_budget_usage(
    session: AsyncSession,
    user_id: str,
) -> tuple[int, int, int]:
    result = await session.execute(
        select(
            func.count(ExportRenderSnapshot.id).filter(
                or_(
                    ExportRenderSnapshot.consumed_at.is_(None),
                    ExportRenderSnapshot.rendered_pdf_expires_at > func.now(),
                )
            ),
            func.coalesce(
                func.sum(
                    func.octet_length(
                        cast(ExportRenderSnapshot.payload_json, Text)
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(func.octet_length(ExportRenderSnapshot.rendered_pdf)),
                0,
            ),
        ).where(ExportRenderSnapshot.user_id == user_id)
    )
    snapshot_count, payload_bytes, rendered_pdf_bytes = result.one()
    return int(snapshot_count), int(payload_bytes), int(rendered_pdf_bytes)


async def _read_user_active_claim_count(
    session: AsyncSession,
    user_id: str,
) -> int:
    result = await session.execute(
        select(func.count(ExportRenderSnapshot.id)).where(
            ExportRenderSnapshot.user_id == user_id,
            ExportRenderSnapshot.render_claim_id.is_not(None),
            ExportRenderSnapshot.render_claim_expires_at.is_not(None),
            ExportRenderSnapshot.render_claim_expires_at > func.now(),
            ExportRenderSnapshot.consumed_at.is_(None),
        )
    )
    return int(result.scalar_one())


async def create_render_snapshot(
    session: AsyncSession,
    user_id: str,
    snapshot: BaseModel,
    ttl_seconds: Optional[int] = None,
    *,
    snapshot_id: uuid.UUID | None = None,
) -> tuple[RenderSnapshotReference, str]:
    settings = load_settings()
    await _acquire_export_user_advisory_lock(session, user_id)
    await _apply_expired_snapshot_cleanup(session, user_id=user_id)
    created_at = _utc_now_aware()
    expires_at = created_at + timedelta(
        seconds=(
            ttl_seconds
            if ttl_seconds is not None
            else settings.export_snapshot_ttl_seconds
        )
    )
    record = ExportRenderSnapshot(
        id=snapshot_id or uuid.uuid4(),
        user_id=user_id,
        payload_json=snapshot.model_dump(mode="json"),
        created_at=created_at,
        expires_at=expires_at,
    )
    reference = RenderSnapshotReference(
        id=record.id,
        user_id=user_id,
        expires_at=expires_at,
    )
    token = build_render_snapshot_token(reference)
    session.add(record)
    await session.flush()
    snapshot_count, payload_bytes, rendered_pdf_bytes = (
        await _read_user_snapshot_budget_usage(
            session,
            user_id,
        )
    )
    if snapshot_count > MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER:
        await session.rollback()
        raise SnapshotCapacityExceededError(
            "当前账户待清理的导出快照过多，请稍后重试。"
        )
    if payload_bytes > MAX_EXPORT_SNAPSHOT_PAYLOAD_BYTES_PER_USER:
        await session.rollback()
        raise SnapshotCapacityExceededError(
            "当前账户导出快照占用空间过大，请稍后重试。"
        )
    if (
        payload_bytes + rendered_pdf_bytes
        > MAX_EXPORT_PERSISTED_BYTES_PER_USER
    ):
        await session.rollback()
        raise SnapshotCapacityExceededError(
            "当前账户导出文件占用空间过大，请稍后重试。"
        )
    await session.commit()
    return reference, token


async def get_render_snapshot_by_token(
    session: AsyncSession,
    snapshot_id: str,
    token: str,
    snapshot_model: type[SnapshotModelT],
    *,
    allow_consumed: bool = False,
) -> tuple[RenderSnapshotState, SnapshotModelT]:
    claims = _decode_snapshot_token(token)
    if claims.get("sub") != snapshot_id:
        raise SnapshotTokenError("导出快照令牌与请求不匹配。")

    await cleanup_expired_snapshots(session)

    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc

    result = await session.execute(
        select(ExportRenderSnapshot).where(ExportRenderSnapshot.id == snapshot_uuid)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise SnapshotNotFoundError("导出快照不存在。")

    if record.user_id != claims.get("uid"):
        raise SnapshotTokenError("导出快照令牌无效。")

    if record.consumed_at is not None and not allow_consumed:
        raise SnapshotConsumedError("导出快照已失效，请重新导出。")

    if _as_utc_timestamp(record.expires_at) < _as_utc_timestamp(_utc_now_aware()):
        raise SnapshotExpiredError("导出快照已过期，请重新导出。")

    try:
        parsed_snapshot = snapshot_model.model_validate(record.payload_json or {})
    except ValidationError as exc:
        raise SnapshotPayloadError("导出快照不存在。") from exc
    return _detach_snapshot_state(record), parsed_snapshot


async def get_render_snapshot_by_owner(
    session: AsyncSession,
    snapshot_id: str,
    user_id: str,
    snapshot_model: type[SnapshotModelT],
    *,
    allow_consumed: bool = False,
) -> tuple[RenderSnapshotState, SnapshotModelT]:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc

    expiry_result = await session.execute(
        select(ExportRenderSnapshot.expires_at).where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.user_id == user_id,
        )
    )
    target_expires_at = expiry_result.scalar_one_or_none()
    if target_expires_at is None:
        await session.rollback()
        raise SnapshotNotFoundError("导出快照不存在。")
    if _as_utc_timestamp(target_expires_at) < _as_utc_timestamp(_utc_now_aware()):
        await cleanup_expired_snapshots(session)
        raise SnapshotExpiredError("导出快照已过期，请重新导出。")

    await cleanup_expired_snapshots(session)

    result = await session.execute(
        select(ExportRenderSnapshot).where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.user_id == user_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise SnapshotNotFoundError("导出快照不存在。")
    if record.consumed_at is not None and not allow_consumed:
        raise SnapshotConsumedError("导出快照已失效，请重新导出。")
    if _as_utc_timestamp(record.expires_at) < _as_utc_timestamp(_utc_now_aware()):
        raise SnapshotExpiredError("导出快照已过期，请重新导出。")

    try:
        parsed_snapshot = snapshot_model.model_validate(record.payload_json or {})
    except ValidationError as exc:
        raise SnapshotPayloadError("导出快照不存在。") from exc
    return _detach_snapshot_state(record), parsed_snapshot


def _parse_snapshot_payload(
    record: ExportRenderSnapshot,
    snapshot_model: type[SnapshotModelT],
) -> SnapshotModelT:
    if record.consumed_at is not None:
        raise SnapshotConsumedError("导出快照已失效，请重新导出。")
    try:
        return snapshot_model.model_validate(record.payload_json or {})
    except ValidationError as exc:
        raise SnapshotPayloadError("导出快照不存在。") from exc


async def _claim_render_snapshot(
    session: AsyncSession,
    snapshot_uuid: uuid.UUID,
    snapshot_model: type[SnapshotModelT],
    *,
    user_id: str | None = None,
    lease_seconds: int = DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
) -> tuple[RenderSnapshotClaim, SnapshotModelT, uuid.UUID]:
    resolved_lease_seconds = _positive_seconds(
        lease_seconds,
        field_name="lease_seconds",
    )
    if user_id is not None:
        await _acquire_export_user_advisory_lock(session, user_id)
    claim_id = uuid.uuid4()
    database_now = func.now()
    statement = update(ExportRenderSnapshot).where(
        ExportRenderSnapshot.id == snapshot_uuid,
        ExportRenderSnapshot.consumed_at.is_(None),
        ExportRenderSnapshot.expires_at > database_now,
        or_(
            ExportRenderSnapshot.render_claim_id.is_(None),
            ExportRenderSnapshot.render_claim_expires_at.is_(None),
            ExportRenderSnapshot.render_claim_expires_at <= database_now,
        ),
    )
    if user_id is not None:
        statement = statement.where(ExportRenderSnapshot.user_id == user_id)
    statement = statement.values(
        render_claim_id=claim_id,
        render_claim_expires_at=database_now
        + timedelta(seconds=resolved_lease_seconds),
        rendered_pdf=None,
        rendered_pdf_expires_at=None,
    ).returning(ExportRenderSnapshot)

    result = await session.execute(statement)
    record = result.scalar_one_or_none()
    if record is None:
        state_result = await session.execute(
            select(ExportRenderSnapshot).where(
                ExportRenderSnapshot.id == snapshot_uuid
            )
        )
        state_record = state_result.scalar_one_or_none()
        state_exists = state_record is not None
        state_user_id = state_record.user_id if state_record is not None else None
        state_consumed_at = (
            state_record.consumed_at if state_record is not None else None
        )
        state_expires_at = (
            state_record.expires_at if state_record is not None else None
        )
        await session.rollback()
        if not state_exists or (
            user_id is not None and state_user_id != user_id
        ):
            raise SnapshotNotFoundError("导出快照不存在。")
        if state_consumed_at is not None:
            raise SnapshotConsumedError("导出快照已失效，请重新导出。")
        if state_expires_at is not None and (
            _as_utc_datetime(state_expires_at) <= _utc_now_aware()
        ):
            raise SnapshotExpiredError("导出快照已过期，请重新导出。")
        raise SnapshotClaimedError("导出快照正在生成，请稍后重试。")

    try:
        snapshot = _parse_snapshot_payload(record, snapshot_model)
    except SnapshotError:
        await session.rollback()
        raise
    claim = RenderSnapshotClaim(
        id=record.id,
        user_id=record.user_id,
        expires_at=record.expires_at,
        claim_id=claim_id,
    )
    active_claim_count = await _read_user_active_claim_count(
        session,
        record.user_id,
    )
    if active_claim_count > MAX_ACTIVE_EXPORT_RENDER_CLAIMS_PER_USER:
        await session.rollback()
        raise SnapshotCapacityExceededError(
            "当前账户并发生成的导出文件过多，请稍后重试。"
        )
    await session.commit()
    return claim, snapshot, claim_id


async def claim_render_snapshot_by_token(
    session: AsyncSession,
    snapshot_id: str,
    token: str,
    snapshot_model: type[SnapshotModelT],
    *,
    lease_seconds: int = DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
) -> tuple[RenderSnapshotClaim, SnapshotModelT, uuid.UUID]:
    claims = _decode_snapshot_token(token)
    if claims.get("sub") != snapshot_id:
        raise SnapshotTokenError("导出快照令牌与请求不匹配。")
    claim_user_id = claims.get("uid")
    if not isinstance(claim_user_id, str) or not claim_user_id:
        raise SnapshotTokenError("导出快照令牌无效。")
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc

    try:
        record, snapshot, claim_id = await _claim_render_snapshot(
            session,
            snapshot_uuid,
            snapshot_model,
            user_id=claim_user_id,
            lease_seconds=lease_seconds,
        )
    except SnapshotNotFoundError as exc:
        result = await session.execute(
            select(ExportRenderSnapshot.id).where(
                ExportRenderSnapshot.id == snapshot_uuid
            )
        )
        if result.scalar_one_or_none() is not None:
            await session.rollback()
            raise SnapshotTokenError("导出快照令牌无效。") from exc
        await session.rollback()
        raise
    return record, snapshot, claim_id


async def claim_render_snapshot_by_owner(
    session: AsyncSession,
    snapshot_id: str,
    user_id: str,
    snapshot_model: type[SnapshotModelT],
    *,
    lease_seconds: int = DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
) -> tuple[RenderSnapshotClaim, SnapshotModelT, uuid.UUID]:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    return await _claim_render_snapshot(
        session,
        snapshot_uuid,
        snapshot_model,
        user_id=user_id,
        lease_seconds=lease_seconds,
    )


async def renew_render_snapshot_claim(
    session: AsyncSession,
    snapshot_id: str,
    claim_id: uuid.UUID,
    lease_seconds: int = DEFAULT_RENDER_CLAIM_LEASE_SECONDS,
) -> datetime:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    resolved_lease_seconds = _positive_seconds(
        lease_seconds,
        field_name="lease_seconds",
    )
    database_now = func.now()
    result = await session.execute(
        update(ExportRenderSnapshot)
        .where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.render_claim_id == claim_id,
            ExportRenderSnapshot.render_claim_expires_at > database_now,
            ExportRenderSnapshot.consumed_at.is_(None),
        )
        .values(
            render_claim_expires_at=database_now
            + timedelta(seconds=resolved_lease_seconds)
        )
        .returning(ExportRenderSnapshot.render_claim_expires_at)
    )
    renewed_until = result.scalar_one_or_none()
    if renewed_until is None:
        await session.rollback()
        raise SnapshotClaimedError("导出快照生成权已失效，请重新导出。")
    await session.commit()
    return renewed_until


async def finalize_render_snapshot_claim(
    session: AsyncSession,
    snapshot_id: str,
    claim_id: uuid.UUID,
    pdf_bytes: bytes,
    retry_ttl_seconds: int = DEFAULT_RENDERED_PDF_RETRY_TTL_SECONDS,
) -> None:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    resolved_retry_ttl_seconds = _positive_seconds(
        retry_ttl_seconds,
        field_name="retry_ttl_seconds",
    )
    try:
        persisted_pdf = validate_rendered_pdf_bytes(pdf_bytes)
    except RenderedPdfValidationError as exc:
        raise SnapshotRenderedPdfError("PDF 渲染结果无效。") from exc
    owner_result = await session.execute(
        select(ExportRenderSnapshot.user_id).where(
            ExportRenderSnapshot.id == snapshot_uuid
        )
    )
    owner_user_id = owner_result.scalar_one_or_none()
    if owner_user_id is not None:
        await _acquire_export_user_advisory_lock(session, owner_user_id)
    database_now = func.now()
    result = await session.execute(
        update(ExportRenderSnapshot)
        .where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.render_claim_id == claim_id,
            ExportRenderSnapshot.render_claim_expires_at > database_now,
            ExportRenderSnapshot.consumed_at.is_(None),
        )
        .values(
            consumed_at=database_now,
            rendered_pdf=persisted_pdf,
            rendered_pdf_expires_at=func.least(
                ExportRenderSnapshot.expires_at,
                database_now + timedelta(seconds=resolved_retry_ttl_seconds),
            ),
            render_claim_id=None,
            render_claim_expires_at=None,
        )
        .returning(ExportRenderSnapshot.id)
    )
    if result.scalar_one_or_none() is None:
        state_result = await session.execute(
            select(ExportRenderSnapshot).where(
                ExportRenderSnapshot.id == snapshot_uuid
            )
        )
        state_record = state_result.scalar_one_or_none()
        state_exists = state_record is not None
        state_consumed_at = (
            state_record.consumed_at if state_record is not None else None
        )
        await session.rollback()
        if not state_exists:
            raise SnapshotNotFoundError("导出快照不存在。")
        if state_consumed_at is not None:
            raise SnapshotConsumedError("导出快照已失效，请重新导出。")
        raise SnapshotClaimedError("导出快照生成权已失效，请重新导出。")
    if owner_user_id is not None:
        _, payload_bytes, rendered_pdf_bytes = (
            await _read_user_snapshot_budget_usage(session, owner_user_id)
        )
        if (
            payload_bytes + rendered_pdf_bytes
            > MAX_EXPORT_PERSISTED_BYTES_PER_USER
        ):
            await session.rollback()
            raise SnapshotCapacityExceededError(
                "当前账户导出文件占用空间过大，请稍后重试。"
            )
    await session.commit()


async def release_render_snapshot_claim(
    session: AsyncSession,
    snapshot_id: str,
    claim_id: uuid.UUID,
) -> bool:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    result = await session.execute(
        update(ExportRenderSnapshot)
        .where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.render_claim_id == claim_id,
            ExportRenderSnapshot.consumed_at.is_(None),
        )
        .values(
            render_claim_id=None,
            render_claim_expires_at=None,
        )
        .returning(ExportRenderSnapshot.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        return False
    await session.commit()
    return True


async def delete_temporary_render_snapshot(
    session: AsyncSession,
    snapshot_id: str,
    user_id: str,
    *,
    claim_id: uuid.UUID | None = None,
) -> bool:
    """Hard-delete an internal temporary snapshot without stealing another claim."""

    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    await _acquire_export_user_advisory_lock(session, user_id)
    database_now = func.now()
    claim_is_releasable = or_(
        ExportRenderSnapshot.render_claim_id.is_(None),
        ExportRenderSnapshot.render_claim_expires_at.is_(None),
        ExportRenderSnapshot.render_claim_expires_at <= database_now,
    )
    if claim_id is not None:
        claim_is_releasable = or_(
            claim_is_releasable,
            ExportRenderSnapshot.render_claim_id == claim_id,
        )
    result = await session.execute(
        delete(ExportRenderSnapshot)
        .where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.user_id == user_id,
            claim_is_releasable,
        )
        .returning(ExportRenderSnapshot.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        return False
    await session.commit()
    return True


async def mark_render_snapshot_consumed(
    session: AsyncSession,
    snapshot_id: str,
) -> None:
    try:
        snapshot_uuid = uuid.UUID(snapshot_id)
    except ValueError as exc:
        raise SnapshotNotFoundError("导出快照不存在。") from exc
    await session.execute(
        update(ExportRenderSnapshot)
        .where(
            ExportRenderSnapshot.id == snapshot_uuid,
            ExportRenderSnapshot.consumed_at.is_(None),
        )
        .values(consumed_at=func.now())
    )
    await session.commit()


