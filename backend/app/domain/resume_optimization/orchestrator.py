from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence
from copy import deepcopy
import inspect
from typing import Any

import httpx
from sqlmodel.ext.asyncio.session import AsyncSession

from ..ai import runtime_budget
from ..ai.public_errors import (
    AI_PROVIDER_UNAVAILABLE_MESSAGE,
    AiProviderUnavailableError,
)
from ..ai.runtime_budget import (
    build_public_stream_error_event,
    new_ai_request_id,
)
from ..billing import billing_service
from .bank_suggestion_service import build_bank_suggestions
from .context_service import (
    FRONTEND_EVALUATION_SIGNATURE_SCHEMA,
    FrozenOptimizationContext,
    OptimizationContextError,
    OptimizationContextStaleError,
    build_frozen_optimization_context,
)
from .models import ResumeOptimizationRun
from .normalizers import OptimizationPlanNormalizationError
from .planner_service import (
    OptimizationAnswerRewriteNormalizationError,
    plan_resume_optimization,
    rewrite_answered_modules,
)
from .run_service import (
    OptimizationAnswerClaimLostError,
    OptimizationAnswerInProgressError,
    OptimizationPlanningClaimLostError,
    claim_run_for_answers,
    clear_answer_run_claim,
    complete_answer_run_claim,
    complete_planning_run_claim,
    create_or_claim_run,
    get_run_for_user,
    hash_canonical_json,
    lock_run_source_resume,
    preflight_idempotent_run,
    record_answer_run_claim_error,
    record_planning_run_claim_terminal,
    record_run_error,
    record_run_stale,
)
from .safety import verify_plan_changes
from .semantic_review import (
    OptimizationSemanticReviewNormalizationError,
    review_plan_semantics,
)
from .schemas import (
    OptimizationAction,
    OptimizationAnswer,
    OptimizationAnswerState,
    OptimizationChange,
    OptimizationPlan,
    OptimizationSafetySummary,
    ResumeOptimizationAnswersRequest,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from .state_machine import InvalidOptimizationTransitionError


ProgressEvent = dict[str, Any]
ProgressCallback = (
    Callable[[ProgressEvent], Awaitable[None] | None] | None
)

_PLAN_BILLING_ROUTE = "/api/resume-optimizations/stream"
_ANSWER_BILLING_ROUTE = "/api/resume-optimizations/{run_id}/answers/stream"
_BILLING_ROUTE_ALLOWLIST = frozenset({_PLAN_BILLING_ROUTE, _ANSWER_BILLING_ROUTE})
_BILLING_COUNT_KEY_ALLOWLIST = frozenset(
    {
        "selected_experience_count",
        "selected_skill_count",
        "bank_candidate_count",
        "issue_count",
        "question_count",
        "submitted_answer_count",
        "answered_count",
        "no_data_count",
        "unknown_count",
        "not_my_work_count",
        "skipped_count",
        "rewrite_question_count",
        "affected_change_count",
    }
)


def _update_current_billing_metadata(
    *,
    route: str,
    run: ResumeOptimizationRun,
    counts: Mapping[str, Any],
) -> None:
    context = billing_service.get_current_billing_context()
    if context is None:
        return
    metadata: dict[str, Any] = {
        "route": route if route in _BILLING_ROUTE_ALLOWLIST else "unknown",
        "run_id": str(run.id),
        "optimizer_version": str(run.optimizer_version),
    }
    for key in _BILLING_COUNT_KEY_ALLOWLIST:
        value = counts.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            metadata[key] = value
    context.metadata.clear()
    context.metadata.update(metadata)


def _selected_skill_count(frozen: FrozenOptimizationContext) -> int:
    raw_skills = frozen.current_resume.get("skills")
    if not isinstance(raw_skills, list):
        return 0
    return len(
        {
            skill_id.strip()
            for item in raw_skills
            if isinstance(item, Mapping)
            and isinstance((skill_id := item.get("id")), str)
            and skill_id.strip()
        }
    )


_PLAN_PROGRESS_TITLES = {
    "freeze_snapshot": "冻结当前简历版本",
    "prepare_context": "准备优化上下文",
    "plan_changes": "生成优化方案",
    "verify_changes": "检查事实边界",
    "persist_run": "保存优化方案",
}
_ANSWER_PROGRESS_TITLES = {
    "prepare_context": "恢复优化上下文",
    "rewrite_changes": "根据补充事实更新方案",
    "verify_changes": "重新检查事实边界",
    "persist_run": "保存补充结果",
}
_FROZEN_SNAPSHOT_KEYS = frozenset(
    {
        "resume_id",
        "resume_updated_at",
        "evaluation_signature_schema",
        "evaluation_signature",
        "jd_signature",
        "target_role",
        "evaluation",
        "current_resume",
        "selected_source_experiences",
        "selected_master_experience_ids",
        "selected_experience_links",
        "bank_suggestion_candidates",
        "fact_metadata",
    }
)
_FRESHNESS_KEYS = (
    "resume_id",
    "resume_updated_at",
    "evaluation_signature",
    "jd_signature",
    "target_role",
    "evaluation",
    "current_resume",
    "selected_source_experiences",
    "selected_master_experience_ids",
    "selected_experience_links",
    "fact_metadata",
)
_STALE_PUBLIC_MESSAGE = "简历内容或六维评估已更新，请重新生成优化方案。"


class OptimizationAnswerValidationError(ValueError):
    code = "resume_optimization_answers_invalid"
    status_code = 400
    public_message = "补充信息与当前优化问题不匹配，请刷新后重试。"
    retryable = False

    def __init__(self) -> None:
        super().__init__(self.public_message)


async def _emit_progress(
    progress_callback: ProgressCallback,
    *,
    node: str,
    title: str,
    request_id: str,
) -> None:
    if progress_callback is None:
        return
    result = progress_callback(
        {
            "type": "progress",
            "node": node,
            "title": title,
            "requestId": request_id,
        }
    )
    if inspect.isawaitable(result):
        await result


async def _commit(session: AsyncSession) -> None:
    await session.commit()


async def _rollback(session: AsyncSession) -> None:
    await session.rollback()


def _public_error_metadata(exc: Exception, *, request_id: str) -> dict[str, Any]:
    if isinstance(exc, runtime_budget.TERMINAL_AI_RUNTIME_ERRORS):
        return build_public_stream_error_event(exc, request_id=request_id)
    if isinstance(exc, (OptimizationAnswerRewriteNormalizationError, OptimizationSemanticReviewNormalizationError)):
        return {
            "type": "error",
            "code": exc.code,
            "message": exc.public_message,
            "requestId": request_id,
            "statusCode": exc.status_code,
            "retryable": exc.retryable,
        }
    if isinstance(exc, (httpx.HTTPError, AiProviderUnavailableError)):
        return {
            "type": "error",
            "code": "ai_provider_unavailable",
            "message": AI_PROVIDER_UNAVAILABLE_MESSAGE,
            "requestId": request_id,
            "statusCode": 503,
            "retryable": True,
        }
    if isinstance(exc, OptimizationContextStaleError):
        return {
            "type": "error",
            "code": exc.code,
            "message": _STALE_PUBLIC_MESSAGE,
            "requestId": request_id,
            "statusCode": exc.status_code,
            "retryable": False,
        }
    # Never persist exception text, provider payloads, or trace details for an
    # unknown failure.  The request ID is the sole diagnostic join key.
    return build_public_stream_error_event(
        exc,
        request_id=request_id,
        preserve_http_exception_detail=False,
    )


def _frozen_context_from_snapshot(
    snapshot: Mapping[str, Any],
) -> FrozenOptimizationContext:
    if not isinstance(snapshot, Mapping):
        raise OptimizationPlanNormalizationError(
            "persisted optimization snapshot has an invalid shape"
        )
    snapshot_keys = set(snapshot)
    if snapshot_keys == _FROZEN_SNAPSHOT_KEYS - {"evaluation_signature_schema"}:
        raise OptimizationContextStaleError(
            "The frozen optimization source predates the current signature contract"
        )
    if snapshot_keys != _FROZEN_SNAPSHOT_KEYS:
        raise OptimizationPlanNormalizationError(
            "persisted optimization snapshot has an invalid shape"
        )
    if (
        snapshot.get("evaluation_signature_schema")
        != FRONTEND_EVALUATION_SIGNATURE_SCHEMA
    ):
        raise OptimizationPlanNormalizationError(
            "persisted optimization snapshot has an invalid signature schema"
        )
    try:
        return FrozenOptimizationContext(
            resume_id=str(snapshot["resume_id"]),
            resume_updated_at=str(snapshot["resume_updated_at"]),
            evaluation_signature_schema=str(
                snapshot["evaluation_signature_schema"]
            ),
            evaluation_signature=str(snapshot["evaluation_signature"]),
            jd_signature=str(snapshot["jd_signature"]),
            target_role=str(snapshot["target_role"]),
            evaluation=_require_mapping(snapshot["evaluation"], "evaluation"),
            current_resume=_require_mapping(
                snapshot["current_resume"], "current_resume"
            ),
            selected_source_experiences=_require_mapping(
                snapshot["selected_source_experiences"],
                "selected_source_experiences",
            ),
            selected_master_experience_ids=_require_string_list(
                snapshot["selected_master_experience_ids"],
                "selected_master_experience_ids",
            ),
            selected_experience_links=_require_mapping(
                snapshot["selected_experience_links"],
                "selected_experience_links",
            ),
            bank_suggestion_candidates=_require_mapping_list(
                snapshot["bank_suggestion_candidates"],
                "bank_suggestion_candidates",
            ),
            fact_metadata=_require_mapping_list(
                snapshot["fact_metadata"], "fact_metadata"
            ),
        )
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, OptimizationPlanNormalizationError):
            raise
        raise OptimizationPlanNormalizationError(
            "persisted optimization snapshot is invalid"
        ) from exc


def _require_mapping(value: Any, field_name: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OptimizationPlanNormalizationError(
            f"persisted {field_name} must be an object"
        )
    return deepcopy(dict(value))


def _require_mapping_list(value: Any, field_name: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not all(
        isinstance(item, Mapping) for item in value
    ):
        raise OptimizationPlanNormalizationError(
            f"persisted {field_name} must be an array of objects"
        )
    return [deepcopy(dict(item)) for item in value]


def _require_string_list(value: Any, field_name: str) -> list[str]:
    if not isinstance(value, list) or not all(
        isinstance(item, str) and item.strip() for item in value
    ):
        raise OptimizationPlanNormalizationError(
            f"persisted {field_name} must be an array of non-empty strings"
        )
    if len(set(value)) != len(value):
        raise OptimizationPlanNormalizationError(
            f"persisted {field_name} must not contain duplicate IDs"
        )
    return list(value)


def _freshness_payload(context: FrozenOptimizationContext) -> dict[str, Any]:
    snapshot = context.snapshot_payload()
    return {key: snapshot[key] for key in _FRESHNESS_KEYS}


def _require_fresh_context(
    frozen: FrozenOptimizationContext,
    current: FrozenOptimizationContext,
) -> None:
    if hash_canonical_json(_freshness_payload(frozen)) != hash_canonical_json(
        _freshness_payload(current)
    ):
        raise OptimizationContextStaleError(
            "Resume changed while the optimization operation was in progress"
        )


def _freshness_request(run: ResumeOptimizationRun) -> ResumeOptimizationStartRequest:
    return ResumeOptimizationStartRequest(
        resume_id=str(run.resume_id),
        evaluation_signature=run.source_evaluation_signature,
        expected_resume_updated_at=run.source_resume_updated_at,
        # Bank candidates are suggestions, never rewrite evidence, and are
        # intentionally excluded from answer-time freshness equality.
        include_bank_suggestions=False,
    )


def _bank_suggestion_inputs(
    context: FrozenOptimizationContext,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    matches: list[dict[str, Any]] = []
    metadata: dict[str, dict[str, Any]] = {}
    for candidate in context.bank_suggestion_candidates:
        master_id = candidate.get("master_experience_id")
        if not isinstance(master_id, str) or not master_id.strip() or master_id in metadata:
            continue
        metadata[master_id] = {
            "category": candidate.get("category"),
            "title": candidate.get("title"),
            "org": candidate.get("org"),
        }
        matches.append(
            {
                "id": master_id,
                "score": candidate.get("match_score"),
                "reason": candidate.get("reason"),
            }
        )
    return {"experienceMatches": matches}, metadata


def _plan_with_verified_changes(
    plan: OptimizationPlan,
    *,
    changes: list[OptimizationChange],
    safety_summary: OptimizationSafetySummary,
) -> OptimizationPlan:
    return plan.model_copy(
        update={
            "changes": [change.model_copy(deep=True) for change in changes],
            "safety_summary": safety_summary.model_copy(deep=True),
        },
        deep=True,
    )


def _summary_from_changes(
    changes: Sequence[OptimizationChange],
) -> OptimizationSafetySummary:
    allowed: list[str] = []
    blocked: list[str] = []
    pending: list[str] = []
    findings: list[str] = []
    for change in changes:
        if change.safety_status == "allowed":
            allowed.append(change.change_id)
        elif change.safety_status == "blocked":
            blocked.append(change.change_id)
        else:
            pending.append(change.change_id)
        findings.extend(
            f"{change.change_id}：{finding}"
            for finding in change.safety_findings
        )
    return OptimizationSafetySummary(
        allowed_change_ids=allowed,
        blocked_change_ids=blocked,
        pending_change_ids=pending,
        findings=findings,
    )


def _stored_answers(run: ResumeOptimizationRun) -> list[OptimizationAnswer]:
    raw_answers = run.answers_json.get("answers", [])
    if not isinstance(raw_answers, list):
        raise OptimizationPlanNormalizationError(
            "persisted optimization answers must be an array"
        )
    try:
        answers = [OptimizationAnswer.model_validate(item) for item in raw_answers]
    except (TypeError, ValueError) as exc:
        raise OptimizationPlanNormalizationError(
            "persisted optimization answers are invalid"
        ) from exc
    if len({answer.question_id for answer in answers}) != len(answers):
        raise OptimizationPlanNormalizationError(
            "persisted optimization answers contain duplicate questions"
        )
    return answers


def _merge_submitted_answers(
    existing: Sequence[OptimizationAnswer],
    submitted: Sequence[OptimizationAnswer],
) -> list[OptimizationAnswer]:
    by_question = {answer.question_id: answer for answer in existing}
    merged = [answer.model_copy(deep=True) for answer in existing]
    for answer in submitted:
        prior = by_question.get(answer.question_id)
        if prior is not None:
            if prior != answer:
                raise OptimizationPlanNormalizationError(
                    "a question cannot be answered more than once with different content"
                )
            # Identical retry after a transient answer failure is idempotent.
            continue
        by_question[answer.question_id] = answer
        merged.append(answer.model_copy(deep=True))
    return merged


def _answer_documents(
    frozen: FrozenOptimizationContext,
    answers: Sequence[OptimizationAnswer],
) -> dict[str, Any]:
    documents = frozen.source_documents
    documents["userAnswers"] = {
        answer.question_id: {
            "state": answer.state.value,
            "value": answer.value,
        }
        for answer in answers
    }
    return documents


def _terminal_answer_change(change: OptimizationChange) -> OptimizationChange:
    if change.safety_status in {"allowed", "blocked"}:
        # The deterministic safety pass already established whether an
        # existing qualitative candidate is usable or why it is blocked.  A
        # missing fact answer must not erase either outcome.
        return change.model_copy(deep=True)
    return change.model_copy(
        update={
            "action_kind": OptimizationAction.LEAVE_UNCHANGED,
            "general_value": None,
            "targeted_value": None,
            "source_refs": [],
            "introduced_terms": [],
            "expected_score_gain": 0,
            "default_selected": False,
            "safety_status": "pending",
            "safety_findings": [],
        },
        deep=True,
    )


async def _record_failed_and_commit(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    exc: Exception,
    request_id: str,
) -> None:
    await record_run_error(
        session,
        user_id,
        run_id,
        _public_error_metadata(exc, request_id=request_id),
    )
    await _commit(session)


@runtime_budget.ai_deadline_scoped
async def create_optimization_plan(
    *,
    session: AsyncSession,
    user_id: str,
    payload: ResumeOptimizationStartRequest,
    idempotency_key: str | None,
    progress_callback: ProgressCallback = None,
    request_id: str | None = None,
) -> ResumeOptimizationRun:
    resolved_request_id = request_id or new_ai_request_id()

    preflight_claim = None
    if idempotency_key is not None:
        preflight_claim = await preflight_idempotent_run(
            session,
            user_id,
            payload,
            idempotency_key=idempotency_key,
            claim_id=resolved_request_id,
        )
        # Release the short owner-scoped preflight lock before context or AI.
        await _commit(session)
        if preflight_claim is not None and not preflight_claim.claimed:
            return preflight_claim.run

    if preflight_claim is None:
        await _emit_progress(
            progress_callback,
            node="freeze_snapshot",
            title=_PLAN_PROGRESS_TITLES["freeze_snapshot"],
            request_id=resolved_request_id,
        )
        frozen = await build_frozen_optimization_context(session, user_id, payload)
        await _emit_progress(
            progress_callback,
            node="prepare_context",
            title=_PLAN_PROGRESS_TITLES["prepare_context"],
            request_id=resolved_request_id,
        )
        claim = await create_or_claim_run(
            session,
            user_id,
            payload,
            idempotency_key=idempotency_key,
            source_snapshot_hash=frozen.snapshot_hash,
            source_jd_signature=frozen.jd_signature,
            before_snapshot=frozen.snapshot_payload(),
            claim_id=resolved_request_id,
        )
        # Make the planning claim recoverable and close the read transaction
        # before invoking the model.  No transaction spans AI latency.
        await _commit(session)
        run = claim.run
        if not claim.claimed:
            return run
    else:
        run = preflight_claim.run

    try:
        if preflight_claim is not None:
            # Every await after reclaim is owner-aware so cancellation or a
            # failing stream callback terminalizes this lease immediately.
            await _emit_progress(
                progress_callback,
                node="freeze_snapshot",
                title=_PLAN_PROGRESS_TITLES["freeze_snapshot"],
                request_id=resolved_request_id,
            )
            frozen = _frozen_context_from_snapshot(run.before_snapshot)
            await _emit_progress(
                progress_callback,
                node="prepare_context",
                title=_PLAN_PROGRESS_TITLES["prepare_context"],
                request_id=resolved_request_id,
            )
            # An expired worker lease may be reclaimed without trusting live
            # source content.  Validate the persisted frozen snapshot before
            # invoking AI, then close that read transaction.
            current_before = await build_frozen_optimization_context(
                session,
                user_id,
                payload,
            )
            _require_fresh_context(frozen, current_before)
            await _commit(session)
        await _emit_progress(
            progress_callback,
            node="plan_changes",
            title=_PLAN_PROGRESS_TITLES["plan_changes"],
            request_id=resolved_request_id,
        )
        evaluation_issues = frozen.evaluation.get("issues")
        _update_current_billing_metadata(
            route=_PLAN_BILLING_ROUTE,
            run=run,
            counts={
                "selected_experience_count": len(
                    frozen.selected_master_experience_ids
                ),
                "selected_skill_count": _selected_skill_count(frozen),
                "bank_candidate_count": len(frozen.bank_suggestion_candidates),
                "issue_count": (
                    len(evaluation_issues)
                    if isinstance(evaluation_issues, list)
                    else 0
                ),
            },
        )
        model_plan = await plan_resume_optimization(frozen)

        await _emit_progress(
            progress_callback,
            node="verify_changes",
            title=_PLAN_PROGRESS_TITLES["verify_changes"],
            request_id=resolved_request_id,
        )
        model_plan = await review_plan_semantics(
            plan=model_plan, source_documents=frozen.source_documents,
        )
        verified_changes, safety_summary = verify_plan_changes(
            plan=model_plan,
            source_documents=frozen.source_documents,
        )
        result_plan = _plan_with_verified_changes(
            model_plan,
            changes=verified_changes,
            safety_summary=safety_summary,
        )
        analysis_result, bank_metadata = _bank_suggestion_inputs(frozen)
        bank_suggestions = build_bank_suggestions(
            analysis_result=analysis_result,
            selected_master_ids=set(frozen.selected_master_experience_ids),
            bank_experience_metadata=bank_metadata,
        )
        result_plan = result_plan.model_copy(
            update={
                "bank_suggestions": [
                    suggestion.model_copy(deep=True)
                    for suggestion in bank_suggestions
                ]
            },
            deep=True,
        )

        # The AI call happened outside a transaction.  Reload and compare the
        # full start snapshot under a short Run->Resume lock immediately before
        # making the plan applicable.
        if not await lock_run_source_resume(
            session,
            user_id,
            str(run.id),
        ):
            raise OptimizationContextStaleError(
                "The source resume is no longer available"
            )
        current = await build_frozen_optimization_context(session, user_id, payload)
        _require_fresh_context(frozen, current)

        await _emit_progress(
            progress_callback,
            node="persist_run",
            title=_PLAN_PROGRESS_TITLES["persist_run"],
            request_id=resolved_request_id,
        )
        target = (
            ResumeOptimizationStatus.AWAITING_ANSWERS
            if result_plan.questions
            else ResumeOptimizationStatus.PREVIEW_READY
        )
        run = await complete_planning_run_claim(
            session,
            user_id,
            str(run.id),
            claim_id=resolved_request_id,
            plan_json=model_plan.model_dump(mode="json"),
            result_json=result_plan.model_dump(mode="json"),
            target_status=target,
        )
        await _commit(session)
        return run
    except asyncio.CancelledError:
        await _rollback(session)
        await record_planning_run_claim_terminal(
            session,
            user_id,
            str(run.id),
            claim_id=resolved_request_id,
            target_status=ResumeOptimizationStatus.CANCELLED,
            error_json={
                "type": "error",
                "code": "request_cancelled",
                "message": "优化规划已取消。",
                "requestId": resolved_request_id,
                "retryable": True,
            },
        )
        await _commit(session)
        raise
    except OptimizationContextStaleError as exc:
        await _rollback(session)
        await record_planning_run_claim_terminal(
            session,
            user_id,
            str(run.id),
            claim_id=resolved_request_id,
            target_status=ResumeOptimizationStatus.STALE,
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise
    except OptimizationContextError as exc:
        await _rollback(session)
        stale_exc = OptimizationContextStaleError(
            "The frozen optimization source is no longer available"
        )
        await record_planning_run_claim_terminal(
            session,
            user_id,
            str(run.id),
            claim_id=resolved_request_id,
            target_status=ResumeOptimizationStatus.STALE,
            error_json=_public_error_metadata(
                stale_exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise stale_exc from exc
    except OptimizationPlanningClaimLostError:
        await _rollback(session)
        raise
    except Exception as exc:
        await _rollback(session)
        await record_planning_run_claim_terminal(
            session,
            user_id,
            str(run.id),
            claim_id=resolved_request_id,
            target_status=ResumeOptimizationStatus.FAILED,
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise


@runtime_budget.ai_deadline_scoped
async def answer_optimization_questions(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationAnswersRequest,
    progress_callback: ProgressCallback = None,
    request_id: str | None = None,
) -> ResumeOptimizationRun:
    resolved_request_id = request_id or new_ai_request_id()
    run = await get_run_for_user(session, user_id, run_id)
    # Release the recovery read transaction before validation or model work.
    await _commit(session)
    if run.status != ResumeOptimizationStatus.AWAITING_ANSWERS.value:
        raise InvalidOptimizationTransitionError(
            ResumeOptimizationStatus(run.status),
            ResumeOptimizationStatus.PREVIEW_READY,
        )

    # Persisted corruption is a terminal server-side failure.  Client answer
    # validation below is deliberately outside this block so a stale/bad
    # request cannot destroy an otherwise answerable run.
    try:
        frozen = _frozen_context_from_snapshot(run.before_snapshot)
        existing_plan = OptimizationPlan.model_validate(
            run.result_json or run.plan_json
        )
        questions_by_id = {
            question.question_id: question for question in existing_plan.questions
        }
        historical_answers = _stored_answers(run)
        if {
            answer.question_id for answer in historical_answers
        } - set(questions_by_id):
            raise OptimizationPlanNormalizationError(
                "persisted answers reference unknown questions"
            )
    except OptimizationContextStaleError as exc:
        await _rollback(session)
        await record_run_stale(
            session,
            user_id,
            run_id,
            _public_error_metadata(exc, request_id=resolved_request_id),
        )
        await _commit(session)
        raise
    except Exception as exc:
        await _record_failed_and_commit(
            session=session,
            user_id=user_id,
            run_id=run_id,
            exc=exc,
            request_id=resolved_request_id,
        )
        raise

    unknown = {
        answer.question_id for answer in payload.answers
    } - set(questions_by_id)
    if unknown:
        raise OptimizationAnswerValidationError()
    # A different repeat is a request conflict, not a terminal run failure.
    try:
        merged_answers = _merge_submitted_answers(
            historical_answers,
            payload.answers,
        )
    except OptimizationPlanNormalizationError as exc:
        raise OptimizationAnswerValidationError() from exc

    answer_request_hash = hash_canonical_json(payload.model_dump(mode="json"))
    try:
        answer_claim = await claim_run_for_answers(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            request_hash=answer_request_hash,
        )
        await _commit(session)
    except (
        OptimizationAnswerInProgressError,
        InvalidOptimizationTransitionError,
    ):
        # The claim helper mutates only after all conflicts have cleared.  A
        # commit safely releases its owner-scoped row lock on conflict.
        await _commit(session)
        raise
    except Exception:
        # Flush/deadlock/connection failures leave SQLAlchemy's transaction in
        # a failed state.  Roll back before surfacing the original exception.
        await _rollback(session)
        raise
    if not answer_claim.claimed:
        return answer_claim.run
    run = answer_claim.run

    try:
        # Re-read every authoritative artifact from the populate-existing
        # locked claim result.  This closes both the request race and a stale
        # expire_on_commit=False identity-map snapshot.
        frozen = _frozen_context_from_snapshot(run.before_snapshot)
        existing_plan = OptimizationPlan.model_validate(
            run.result_json or run.plan_json
        )
        questions_by_id = {
            question.question_id: question for question in existing_plan.questions
        }
        historical_answers = _stored_answers(run)
        if {
            answer.question_id for answer in historical_answers
        } - set(questions_by_id):
            raise OptimizationPlanNormalizationError(
                "persisted answers reference unknown questions"
            )
        if {
            answer.question_id for answer in payload.answers
        } - set(questions_by_id):
            await clear_answer_run_claim(
                session,
                user_id,
                run_id,
                claim_id=resolved_request_id,
            )
            await _commit(session)
            raise OptimizationAnswerValidationError()
        try:
            merged_answers = _merge_submitted_answers(
                historical_answers,
                payload.answers,
            )
        except OptimizationPlanNormalizationError as exc:
            await clear_answer_run_claim(
                session,
                user_id,
                run_id,
                claim_id=resolved_request_id,
            )
            await _commit(session)
            raise OptimizationAnswerValidationError() from exc

        await _emit_progress(
            progress_callback,
            node="prepare_context",
            title=_ANSWER_PROGRESS_TITLES["prepare_context"],
            request_id=resolved_request_id,
        )
        freshness_request = _freshness_request(run)
        current_before = await build_frozen_optimization_context(
            session,
            user_id,
            freshness_request,
        )
        _require_fresh_context(frozen, current_before)
        await _commit(session)

        merged_by_question = {
            answer.question_id: answer for answer in merged_answers
        }
        answered_question_ids = {
            answer.question_id
            for answer in merged_answers
            if answer.state == OptimizationAnswerState.ANSWERED
        }
        candidate_answered_ids = {
            change_id
            for question_id in answered_question_ids
            for change_id in questions_by_id[question_id].affects_change_ids
        }
        terminal_affected_ids = {
            change_id
            for answer in merged_answers
            if answer.state != OptimizationAnswerState.ANSWERED
            for change_id in questions_by_id[answer.question_id].affects_change_ids
        }
        question_ids_by_change: dict[str, set[str]] = {}
        for question in existing_plan.questions:
            for change_id in question.affects_change_ids:
                question_ids_by_change.setdefault(change_id, set()).add(
                    question.question_id
                )
        unresolved_change_ids = {
            change_id
            for change_id, question_ids in question_ids_by_change.items()
            if not question_ids <= set(merged_by_question)
        }
        # Mixed answered + terminal states are valid.  The planner normalizer
        # and safety layer receive both and allow factual citations only from
        # linked `answered` values.  A truly omitted question keeps the shared
        # change unresolved and out of the rewrite call.
        answered_affected_ids = candidate_answered_ids - unresolved_change_ids
        terminal_only_ids = (
            terminal_affected_ids
            - candidate_answered_ids
            - unresolved_change_ids
        )
        rewrite_questions = []
        answers_for_rewrite: list[OptimizationAnswer] = []
        for answer in merged_answers:
            question = questions_by_id[answer.question_id]
            safe_change_ids = [
                change_id
                for change_id in question.affects_change_ids
                if change_id in answered_affected_ids
            ]
            if not safe_change_ids:
                continue
            rewrite_questions.append(
                question.model_copy(
                    update={"affects_change_ids": safe_change_ids},
                    deep=True,
                )
            )
            answers_for_rewrite.append(answer)

        verified_rewrites: list[OptimizationChange] = []
        if answers_for_rewrite:
            await _emit_progress(
                progress_callback,
                node="rewrite_changes",
                title=_ANSWER_PROGRESS_TITLES["rewrite_changes"],
                request_id=resolved_request_id,
            )
            _update_current_billing_metadata(
                route=_ANSWER_BILLING_ROUTE,
                run=run,
                counts={
                    "question_count": len(existing_plan.questions),
                    "submitted_answer_count": len(payload.answers),
                    "answered_count": sum(
                        answer.state == OptimizationAnswerState.ANSWERED
                        for answer in merged_answers
                    ),
                    "no_data_count": sum(
                        answer.state == OptimizationAnswerState.NO_DATA
                        for answer in merged_answers
                    ),
                    "unknown_count": sum(
                        answer.state == OptimizationAnswerState.UNKNOWN
                        for answer in merged_answers
                    ),
                    "not_my_work_count": sum(
                        answer.state == OptimizationAnswerState.NOT_MY_WORK
                        for answer in merged_answers
                    ),
                    "skipped_count": sum(
                        answer.state == OptimizationAnswerState.SKIPPED
                        for answer in merged_answers
                    ),
                    "rewrite_question_count": len(rewrite_questions),
                    "affected_change_count": len(answered_affected_ids),
                },
            )
            rewrites = await rewrite_answered_modules(
                context=frozen,
                existing_plan=existing_plan.model_copy(
                    update={"questions": rewrite_questions},
                    deep=True,
                ),
                answers=answers_for_rewrite,
            )
            rewrite_ids = {change.change_id for change in rewrites}
            if rewrite_ids != answered_affected_ids:
                raise OptimizationPlanNormalizationError(
                    "answer rewrite changed the affected change-ID set"
                )

            await _emit_progress(
                progress_callback,
                node="verify_changes",
                title=_ANSWER_PROGRESS_TITLES["verify_changes"],
                request_id=resolved_request_id,
            )
            # Recheck only newly replaced changes.  Untouched blocked changes
            # retain their original blocked status and explanatory findings.
            reviewed_rewrites = await review_plan_semantics(
                plan=OptimizationPlan(changes=rewrites, questions=existing_plan.questions),
                source_documents=_answer_documents(frozen, merged_answers),
            )
            verified_rewrites, _ = verify_plan_changes(
                plan=reviewed_rewrites,
                source_documents=_answer_documents(frozen, merged_answers),
            )

        replacements = {
            change.change_id: change for change in verified_rewrites
        }
        final_changes: list[OptimizationChange] = []
        for change in existing_plan.changes:
            if change.change_id in replacements:
                final_changes.append(replacements[change.change_id])
            elif change.change_id in terminal_only_ids:
                final_changes.append(_terminal_answer_change(change))
            else:
                final_changes.append(change.model_copy(deep=True))

        result_plan = existing_plan.model_copy(
            update={
                "changes": final_changes,
                "safety_summary": _summary_from_changes(final_changes),
            },
            deep=True,
        )

        # Recheck immediately before persistence, including no-LLM terminal
        # answer paths.  Hold the short Run->Resume lock through commit; the
        # frozen snapshot remains the only rewrite evidence.
        if not await lock_run_source_resume(session, user_id, run_id):
            raise OptimizationContextStaleError(
                "The source resume is no longer available"
            )
        current_after = await build_frozen_optimization_context(
            session,
            user_id,
            freshness_request,
        )
        _require_fresh_context(frozen, current_after)

        await _emit_progress(
            progress_callback,
            node="persist_run",
            title=_ANSWER_PROGRESS_TITLES["persist_run"],
            request_id=resolved_request_id,
        )
        answers_json = {
            "answers": [
                answer.model_dump(mode="json") for answer in merged_answers
            ]
        }
        run = await complete_answer_run_claim(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json=answers_json,
            result_json=result_plan.model_dump(mode="json"),
        )
        await _commit(session)
        return run
    except asyncio.CancelledError:
        await _rollback(session)
        await clear_answer_run_claim(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
        )
        await _commit(session)
        raise
    except OptimizationContextStaleError as exc:
        await _rollback(session)
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json") for answer in merged_answers
                ]
            },
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
            terminal_status=ResumeOptimizationStatus.STALE,
        )
        await _commit(session)
        raise
    except OptimizationContextError as exc:
        await _rollback(session)
        stale_exc = OptimizationContextStaleError(
            "The frozen optimization source is no longer available"
        )
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json") for answer in merged_answers
                ]
            },
            error_json=_public_error_metadata(
                stale_exc,
                request_id=resolved_request_id,
            ),
            terminal_status=ResumeOptimizationStatus.STALE,
        )
        await _commit(session)
        raise stale_exc from exc
    except OptimizationAnswerClaimLostError:
        await _rollback(session)
        raise
    except OptimizationAnswerValidationError:
        # The claim was explicitly released by the validation race path above.
        # A client conflict must not terminalize the server-owned run.
        raise
    except (OptimizationAnswerRewriteNormalizationError, OptimizationSemanticReviewNormalizationError) as exc:
        await _rollback(session)
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json") for answer in merged_answers
                ]
            },
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise
    except (httpx.HTTPError, AiProviderUnavailableError) as exc:
        await _rollback(session)
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json") for answer in merged_answers
                ]
            },
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise
    except runtime_budget.TERMINAL_AI_RUNTIME_ERRORS as exc:
        await _rollback(session)
        # Retryable terminal failures retain the idempotent draft.  A
        # non-retryable runtime failure releases the claim without freezing the
        # newly submitted content into immutable answer history.
        retained_answers = merged_answers if exc.retryable else historical_answers
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json")
                    for answer in retained_answers
                ]
            },
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
        )
        await _commit(session)
        raise
    except Exception as exc:
        await _rollback(session)
        await record_answer_run_claim_error(
            session,
            user_id,
            run_id,
            claim_id=resolved_request_id,
            answers_json={
                "answers": [
                    answer.model_dump(mode="json") for answer in merged_answers
                ]
            },
            error_json=_public_error_metadata(
                exc,
                request_id=resolved_request_id,
            ),
            terminal_status=ResumeOptimizationStatus.FAILED,
        )
        await _commit(session)
        raise
