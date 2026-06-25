from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import os
import secrets
from typing import Any, Iterable
import uuid

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...config import ENV_REDEMPTION_CODE_ENCRYPTION_KEY, load_settings
from ...models import (
    AITokenPurchaseEvent,
    AITokenWallet,
    RedemptionBatch,
    RedemptionCode,
    RedemptionPackage,
)
from ...utils.time_utils import utc_now
from . import billing_service
from .redemption_schemas import (
    RedemptionBatchCreate,
    RedemptionBatchCreateResponse,
    RedemptionBatchRead,
    RedemptionBatchRevokeResponse,
    RedemptionCodeRead,
    RedemptionPackageCreate,
    RedemptionPackageRead,
    RedemptionPackageUpdate,
    RedemptionRedeemResponse,
    RedemptionRevokeResponse,
)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_GROUP_COUNT = 4
CODE_GROUP_LENGTH = 4
CODE_PREFIX = "RF"
STATUS_UNUSED = "unused"
STATUS_REDEEMED = "redeemed"
STATUS_REVOKED = "revoked"
SOURCE_REDEMPTION_CODE = "redemption_code"


def normalize_redemption_code(code: str) -> str:
    return "".join(char for char in (code or "").upper() if char.isalnum())


def format_redemption_code(normalized_code: str) -> str:
    body = normalized_code
    if body.startswith(CODE_PREFIX):
        body = body[len(CODE_PREFIX) :]
    groups = [body[index : index + CODE_GROUP_LENGTH] for index in range(0, len(body), CODE_GROUP_LENGTH)]
    return "-".join([CODE_PREFIX, *[group for group in groups if group]])


def hash_redemption_code(code: str) -> str:
    normalized = normalize_redemption_code(code)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _encryption_secret() -> str:
    direct = os.getenv(ENV_REDEMPTION_CODE_ENCRYPTION_KEY)
    if direct:
        return direct
    configured = load_settings().redemption_code_encryption_key
    if configured:
        return configured
    raise HTTPException(
        status_code=500,
        detail={
            "code": "redemption_encryption_key_missing",
            "message": "REDEMPTION_CODE_ENCRYPTION_KEY is required for card code operations.",
        },
    )


def _fernet() -> Fernet:
    digest = hashlib.sha256(_encryption_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_redemption_code(code: str) -> str:
    return _fernet().encrypt(code.encode("utf-8")).decode("ascii")


def decrypt_redemption_code(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "redemption_code_decrypt_failed",
                "message": "卡密解密失败，请检查后端加密密钥。",
            },
        ) from exc


def _new_plaintext_code() -> str:
    groups = [
        "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_GROUP_LENGTH))
        for _ in range(CODE_GROUP_COUNT)
    ]
    return "-".join([CODE_PREFIX, *groups])


def _code_prefix(code: str) -> str:
    normalized = normalize_redemption_code(code)
    return format_redemption_code(normalized)[:12]


async def _maybe_commit(session: AsyncSession) -> None:
    commit = getattr(session, "commit", None)
    if callable(commit):
        result = commit()
        if hasattr(result, "__await__"):
            await result


async def _maybe_flush(session: AsyncSession) -> None:
    flush = getattr(session, "flush", None)
    if callable(flush):
        result = flush()
        if hasattr(result, "__await__"):
            await result


async def _maybe_refresh(session: AsyncSession, value: Any) -> None:
    refresh = getattr(session, "refresh", None)
    if callable(refresh):
        result = refresh(value)
        if hasattr(result, "__await__"):
            await result


def _parse_uuid(value: str, field_name: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": f"invalid_{field_name}", "message": f"{field_name} 格式无效。"},
        ) from exc


def _validate_token_amount(token_amount: int | None) -> None:
    if token_amount is not None and int(token_amount or 0) <= 0:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_token_amount", "message": "套餐 Token 数量必须大于 0。"},
        )


def _to_package_read(record: RedemptionPackage) -> RedemptionPackageRead:
    return RedemptionPackageRead(
        id=str(record.id),
        name=record.name,
        token_amount=record.token_amount,
        is_active=record.is_active,
        notes=record.notes or "",
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _to_batch_read(record: RedemptionBatch) -> RedemptionBatchRead:
    return RedemptionBatchRead(
        id=str(record.id),
        package_id=str(record.package_id) if record.package_id else None,
        name=record.name,
        channel=record.channel or "",
        package_name=record.package_name,
        token_amount=record.token_amount,
        code_count=record.code_count,
        status=record.status,
        created_by_user_id=record.created_by_user_id,
        exported_at=record.exported_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _to_code_read(record: RedemptionCode) -> RedemptionCodeRead:
    return RedemptionCodeRead(
        id=str(record.id),
        batch_id=str(record.batch_id) if record.batch_id else None,
        package_id=str(record.package_id) if record.package_id else None,
        code_prefix=record.code_prefix,
        token_amount=record.token_amount,
        package_name=record.package_name,
        status=record.status,
        redeemed_by_user_id=record.redeemed_by_user_id,
        redeemed_at=record.redeemed_at,
        revoked_by_user_id=record.revoked_by_user_id,
        revoked_at=record.revoked_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def list_packages(session: AsyncSession) -> list[RedemptionPackageRead]:
    result = await session.execute(select(RedemptionPackage).order_by(desc(RedemptionPackage.created_at)))
    return [_to_package_read(record) for record in result.scalars().all()]


async def create_package(
    session: AsyncSession,
    payload: RedemptionPackageCreate,
) -> RedemptionPackageRead:
    _validate_token_amount(payload.token_amount)
    now = utc_now()
    record = RedemptionPackage(
        name=payload.name.strip(),
        token_amount=int(payload.token_amount),
        is_active=payload.is_active,
        notes=(payload.notes or "").strip(),
        created_at=now,
        updated_at=now,
    )
    session.add(record)
    await _maybe_commit(session)
    await _maybe_refresh(session, record)
    return _to_package_read(record)


async def _get_package(session: AsyncSession, package_id: str) -> RedemptionPackage:
    parsed_id = _parse_uuid(package_id, "package_id")
    result = await session.execute(select(RedemptionPackage).where(RedemptionPackage.id == parsed_id))
    record = result.scalars().first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"code": "redemption_package_not_found", "message": "卡密套餐不存在。"},
        )
    return record


async def update_package(
    session: AsyncSession,
    package_id: str,
    payload: RedemptionPackageUpdate,
) -> RedemptionPackageRead:
    _validate_token_amount(payload.token_amount)
    record = await _get_package(session, package_id)
    if payload.name is not None:
        record.name = payload.name.strip()
    if payload.token_amount is not None:
        record.token_amount = int(payload.token_amount)
    if payload.is_active is not None:
        record.is_active = payload.is_active
    if payload.notes is not None:
        record.notes = payload.notes.strip()
    record.updated_at = utc_now()
    await _maybe_commit(session)
    await _maybe_refresh(session, record)
    return _to_package_read(record)


async def create_redemption_batch(
    session: AsyncSession,
    *,
    created_by: str,
    payload: RedemptionBatchCreate,
) -> RedemptionBatchCreateResponse:
    package = await _get_package(session, payload.package_id)
    if not package.is_active:
        raise HTTPException(
            status_code=400,
            detail={"code": "redemption_package_inactive", "message": "卡密套餐已停用。"},
        )
    count = int(payload.count)
    if count <= 0 or count > 5000:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_redemption_batch_count", "message": "批量生成数量必须在 1 到 5000 之间。"},
        )

    now = utc_now()
    batch = RedemptionBatch(
        package_id=package.id,
        name=payload.name.strip(),
        channel=(payload.channel or "").strip(),
        package_name=package.name,
        token_amount=package.token_amount,
        code_count=count,
        created_by_user_id=created_by,
        created_at=now,
        updated_at=now,
    )
    session.add(batch)
    await _maybe_flush(session)

    plaintext_codes: list[str] = []
    seen_hashes: set[str] = set()
    while len(plaintext_codes) < count:
        plaintext = _new_plaintext_code()
        code_hash = hash_redemption_code(plaintext)
        if code_hash in seen_hashes:
            continue
        seen_hashes.add(code_hash)
        plaintext_codes.append(plaintext)
        session.add(
            RedemptionCode(
                batch_id=batch.id,
                package_id=package.id,
                code_hash=code_hash,
                code_ciphertext=encrypt_redemption_code(plaintext),
                code_prefix=_code_prefix(plaintext),
                token_amount=package.token_amount,
                package_name=package.name,
                status=STATUS_UNUSED,
                created_at=now,
                updated_at=now,
            )
        )

    await _maybe_commit(session)
    await _maybe_refresh(session, batch)
    return RedemptionBatchCreateResponse(batch=_to_batch_read(batch), codes=plaintext_codes)


async def _get_code_by_hash(
    session: AsyncSession,
    code_hash: str,
    *,
    for_update: bool = False,
) -> RedemptionCode | None:
    statement = select(RedemptionCode).where(RedemptionCode.code_hash == code_hash)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    return result.scalars().first()


async def redeem_code(
    session: AsyncSession,
    user_id: str,
    code: str,
) -> RedemptionRedeemResponse:
    code_hash = hash_redemption_code(code)
    record = await _get_code_by_hash(session, code_hash, for_update=True)
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"code": "redemption_code_not_found", "message": "卡密不存在或格式无效。"},
        )
    if not hmac.compare_digest(record.code_hash, code_hash):
        raise HTTPException(
            status_code=404,
            detail={"code": "redemption_code_not_found", "message": "卡密不存在或格式无效。"},
        )
    if record.status != STATUS_UNUSED:
        raise HTTPException(
            status_code=409,
            detail={"code": "redemption_code_unavailable", "message": "卡密已使用或已报废。"},
        )
    _validate_token_amount(record.token_amount)

    wallet = await billing_service._get_wallet(session, user_id, create=True, for_update=True)  # noqa: SLF001
    assert wallet is not None
    now = utc_now()
    before_remaining = max(int(wallet.remaining_tokens or 0), 0)
    before_limit = max(int(wallet.token_limit or 0), 0)
    token_amount = int(record.token_amount)
    after_remaining = before_remaining + token_amount
    after_limit = before_limit + token_amount

    purchase = AITokenPurchaseEvent(
        user_id=user_id,
        option_id=f"redemption:{record.id}",
        label=record.package_name,
        tokens=token_amount,
        status="redemption_succeeded",
        before_remaining_tokens=before_remaining,
        after_remaining_tokens=after_remaining,
        before_token_limit=before_limit,
        after_token_limit=after_limit,
        source=SOURCE_REDEMPTION_CODE,
        source_id=str(record.id),
        metadata_json={
            "batch_id": str(record.batch_id) if record.batch_id else None,
            "package_id": str(record.package_id) if record.package_id else None,
        },
        created_at=now,
    )
    session.add(purchase)

    wallet.token_limit = after_limit
    wallet.remaining_tokens = after_remaining
    wallet.last_purchase_id = purchase.id
    wallet.last_purchase_tokens = token_amount
    wallet.last_purchase_at = now
    wallet.updated_at = now

    record.status = STATUS_REDEEMED
    record.redeemed_by_user_id = user_id
    record.redeemed_at = now
    record.updated_at = now

    await _maybe_commit(session)
    await _maybe_refresh(session, wallet)
    await _maybe_refresh(session, record)
    await _maybe_refresh(session, purchase)

    return RedemptionRedeemResponse(
        tokens=token_amount,
        package_name=record.package_name,
        summary=billing_service._to_summary(wallet),  # noqa: SLF001
    )


async def _get_code_by_id(
    session: AsyncSession,
    code_id: str,
    *,
    for_update: bool = False,
) -> RedemptionCode:
    parsed_id = _parse_uuid(code_id, "code_id")
    statement = select(RedemptionCode).where(RedemptionCode.id == parsed_id)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    record = result.scalars().first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"code": "redemption_code_not_found", "message": "卡密不存在。"},
        )
    return record


async def revoke_code(
    session: AsyncSession,
    code_id: str,
    revoked_by: str,
) -> RedemptionCode:
    record = await _get_code_by_id(session, code_id, for_update=True)
    if record.status == STATUS_REDEEMED:
        raise HTTPException(
            status_code=409,
            detail={"code": "redemption_code_already_redeemed", "message": "已兑换卡密不能报废。"},
        )
    if record.status != STATUS_REVOKED:
        now = utc_now()
        record.status = STATUS_REVOKED
        record.revoked_by_user_id = revoked_by
        record.revoked_at = now
        record.updated_at = now
        await _maybe_commit(session)
        await _maybe_refresh(session, record)
    return record


async def revoke_code_response(
    session: AsyncSession,
    code_id: str,
    revoked_by: str,
) -> RedemptionRevokeResponse:
    return RedemptionRevokeResponse(code=_to_code_read(await revoke_code(session, code_id, revoked_by)))


async def _get_batch(session: AsyncSession, batch_id: str, *, for_update: bool = False) -> RedemptionBatch:
    parsed_id = _parse_uuid(batch_id, "batch_id")
    statement = select(RedemptionBatch).where(RedemptionBatch.id == parsed_id)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    record = result.scalars().first()
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"code": "redemption_batch_not_found", "message": "卡密批次不存在。"},
        )
    return record


async def _list_codes_for_batch(session: AsyncSession, batch_id: uuid.UUID) -> list[RedemptionCode]:
    result = await session.execute(
        select(RedemptionCode)
        .where(RedemptionCode.batch_id == batch_id)
        .order_by(RedemptionCode.created_at)
    )
    return list(result.scalars().all())


async def export_batch_csv(session: AsyncSession, batch_id: str) -> str:
    batch = await _get_batch(session, batch_id)
    codes = await _list_codes_for_batch(session, batch.id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "code", "status", "package_name", "tokens", "batch", "channel", "redeemed_by", "redeemed_at", "revoked_at"])
    for record in codes:
        writer.writerow(
            [
                str(record.id),
                decrypt_redemption_code(record.code_ciphertext),
                record.status,
                record.package_name,
                record.token_amount,
                batch.name,
                batch.channel,
                record.redeemed_by_user_id or "",
                record.redeemed_at.isoformat() if record.redeemed_at else "",
                record.revoked_at.isoformat() if record.revoked_at else "",
            ]
        )
    batch.exported_at = utc_now()
    batch.updated_at = batch.exported_at
    await _maybe_commit(session)
    return output.getvalue()


async def revoke_batch(
    session: AsyncSession,
    batch_id: str,
    revoked_by: str,
) -> RedemptionBatchRevokeResponse:
    batch = await _get_batch(session, batch_id, for_update=True)
    codes = await _list_codes_for_batch(session, batch.id)
    now = utc_now()
    revoked_count = 0
    for record in codes:
        if record.status == STATUS_UNUSED:
            record.status = STATUS_REVOKED
            record.revoked_by_user_id = revoked_by
            record.revoked_at = now
            record.updated_at = now
            revoked_count += 1
    if revoked_count:
        batch.status = "revoked"
        batch.updated_at = now
        await _maybe_commit(session)
    return RedemptionBatchRevokeResponse(batch=_to_batch_read(batch), revoked_count=revoked_count)


def decrypted_export_rows(batch: RedemptionBatch, codes: Iterable[RedemptionCode]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(record.id),
            "code": decrypt_redemption_code(record.code_ciphertext),
            "status": record.status,
            "package_name": record.package_name,
            "tokens": record.token_amount,
            "batch": batch.name,
            "channel": batch.channel,
        }
        for record in codes
    ]
