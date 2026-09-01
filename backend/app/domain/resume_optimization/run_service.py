from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any
import uuid

from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...utils.time_utils import utc_now_aware
from ..resume.models import Resume
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


@dataclass(frozen=True)
class OptimizationRunClaim:
    """A newly claimed run or an idempotent run already owned by another request."""

    run: ResumeOptimizationRun
    claimed: bool


class OptimizationAnswerInProgressError(RuntimeError):
    code = "resume_optimization_answer_in_progress"
    status_code = 409
    public_message = "补充信息正在处理中，请稍后重试。"
    retryable = True

    def __init__(self) -> None:
        super().__init__("Another answer request is already processing this run")


class OptimizationAnswerClaimLostError(RuntimeError):
    code = "resume_optimization_answer_claim_lost"
    status_code = 409
    public_message = "本次补充处理已失效，请刷新优化方案后重试。"
    retryable = True


class OptimizationPlanningClaimLostError(RuntimeError):
    code = "resume_optimization_planning_claim_lost"
    status_code = 409
    public_message = "本次优化规划已失效，请刷新后重试。"
    retryable = True


@dataclass(frozen=True)
class OptimizationAnswerRunClaim:
    run: ResumeOptimizationRun
    claimed: bool


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
_ACTIVE_ANSWER_CLAIM_KEY = "_activeAnswerClaim"
_ACTIVE_PLANNING_CLAIM_KEY = "_activePlanningClaim"
_DEFAULT_ANSWER_CLAIM_TTL_SECONDS = 900
_DEFAULT_PLANNING_CLAIM_TTL_SECONDS = 900


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


def _normalized_aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _answer_claim_is_active(
    claim: Any,
    *,
    now: datetime,
    ttl_seconds: int,
) -> bool:
    if not isinstance(claim, Mapping):
        return False
    claimed_at = claim.get("claimedAt")
    if not isinstance(claimed_at, str):
        return False
    try:
        parsed = datetime.fromisoformat(claimed_at)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        return False
    return _normalized_aware_datetime(parsed) + timedelta(
        seconds=ttl_seconds
    ) > _normalized_aware_datetime(now)


def _planning_claim_is_active(
    run: ResumeOptimizationRun,
    *,
    now: datetime,
    ttl_seconds: int,
) -> bool:
    return _normalized_aware_datetime(run.updated_at) + timedelta(
        seconds=ttl_seconds
    ) > _normalized_aware_datetime(now)


async def _find_run_by_id(
    session: AsyncSession,
    *,
    user_id: str,
    run_id: uuid.UUID,
    for_update: bool,
) -> ResumeOptimizationRun | None:
    statement = (
        select(ResumeOptimizationRun)
        .where(
            ResumeOptimizationRun.id == run_id,
            ResumeOptimizationRun.user_id == user_id,
        )
        .execution_options(populate_existing=True)
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
        select(ResumeOptimizationRun)
        .where(
            ResumeOptimizationRun.user_id == user_id,
            ResumeOptimizationRun.idempotency_key_hash == idempotency_key_hash,
        )
        .execution_options(populate_existing=True)
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


async def preflight_idempotent_run(
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    *,
    idempotency_key: str | None,
    claim_id: str | None = None,
    planning_claim_ttl_seconds: int = _DEFAULT_PLANNING_CLAIM_TTL_SECONDS,
) -> OptimizationRunClaim | None:
    """Resolve or reclaim an idempotent run before rebuilding source context.

    Active and terminal existing runs are returned unclaimed, so retries never
    touch mutable source state or invoke AI.  A planning row whose worker lease
    expired is atomically reclaimed using ``updated_at`` as its lease clock.
    """

    if idempotency_key is None:
        return None
    if (
        isinstance(planning_claim_ttl_seconds, bool)
        or not isinstance(planning_claim_ttl_seconds, int)
        or planning_claim_ttl_seconds <= 0
    ):
        raise ValueError("planning_claim_ttl_seconds must be a positive integer")

    request_hash = build_start_request_hash(payload)
    idempotency_key_hash = build_idempotency_key_hash(user_id, idempotency_key)
    result = await session.execute(
        select(ResumeOptimizationRun)
        .where(
            ResumeOptimizationRun.user_id == user_id,
            ResumeOptimizationRun.idempotency_key_hash == idempotency_key_hash,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    existing = result.scalars().first()
    if existing is None:
        return None
    resolved = _resolve_idempotent_existing(existing, request_hash=request_hash)
    if _coerce_status(existing.status) != ResumeOptimizationStatus.PLANNING:
        return OptimizationRunClaim(run=resolved, claimed=False)

    now = utc_now_aware()
    if _planning_claim_is_active(
        existing,
        now=now,
        ttl_seconds=planning_claim_ttl_seconds,
    ):
        return OptimizationRunClaim(run=resolved, claimed=False)

    existing.updated_at = now
    if claim_id is not None:
        if not isinstance(claim_id, str) or not claim_id.strip():
            raise ValueError("claim_id must be a non-empty string")
        error_json = _copy_json_object(existing.error_json)
        error_json[_ACTIVE_PLANNING_CLAIM_KEY] = {
            "claimId": claim_id,
            "claimedAt": now.isoformat(),
        }
        existing.error_json = error_json
    session.add(existing)
    await session.flush()
    return OptimizationRunClaim(run=_copy_run(existing), claimed=True)


async def _create_or_claim_run(
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    *,
    idempotency_key: str | None,
    source_snapshot_hash: str,
    source_jd_signature: str = "",
    before_snapshot: Mapping[str, Any] | None = None,
    claim_id: str | None = None,
) -> OptimizationRunClaim:
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
            return OptimizationRunClaim(
                run=_resolve_idempotent_existing(
                    existing,
                    request_hash=request_hash,
                ),
                claimed=False,
            )

    parsed_resume_id = _parse_resume_id(payload.resume_id)
    if parsed_resume_id is None:
        raise ValueError("resume_id must be a valid UUID")

    now = utc_now_aware()
    planning_error_json: dict[str, Any] = {}
    if claim_id is not None:
        if not isinstance(claim_id, str) or not claim_id.strip():
            raise ValueError("claim_id must be a non-empty string")
        planning_error_json[_ACTIVE_PLANNING_CLAIM_KEY] = {
            "claimId": claim_id,
            "claimedAt": now.isoformat(),
        }
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
        error_json=planning_error_json,
        created_at=now,
        updated_at=now,
    )

    if idempotency_key_hash is None:
        session.add(run)
        await session.flush()
        return OptimizationRunClaim(run=_copy_run(run), claimed=True)

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
            return OptimizationRunClaim(
                run=_resolve_idempotent_existing(
                    existing,
                    request_hash=request_hash,
                ),
                claimed=False,
            )
        except OptimizationIdempotencyConflictError as conflict:
            raise conflict from error

    return OptimizationRunClaim(run=_copy_run(run), claimed=True)


async def create_or_claim_run(
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    *,
    idempotency_key: str | None,
    source_snapshot_hash: str,
    source_jd_signature: str = "",
    before_snapshot: Mapping[str, Any] | None = None,
    claim_id: str | None = None,
) -> OptimizationRunClaim:
    """Create and claim a run, or return an existing idempotent run unclaimed.

    Callers must only invoke AI work for a claimed result.  In particular, an
    existing ``planning`` row represents work already claimed by the request
    that inserted it and must not trigger a duplicate model call.
    """

    return await _create_or_claim_run(
        session,
        user_id,
        payload,
        idempotency_key=idempotency_key,
        source_snapshot_hash=source_snapshot_hash,
        source_jd_signature=source_jd_signature,
        before_snapshot=before_snapshot,
        claim_id=claim_id,
    )


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
    """Backward-compatible run creation API used by existing callers."""

    claimed = await _create_or_claim_run(
        session,
        user_id,
        payload,
        idempotency_key=idempotency_key,
        source_snapshot_hash=source_snapshot_hash,
        source_jd_signature=source_jd_signature,
        before_snapshot=before_snapshot,
        claim_id=None,
    )
    return claimed.run


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


async def lock_run_source_resume(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
) -> bool:
    """Lock the owner-scoped Run then its source Resume for final persistence."""

    # AsyncSessionFactory uses expire_on_commit=False.  Expire every cached
    # source entity before the final lock/rebuild so SELECT ... FOR UPDATE
    # cannot hand orchestration a pre-AI Resume/config or link object.
    session.expire_all()
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    result = await session.execute(
        select(Resume)
        .where(
            Resume.id == run.resume_id,
            Resume.user_id == user_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalars().first() is not None


async def claim_run_for_answers(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
    request_hash: str,
    claim_ttl_seconds: int = _DEFAULT_ANSWER_CLAIM_TTL_SECONDS,
) -> OptimizationAnswerRunClaim:
    """Atomically claim an awaiting run before invoking the answer model."""

    if not isinstance(claim_id, str) or not claim_id.strip():
        raise ValueError("claim_id must be a non-empty string")
    if not isinstance(request_hash, str) or not request_hash.strip():
        raise ValueError("request_hash must be a non-empty string")
    if (
        isinstance(claim_ttl_seconds, bool)
        or not isinstance(claim_ttl_seconds, int)
        or claim_ttl_seconds <= 0
    ):
        raise ValueError("claim_ttl_seconds must be a positive integer")

    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if current_status != ResumeOptimizationStatus.AWAITING_ANSWERS:
        raise state_machine.InvalidOptimizationTransitionError(
            current_status,
            ResumeOptimizationStatus.PREVIEW_READY,
        )

    answers_json = _copy_json_object(run.answers_json)
    active_claim = answers_json.get(_ACTIVE_ANSWER_CLAIM_KEY)
    now = utc_now_aware()
    if _answer_claim_is_active(
        active_claim,
        now=now,
        ttl_seconds=claim_ttl_seconds,
    ):
        raise OptimizationAnswerInProgressError()

    answers_json[_ACTIVE_ANSWER_CLAIM_KEY] = {
        "claimId": claim_id,
        "requestHash": request_hash,
        "claimedAt": now.isoformat(),
    }
    run.answers_json = answers_json
    run.updated_at = now
    session.add(run)
    await session.flush()
    return OptimizationAnswerRunClaim(run=_copy_run(run), claimed=True)


async def clear_answer_run_claim(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
) -> ResumeOptimizationRun:
    """Release this caller's active answer claim without changing run status."""

    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    answers_json = _copy_json_object(run.answers_json)
    active_claim = answers_json.get(_ACTIVE_ANSWER_CLAIM_KEY)
    if not isinstance(active_claim, Mapping) or active_claim.get("claimId") != claim_id:
        return _copy_run(run)
    answers_json.pop(_ACTIVE_ANSWER_CLAIM_KEY, None)
    run.answers_json = answers_json
    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)


def _answer_claim_owned(run: ResumeOptimizationRun, claim_id: str) -> bool:
    active_claim = run.answers_json.get(_ACTIVE_ANSWER_CLAIM_KEY)
    return (
        isinstance(active_claim, Mapping)
        and active_claim.get("claimId") == claim_id
    )


def _planning_claim_owned(run: ResumeOptimizationRun, claim_id: str) -> bool:
    active_claim = run.error_json.get(_ACTIVE_PLANNING_CLAIM_KEY)
    return (
        isinstance(active_claim, Mapping)
        and active_claim.get("claimId") == claim_id
    )


async def complete_planning_run_claim(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
    plan_json: Mapping[str, Any],
    result_json: Mapping[str, Any],
    target_status: ResumeOptimizationStatus,
) -> ResumeOptimizationRun:
    """Atomically publish a plan only for the current planning lease owner."""

    if target_status not in {
        ResumeOptimizationStatus.AWAITING_ANSWERS,
        ResumeOptimizationStatus.PREVIEW_READY,
    }:
        raise ValueError("unsupported planning completion status")
    copied_plan = _copy_json_object(plan_json)
    copied_result = _copy_json_object(result_json)
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if (
        current_status != ResumeOptimizationStatus.PLANNING
        or not _planning_claim_owned(run, claim_id)
    ):
        raise OptimizationPlanningClaimLostError()
    state_machine.require_status_transition(
        current_status,
        target_status,
        allow_rescore_retry=False,
    )

    run.plan_json = copied_plan
    run.result_json = copied_result
    run.error_json = {}
    run.status = target_status.value
    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)


async def record_planning_run_claim_terminal(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
    target_status: ResumeOptimizationStatus,
    error_json: Mapping[str, Any],
) -> ResumeOptimizationRun:
    """Terminalize planning only if this worker still owns its lease."""

    if target_status not in {
        ResumeOptimizationStatus.CANCELLED,
        ResumeOptimizationStatus.FAILED,
        ResumeOptimizationStatus.STALE,
    }:
        raise ValueError("unsupported planning terminal status")
    copied_error = _copy_json_object(error_json)
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if (
        current_status != ResumeOptimizationStatus.PLANNING
        or not _planning_claim_owned(run, claim_id)
    ):
        return _copy_run(run)
    if target_status != ResumeOptimizationStatus.STALE:
        state_machine.require_status_transition(
            current_status,
            target_status,
            allow_rescore_retry=False,
        )

    run.error_json = copied_error
    run.status = target_status.value
    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)


async def complete_answer_run_claim(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
    answers_json: Mapping[str, Any],
    result_json: Mapping[str, Any],
) -> ResumeOptimizationRun:
    """Atomically publish an answer result only for the current claim owner."""

    copied_answers = _copy_json_object(answers_json)
    copied_answers.pop(_ACTIVE_ANSWER_CLAIM_KEY, None)
    copied_result = _copy_json_object(result_json)
    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if (
        current_status != ResumeOptimizationStatus.AWAITING_ANSWERS
        or not _answer_claim_owned(run, claim_id)
    ):
        raise OptimizationAnswerClaimLostError()
    state_machine.require_status_transition(
        current_status,
        ResumeOptimizationStatus.PREVIEW_READY,
        allow_rescore_retry=False,
    )

    now = utc_now_aware()
    run.answers_json = copied_answers
    run.result_json = copied_result
    run.error_json = {}
    run.status = ResumeOptimizationStatus.PREVIEW_READY.value
    run.updated_at = now
    session.add(run)
    await session.flush()
    return _copy_run(run)


async def record_answer_run_claim_error(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    *,
    claim_id: str,
    error_json: Mapping[str, Any],
    answers_json: Mapping[str, Any],
    terminal_status: ResumeOptimizationStatus | None = None,
) -> ResumeOptimizationRun:
    """Release a claim and persist its error unless the result is already stale.

    A late worker whose claim expired or whose peer already completed is a
    no-op.  It must never overwrite a newer preview or a replacement claim.
    """

    copied_error = _copy_json_object(error_json)
    copied_answers = _copy_json_object(answers_json)
    copied_answers.pop(_ACTIVE_ANSWER_CLAIM_KEY, None)
    if terminal_status not in {
        None,
        ResumeOptimizationStatus.FAILED,
        ResumeOptimizationStatus.STALE,
    }:
        raise ValueError("unsupported answer claim terminal status")

    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if (
        current_status != ResumeOptimizationStatus.AWAITING_ANSWERS
        or not _answer_claim_owned(run, claim_id)
    ):
        return _copy_run(run)
    if terminal_status == ResumeOptimizationStatus.FAILED:
        state_machine.require_status_transition(
            current_status,
            terminal_status,
            allow_rescore_retry=False,
        )
    elif terminal_status == ResumeOptimizationStatus.STALE:
        # Awaiting-to-stale is part of the public state machine.
        state_machine.require_status_transition(
            current_status,
            terminal_status,
            allow_rescore_retry=False,
        )

    now = utc_now_aware()
    run.answers_json = copied_answers
    run.error_json = copied_error
    if terminal_status is not None:
        run.status = terminal_status.value
    run.updated_at = now
    session.add(run)
    await session.flush()
    return _copy_run(run)


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


_STALE_SOURCE_STATUSES = frozenset(
    {
        ResumeOptimizationStatus.PLANNING,
        ResumeOptimizationStatus.AWAITING_ANSWERS,
        ResumeOptimizationStatus.PREVIEW_READY,
        ResumeOptimizationStatus.APPLYING,
    }
)


async def record_run_stale(
    session: AsyncSession,
    user_id: str,
    run_id: str | uuid.UUID,
    error_json: Mapping[str, Any],
) -> ResumeOptimizationRun:
    """Persist a terminal stale result from an explicitly validated source state.

    Planning can become stale while its model call is in flight even though the
    public apply-state transition table has no user-triggered planning-to-stale
    action.  Keep that system terminal path narrow and validated here instead
    of silently assigning the status from orchestration code.
    """

    run = await _require_run_by_id(
        session,
        user_id=user_id,
        run_id=run_id,
        for_update=True,
    )
    current_status = _coerce_status(run.status)
    if current_status not in _STALE_SOURCE_STATUSES:
        raise state_machine.InvalidOptimizationTransitionError(
            current_status,
            ResumeOptimizationStatus.STALE,
        )

    run.error_json = _copy_json_object(error_json)
    run.status = ResumeOptimizationStatus.STALE.value
    run.updated_at = utc_now_aware()
    session.add(run)
    await session.flush()
    return _copy_run(run)
