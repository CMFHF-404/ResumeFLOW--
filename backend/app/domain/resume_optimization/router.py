from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Annotated, Any
import uuid

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.background import BackgroundTask

from ...database import AsyncSessionFactory, get_session
from ...dependencies import get_current_user
from ...utils.ndjson import ndjson_line
from ..ai import runtime_budget
from ..ai.public_errors import (
    AI_PROVIDER_INVALID_RESPONSE_MESSAGE,
    AI_PROVIDER_UNAVAILABLE_MESSAGE,
    AiProviderPayloadError,
    AiProviderUnavailableError,
)
from ..ai.runtime_budget import (
    BoundedAiRequestBodyRoute,
    build_public_stream_error_event,
    create_bounded_event_queue,
    finish_event_queue,
    new_ai_request_id,
)
from ..billing import billing_service
from .context_service import OptimizationContextError
from .models import ResumeOptimizationRun
from .normalizers import OptimizationPlanNormalizationError
from .orchestrator import (
    OptimizationAnswerValidationError,
    answer_optimization_questions,
    create_optimization_plan,
)
from .run_service import (
    OptimizationAnswerClaimLostError,
    OptimizationAnswerInProgressError,
    OptimizationIdempotencyConflictError,
    OptimizationPlanningClaimLostError,
    OptimizationRunNotFoundError,
    get_latest_run_for_resume,
    get_run_for_user,
    transition_run,
)
from .schemas import (
    OptimizationAnswer,
    OptimizationPlan,
    ResumeOptimizationAnswersRequest,
    ResumeOptimizationRunRead,
    ResumeOptimizationStartRequest,
    ResumeOptimizationStatus,
)
from .state_machine import InvalidOptimizationTransitionError


router = APIRouter(
    prefix="/api/resume-optimizations",
    tags=["resume-optimization"],
    route_class=BoundedAiRequestBodyRoute,
)


class OptimizationPersistedRunInvalidError(RuntimeError):
    code = "resume_optimization_run_invalid"
    status_code = 500
    public_message = "简历优化记录数据异常，请重新生成优化方案。"
    retryable = False

    def __init__(self) -> None:
        super().__init__("Persisted resume optimization run is invalid")


_SAFE_DOMAIN_MESSAGES = {
    "resume_optimization_run_not_found": "未找到该简历优化记录。",
    "resume_optimization_idempotency_conflict": "该幂等键已用于不同的优化请求。",
    "invalid_optimization_transition": "当前优化状态不允许执行此操作。",
    "resume_optimization_context_error": "无法准备简历优化上下文。",
    "resume_optimization_context_request_invalid": "简历优化请求无效。",
    "resume_optimization_context_not_found": "未找到待优化的简历。",
    "resume_optimization_context_stale": "简历内容或六维评估已更新，请重新生成优化方案。",
    "resume_optimization_evaluation_invalid": "当前六维评估不可用于优化。",
    "resume_optimization_selection_invalid": "当前简历经历选择不可用于优化。",
    "resume_optimization_answers_invalid": OptimizationAnswerValidationError.public_message,
    "resume_optimization_answer_in_progress": OptimizationAnswerInProgressError.public_message,
    "resume_optimization_answer_claim_lost": OptimizationAnswerClaimLostError.public_message,
    "resume_optimization_planning_claim_lost": OptimizationPlanningClaimLostError.public_message,
    "resume_optimization_plan_invalid": AI_PROVIDER_INVALID_RESPONSE_MESSAGE,
    "resume_optimization_run_invalid": OptimizationPersistedRunInvalidError.public_message,
}
_DOMAIN_ERROR_TYPES = (
    OptimizationContextError,
    OptimizationRunNotFoundError,
    OptimizationIdempotencyConflictError,
    InvalidOptimizationTransitionError,
    OptimizationAnswerValidationError,
    OptimizationAnswerInProgressError,
    OptimizationAnswerClaimLostError,
    OptimizationPlanningClaimLostError,
    OptimizationPlanNormalizationError,
    OptimizationPersistedRunInvalidError,
)


def _domain_status_code(exc: Exception) -> int:
    explicit = getattr(exc, "status_code", None)
    if isinstance(explicit, int):
        return explicit
    if isinstance(exc, OptimizationRunNotFoundError):
        return 404
    if isinstance(exc, OptimizationPlanNormalizationError):
        return 502
    if isinstance(
        exc,
        (
            OptimizationIdempotencyConflictError,
            InvalidOptimizationTransitionError,
            OptimizationAnswerInProgressError,
            OptimizationAnswerClaimLostError,
            OptimizationPlanningClaimLostError,
        ),
    ):
        return 409
    return 400


def _domain_error_detail(exc: Exception) -> dict[str, Any]:
    code = str(getattr(exc, "code", "resume_optimization_request_failed"))
    return {
        "code": code,
        "message": _SAFE_DOMAIN_MESSAGES.get(
            code,
            "简历优化请求失败，请稍后重试。",
        ),
    }


def _raise_domain_http_error(exc: Exception) -> None:
    raise HTTPException(
        status_code=_domain_status_code(exc),
        detail=_domain_error_detail(exc),
    ) from exc


def _stream_error_event(exc: Exception, *, request_id: str) -> dict[str, Any]:
    if isinstance(exc, runtime_budget.TERMINAL_AI_RUNTIME_ERRORS):
        return build_public_stream_error_event(exc, request_id=request_id)
    if isinstance(exc, _DOMAIN_ERROR_TYPES):
        detail = _domain_error_detail(exc)
        return {
            "type": "error",
            **detail,
            "requestId": request_id,
            "statusCode": _domain_status_code(exc),
            "retryable": bool(getattr(exc, "retryable", False)),
        }
    if isinstance(exc, AiProviderPayloadError):
        return {
            "type": "error",
            "code": "ai_provider_invalid_response",
            "message": AI_PROVIDER_INVALID_RESPONSE_MESSAGE,
            "requestId": request_id,
            "statusCode": 502,
            "retryable": False,
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
    event = build_public_stream_error_event(exc, request_id=request_id)
    event.setdefault("statusCode", 500)
    return event


def _require_idempotency_key(raw_value: str | None) -> str:
    if raw_value is None or not raw_value.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "resume_optimization_idempotency_key_required",
                "message": "缺少 Idempotency-Key 请求头。",
            },
        )
    try:
        parsed = uuid.UUID(raw_value.strip())
    except (AttributeError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "resume_optimization_idempotency_key_invalid",
                "message": "Idempotency-Key 必须是有效 UUID。",
            },
        ) from exc
    return str(parsed)


def _resolve_idempotency_key(request: Request, bound_value: str | None) -> str:
    headers = getattr(request, "headers", None)
    getlist = getattr(headers, "getlist", None)
    values = list(getlist("idempotency-key")) if callable(getlist) else []
    if len(values) > 1:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "resume_optimization_idempotency_key_invalid",
                "message": "Idempotency-Key 请求头不能重复。",
            },
        )
    return _require_idempotency_key(values[0] if values else bound_value)


def _answers_from_run(run: ResumeOptimizationRun) -> list[OptimizationAnswer]:
    if not isinstance(run.answers_json, dict):
        raise ValueError("answers_json must be an object")
    raw_answers = run.answers_json.get("answers", [])
    if not isinstance(raw_answers, list):
        raise ValueError("answers_json.answers must be an array")
    answers = [
        OptimizationAnswer.model_validate(raw_answer) for raw_answer in raw_answers
    ]
    question_ids = [answer.question_id for answer in answers]
    if len(question_ids) != len(set(question_ids)):
        raise ValueError("persisted answers must have unique question IDs")
    return answers


_PERSISTED_PLAN_ROOT_KEYS = frozenset(
    {
        "changes",
        "questions",
        "bank_suggestions",
        "safety_summary",
    }
)


def _validated_persisted_plan(
    payload: Any,
    *,
    empty_as_missing: bool,
) -> OptimizationPlan | None:
    if not isinstance(payload, dict):
        raise ValueError("persisted plan payload must be an object")
    if not payload:
        return None if empty_as_missing else OptimizationPlan()
    if set(payload) != _PERSISTED_PLAN_ROOT_KEYS:
        raise ValueError("persisted plan payload must have the complete root shape")

    plan = OptimizationPlan.model_validate(payload)
    change_ids = [change.change_id for change in plan.changes]
    if len(change_ids) != len(set(change_ids)):
        raise ValueError("persisted changes must have unique change IDs")
    question_ids = [question.question_id for question in plan.questions]
    if len(question_ids) != len(set(question_ids)):
        raise ValueError("persisted questions must have unique question IDs")
    return plan


def _run_to_read(run: ResumeOptimizationRun) -> ResumeOptimizationRunRead:
    try:
        stored_plan = _validated_persisted_plan(
            run.plan_json,
            empty_as_missing=False,
        )
        assert stored_plan is not None
        stored_result = _validated_persisted_plan(
            run.result_json,
            empty_as_missing=True,
        )
        plan = stored_result or stored_plan
        public_result = (
            stored_result.model_dump(mode="json")
            if stored_result is not None
            else {}
        )
        return ResumeOptimizationRunRead(
            id=str(run.id),
            resume_id=str(run.resume_id),
            status=ResumeOptimizationStatus(run.status),
            optimizer_version=run.optimizer_version,
            policy_version=run.policy_version,
            prompt_version=run.prompt_version,
            source_resume_updated_at=run.source_resume_updated_at,
            source_evaluation_signature=run.source_evaluation_signature,
            source_jd_signature=run.source_jd_signature,
            source_snapshot_hash=run.source_snapshot_hash,
            plan=plan,
            answers=_answers_from_run(run),
            result=public_result,
            accepted_change_ids=list(run.accepted_change_ids),
            applied_content_signature=run.applied_content_signature,
            created_at=run.created_at,
            updated_at=run.updated_at,
            applied_at=run.applied_at,
            completed_at=run.completed_at,
        )
    except OptimizationPersistedRunInvalidError:
        raise
    except Exception as exc:
        raise OptimizationPersistedRunInvalidError() from exc


StreamOperation = Callable[
    [AsyncSession, Callable[[dict[str, Any]], Awaitable[None]], str],
    Awaitable[ResumeOptimizationRun],
]


class _LeaseReleaseGuard:
    def __init__(self, request_lease: Any) -> None:
        self._request_lease = request_lease
        self._lock = asyncio.Lock()
        self._released = False

    async def release(self) -> None:
        if self._request_lease is None:
            return
        async with self._lock:
            if self._released:
                return
            await self._request_lease.release()
            self._released = True


async def _begin_stream_request(
    *,
    session: AsyncSession,
    user_id: str,
    entrypoint: str,
) -> tuple[Any, _LeaseReleaseGuard]:
    request_lease = await billing_service.begin_ai_request(
        session,
        user_id,
        entrypoint=entrypoint,
    )
    release_guard = _LeaseReleaseGuard(request_lease)
    try:
        # FastAPI versions supported by this service may close yield dependencies
        # before StreamingResponse consumes its body. End the request-scoped
        # transaction here and let the producer use its own session below.
        await session.commit()
    except BaseException:
        try:
            await session.rollback()
        except Exception:
            pass
        try:
            await release_guard.release()
        except Exception:
            pass
        raise
    return request_lease, release_guard


def _stream_response(
    *,
    user_id: str,
    entrypoint: str,
    route_metadata: str,
    request_lease: Any,
    release_guard: _LeaseReleaseGuard,
    request_id: str,
    operation: StreamOperation,
    progress_node_aliases: dict[str, str] | None = None,
) -> StreamingResponse:
    async def event_stream():
        queue = create_bounded_event_queue()

        async def emit(event: dict[str, Any]) -> None:
            public_event = dict(event)
            node = public_event.get("node")
            if isinstance(node, str) and progress_node_aliases:
                public_node = progress_node_aliases.get(node)
                if public_node is not None:
                    public_event["node"] = public_node
                    if public_node == "rewrite_answers":
                        public_event["title"] = "根据补充信息更新方案"
            await queue.put(public_event)

        async def run_operation() -> None:
            try:
                async with AsyncSessionFactory() as producer_session:
                    async with billing_service.ai_billing_context(
                        producer_session,
                        user_id,
                        entrypoint=entrypoint,
                        metadata={"route": route_metadata},
                        request_lease=request_lease,
                        release_request_lease_on_exit=False,
                    ):
                        run = await operation(producer_session, emit, request_id)
                await emit(
                    {
                        "type": "final",
                        "result": _run_to_read(run).model_dump(mode="json"),
                        "requestId": request_id,
                    }
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await emit(_stream_error_event(exc, request_id=request_id))
            finally:
                await finish_event_queue(queue)

        producer = asyncio.create_task(run_operation())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield ndjson_line(event)
        finally:
            if not producer.done():
                producer.cancel()
            try:
                await producer
            except asyncio.CancelledError:
                pass
            await release_guard.release()

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        background=BackgroundTask(release_guard.release),
    )


@router.post("/stream")
async def start_resume_optimization_stream(
    request: Request,
    payload: ResumeOptimizationStartRequest,
    idempotency_key: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    resolved_key = _resolve_idempotency_key(request, idempotency_key)
    request_lease, release_guard = await _begin_stream_request(
        session=session,
        user_id=current_user.id,
        entrypoint="resume_optimization_plan",
    )
    request_id = new_ai_request_id()

    async def operation(producer_session, emit, resolved_request_id):
        return await create_optimization_plan(
            session=producer_session,
            user_id=current_user.id,
            payload=payload,
            idempotency_key=resolved_key,
            progress_callback=emit,
            request_id=resolved_request_id,
        )

    return _stream_response(
        user_id=current_user.id,
        entrypoint="resume_optimization_plan",
        route_metadata="/api/resume-optimizations/stream",
        request_lease=request_lease,
        release_guard=release_guard,
        request_id=request_id,
        operation=operation,
    )


@router.get("/latest", response_model=ResumeOptimizationRunRead)
async def get_latest_resume_optimization_run(
    resume_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> ResumeOptimizationRunRead:
    try:
        run = await get_latest_run_for_resume(
            session,
            current_user.id,
            resume_id,
        )
        if run is None:
            raise OptimizationRunNotFoundError(resume_id)
        return _run_to_read(run)
    except _DOMAIN_ERROR_TYPES as exc:
        _raise_domain_http_error(exc)


@router.post("/{run_id}/answers/stream")
async def answer_resume_optimization_stream(
    run_id: str,
    request: Request,
    payload: ResumeOptimizationAnswersRequest,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    del request
    request_lease, release_guard = await _begin_stream_request(
        session=session,
        user_id=current_user.id,
        entrypoint="resume_optimization_answer",
    )
    request_id = new_ai_request_id()

    async def operation(producer_session, emit, resolved_request_id):
        return await answer_optimization_questions(
            session=producer_session,
            user_id=current_user.id,
            run_id=run_id,
            payload=payload,
            progress_callback=emit,
            request_id=resolved_request_id,
        )

    return _stream_response(
        user_id=current_user.id,
        entrypoint="resume_optimization_answer",
        route_metadata=f"/api/resume-optimizations/{run_id}/answers/stream",
        request_lease=request_lease,
        release_guard=release_guard,
        request_id=request_id,
        operation=operation,
        progress_node_aliases={"rewrite_changes": "rewrite_answers"},
    )


@router.post("/{run_id}/cancel", response_model=ResumeOptimizationRunRead)
async def cancel_resume_optimization_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> ResumeOptimizationRunRead:
    try:
        current_run = await get_run_for_user(session, current_user.id, run_id)
        _run_to_read(current_run)
        run = await transition_run(
            session,
            current_user.id,
            run_id,
            ResumeOptimizationStatus.CANCELLED,
        )
        result = _run_to_read(run)
        await session.commit()
    except _DOMAIN_ERROR_TYPES as exc:
        await session.rollback()
        _raise_domain_http_error(exc)
    return result


@router.get("/{run_id}", response_model=ResumeOptimizationRunRead)
async def get_resume_optimization_run(
    run_id: str,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> ResumeOptimizationRunRead:
    try:
        run = await get_run_for_user(session, current_user.id, run_id)
        return _run_to_read(run)
    except _DOMAIN_ERROR_TYPES as exc:
        _raise_domain_http_error(exc)
