from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
import hashlib
import json
from typing import Any
import uuid

from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...utils.time_utils import utc_now_aware
from . import state_machine
from .models import ResumeOptimizationRun
from .schemas import (
    OPTIMIZER_VERSION,
    POLICY_VERSION,
    PROMPT_VERSION,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)


class OptimizationRunNotFoundError(LookupError):
    code = "resume_optimization_run_not_found"

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        super().__init__("Resume optimization run not found")


class OptimizationIdempotencyConflictError(ValueError):
    code = "resume_optimization_idempotency_conflict"

    def __init__(self) -> None:
        super().__init__(
            "Idempotency key was already used for a different resume optimization request"
        )


_JSON_FIELDS = (
    "before_snapshot",
    "plan_json",
    "answers_json",
    "result_json",
    "after_snapshot",
    "post_evaluation_json",
    "error_json",
)
_UNSET = object()


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def hash_canonical_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def build_idempotency_key_hash(user_id: str, raw_key: str) -> str:
    return hash_canonical_json({"raw_key": raw_key, "user_id": user_id})


def build_start_request_hash(payload: ResumeOptimizationStartRequest) -> str:
    return hash_canonical_json(payload.model_dump(mode="json"))


def _copy_json_object(value: Mapping[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise TypeError("resume optimization JSON payloads must be objects")
    copied = deepcopy(dict(value))
    canonical_json(copied)
    return copied


def _copy_accepted_change_ids(value: Sequence[str]) -> list[str]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise ValueError("accepted_change_ids must be an array of IDs")

    copied: list[str] = []
    seen: set[str] = set()
    for change_id in value:
        if not isinstance(change_id, str) or not change_id.strip():
            raise ValueError(
                "accepted_change_ids must contain non-empty string IDs"
            )
        if change_id in seen:
            raise ValueError("accepted_change_ids must not contain duplicate IDs")
        seen.add(change_id)
        copied.append(change_id)
    return deepcopy(copied)


def _copy_run(run: ResumeOptimizationRun) -> ResumeOptimizationRun:
    values = {
        field_name: deepcopy(getattr(run, field_name))
        for field_name in ResumeOptimizationRun.model_fields
    }
    return ResumeOptimizationRun(**values)


def _parse_run_id(run_id: str | uuid.UUID) -> uuid.UUID:
    try:
        return run_id if isinstance(run_id, uuid.UUID) else uuid.UUID(run_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise OptimizationRunNotFoundError(str(run_id)) from exc


def _parse_resume_id(resume_id: str | uuid.UUID) -> uuid.UUID | None:
    try:
        return resume_id if isinstance(resume_id, uuid.UUID) else uuid.UUID(resume_id)
    except (AttributeError, TypeError, ValueError):
        return None


def _coerce_status(
    status: ResumeOptimizationStatus | str,
) -> ResumeOptimizationStatus:
    if isinstance(status, ResumeOptimizationStatus):
        return status
    return ResumeOptimizationStatus(status)


async def _find_run_by_id(
    session: AsyncSession,
    *,
    user_id: str,
    run_id: uuid.UUID,
    for_update: bool,
) -> ResumeOptimizationRun | None:
    statement = select(ResumeOptimizationRun).where(
        ResumeOptimizationRun.id == run_id,
        ResumeOptimizationRun.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    return result.scalars().first()


async def _require_run_by_id(
    session: AsyncSession,
    *,
    user_id: str,
    run_id: str | uuid.UUID,
    for_update: bool,
) -> ResumeOptimizationRun:
    parsed_run_id = _parse_run_id(run_id)
    run = await _find_run_by_id(
        session,
        user_id=user_id,
        run_id=parsed_run_id,
        for_update=for_update,
    )
    if run is None:
        raise OptimizationRunNotFoundError(str(run_id))
    return run


async def _find_run_by_idempotency_hash(
    session: AsyncSession,
    *,
    user_id: str,
    idempotency_key_hash: str,
) -> ResumeOptimizationRun | None:
    result = await session.execute(
        select(ResumeOptimizationRun).where(
            ResumeOptimizationRun.user_id == user_id,
            ResumeOptimizationRun.idempotency_key_hash == idempotency_key_hash,
        )
    )
    return result.scalars().first()


def _resolve_idempotent_existing(
    existing: ResumeOptimizationRun,
    *,
    request_hash: str,
) -> ResumeOptimizationRun:
    if existing.request_hash != request_hash:
        raise OptimizationIdempotencyConflictError()
    return _copy_run(existing)


async def create_or_load_run(
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    *,
    idempotency_key: str | None,
    source_snapshot_hash: str,
    source_jd_signature: str = "",
    before_snapshot: Mapping[str, Any] | None = None,
) -> ResumeOptimizationRun:
    request_hash = build_start_request_hash(payload)
    idempotency_key_hash = (
        build_idempotency_key_hash(user_id, idempotency_key)
        if idempotency_key is not None
        else None
    )

    if idempotency_key_hash is not None:
        existing = await _find_run_by_idempotency_hash(
            session,
            user_id=user_id,
            idempotency_key_hash=idempotency_key_hash,
        )
        if existing is not None:
            return _resolve_idempotent_existing(existing, request_hash=request_hash)

    parsed_resume_id = _parse_resume_id(payload.resume_id)
    if parsed_resume_id is None:
        raise ValueError("resume_id must be a valid UUID")

    run = ResumeOptimizationRun(
        user_id=user_id,
        resume_id=parsed_resume_id,
        status=ResumeOptimizationStatus.PLANNING.value,
        optimizer_version=OPTIMIZER_VERSION,
        policy_version=POLICY_VERSION,
        prompt_version=PROMPT_VERSION,
        source_resume_updated_at=payload.expected_resume_updated_at,
        source_evaluation_signature=payload.evaluation_signature,
        source_jd_signature=source_jd_signature,
        source_snapshot_hash=source_snapshot_hash,
        idempotency_key_hash=idempotency_key_hash,
        request_hash=request_hash,
        before_snapshot=_copy_json_object(before_snapshot),
    )

    if idempotency_key_hash is None:
        session.add(run)
        await session.flush()
        return _copy_run(run)

    try:
        async with session.begin_nested():
            session.add(run)
            await session.flush()
    except IntegrityError as error:
        existing = await _find_run_by_idempotency_hash(
            session,
            user_id=user_id,
            idempotency_key_hash=idempotency_key_hash,
        )
        if existing is None:
            raise
        try:
            return _resolve_idempotent_existing(existing, request_hash=request_hash)
        except OptimizationIdempotencyConflictError as conflict:
            raise conflict from error

    return _copy_run(run)


async def get_run_for_user(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
) -> ResumeOptimizationRun:
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=False,
    )
    return _copy_run(run)


async def get_latest_run_for_resume(
    session: AsyncSession,
    user_id: str,
    resume_id: str | uuid.UUID,
) -> ResumeOptimizationRun | None:
    parsed_resume_id = _parse_resume_id(resume_id)
    if parsed_resume_id is None:
        return None
    result = await session.execute(
        select(ResumeOptimizationRun)
        .where(
            ResumeOptimizationRun.user_id == user_id,
            ResumeOptimizationRun.resume_id == parsed_resume_id,
        )
        .order_by(
            desc(ResumeOptimizationRun.created_at),
            desc(ResumeOptimizationRun.id),
        )
        .limit(1)
    )
    run = result.scalars().first()
    return _copy_run(run) if run is not None else None


async def update_run_payload(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    before_snapshot: Mapping[str, Any] | None | object = _UNSET,
    plan_json: Mapping[str, Any] | None | object = _UNSET,
    answers_json: Mapping[str, Any] | None | object = _UNSET,
    result_json: Mapping[str, Any] | None | object = _UNSET,
    after_snapshot: Mapping[str, Any] | None | object = _UNSET,
    post_evaluation_json: Mapping[str, Any] | None | object = _UNSET,
    error_json: Mapping[str, Any] | None | object = _UNSET,
    accepted_change_ids: Sequence[str] | object = _UNSET,
    applied_content_signature: str | None | object = _UNSET,
) -> ResumeOptimizationRun:
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )

    payload_values = {
        "before_snapshot": before_snapshot,
        "plan_json": plan_json,
        "answers_json": answers_json,
        "result_json": result_json,
        "after_snapshot": after_snapshot,
        "post_evaluation_json": post_evaluation_json,
        "error_json": error_json,
    }
    copied_payload_values: dict[str, dict[str, Any]] = {}
    for field_name in _JSON_FIELDS:
        value = payload_values[field_name]
        if value is not _UNSET:
            copied_payload_values[field_name] = _copy_json_object(value)

    copied_accepted_change_ids: list[str] | object = _UNSET
    if accepted_change_ids is not _UNSET:
        copied_accepted_change_ids = _copy_accepted_change_ids(accepted_change_ids)

    for field_name, value in copied_payload_values.items():
        setattr(run, field_name, value)
    if copied_accepted_change_ids is not _UNSET:
        run.accepted_change_ids = copied_accepted_change_ids
    if applied_content_signature is not _UNSET:
        run.applied_content_signature = applied_content_signature

    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)


async def transition_run(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    target: ResumeOptimizationStatus | str,
    *,
    allow_rescore_retry: bool = False,
) -> ResumeOptimizationRun:
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    target_status = _coerce_status(target)
    state_machine.require_status_transition(
        current_status,
        target_status,
        allow_rescore_retry=allow_rescore_retry,
    )

    now = utc_now_aware()
    run.status = target_status.value
    run.updated_at = now
    if (
        target_status == ResumeOptimizationStatus.APPLIED
        and current_status == ResumeOptimizationStatus.APPLYING
    ):
        run.applied_at = now
    if target_status == ResumeOptimizationStatus.COMPLETED:
        run.completed_at = now

    session.add(run)
    await session.flush()
    return _copy_run(run)


async def record_run_error(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    error_json: Mapping[str, Any],
) -> ResumeOptimizationRun:
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    target_status = ResumeOptimizationStatus.FAILED
    state_machine.require_status_transition(
        current_status,
        target_status,
        allow_rescore_retry=False,
    )

    run.error_json = _copy_json_object(error_json)
    run.status = target_status.value
    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)
