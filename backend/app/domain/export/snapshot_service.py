from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional, TypeVar

from jose import ExpiredSignatureError, JWTError, jwt
from pydantic import BaseModel, ValidationError
from sqlalchemy import delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import load_settings
from ...models import ExportRenderSnapshot

TOKEN_ALGORITHM = "HS256"
TOKEN_SCOPE = "export_render_snapshot"
SnapshotModelT = TypeVar("SnapshotModelT", bound=BaseModel)


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


def _utc_now_aware() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc_timestamp(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return int(value.timestamp())


async def cleanup_expired_snapshots(session: AsyncSession) -> None:
    now = _utc_now_aware()
    await session.execute(
        delete(ExportRenderSnapshot).where(ExportRenderSnapshot.expires_at < now)
    )
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


def _decode_snapshot_token(token: str) -> dict:
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


async def create_render_snapshot(
    session: AsyncSession,
    user_id: str,
    snapshot: BaseModel,
    ttl_seconds: Optional[int] = None,
) -> tuple[ExportRenderSnapshot, str]:
    settings = load_settings()
    await cleanup_expired_snapshots(session)
    created_at = _utc_now_aware()
    expires_at = created_at + timedelta(
        seconds=ttl_seconds or settings.export_snapshot_ttl_seconds
    )
    record = ExportRenderSnapshot(
        user_id=user_id,
        payload_json=snapshot.model_dump(mode="json"),
        created_at=created_at,
        expires_at=expires_at,
    )
    token = _build_snapshot_token(record.id, user_id, expires_at)
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record, token


async def get_render_snapshot_by_token(
    session: AsyncSession,
    snapshot_id: str,
    token: str,
    snapshot_model: type[SnapshotModelT],
) -> tuple[ExportRenderSnapshot, SnapshotModelT]:
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

    if record.consumed_at is not None:
        raise SnapshotConsumedError("导出快照已失效，请重新导出。")

    if _as_utc_timestamp(record.expires_at) < _as_utc_timestamp(_utc_now_aware()):
        raise SnapshotExpiredError("导出快照已过期，请重新导出。")

    try:
        parsed_snapshot = snapshot_model.model_validate(record.payload_json or {})
    except ValidationError as exc:
        raise SnapshotPayloadError("导出快照不存在。") from exc
    return record, parsed_snapshot


async def mark_render_snapshot_consumed(
    session: AsyncSession,
    record: ExportRenderSnapshot,
) -> None:
    record.consumed_at = _utc_now_aware()
    session.add(record)
    await session.commit()
