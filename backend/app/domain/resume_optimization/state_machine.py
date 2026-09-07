from __future__ import annotations

from .schemas import ResumeOptimizationStatus


class InvalidOptimizationTransitionError(ValueError):
    code = "invalid_optimization_transition"

    def __init__(
        self,
        current: ResumeOptimizationStatus,
        target: ResumeOptimizationStatus,
    ) -> None:
        self.current = current
        self.target = target
        super().__init__(
            f"invalid resume optimization transition: {current.value} -> {target.value}",
        )


_LEGAL_STATUS_TRANSITIONS: dict[
    ResumeOptimizationStatus,
    frozenset[ResumeOptimizationStatus],
] = {
    ResumeOptimizationStatus.PLANNING: frozenset(
        {
            ResumeOptimizationStatus.AWAITING_ANSWERS,
            ResumeOptimizationStatus.PREVIEW_READY,
            ResumeOptimizationStatus.FAILED,
            ResumeOptimizationStatus.CANCELLED,
        },
    ),
    ResumeOptimizationStatus.AWAITING_ANSWERS: frozenset(
        {
            ResumeOptimizationStatus.PREVIEW_READY,
            ResumeOptimizationStatus.FAILED,
            ResumeOptimizationStatus.STALE,
            ResumeOptimizationStatus.CANCELLED,
        },
    ),
    ResumeOptimizationStatus.PREVIEW_READY: frozenset(
        {
            ResumeOptimizationStatus.APPLYING,
            ResumeOptimizationStatus.STALE,
            ResumeOptimizationStatus.CANCELLED,
        },
    ),
    ResumeOptimizationStatus.APPLYING: frozenset(
        {
            ResumeOptimizationStatus.APPLIED,
            ResumeOptimizationStatus.FAILED,
            ResumeOptimizationStatus.STALE,
        },
    ),
    ResumeOptimizationStatus.APPLIED: frozenset(
        {
            ResumeOptimizationStatus.RESCORING,
            ResumeOptimizationStatus.REVERTED,
        },
    ),
    ResumeOptimizationStatus.RESCORING: frozenset(
        {
            ResumeOptimizationStatus.COMPLETED,
            ResumeOptimizationStatus.APPLIED,
        },
    ),
    ResumeOptimizationStatus.COMPLETED: frozenset(
        {
            ResumeOptimizationStatus.REVERTED,
        },
    ),
}


def require_status_transition(
    current: ResumeOptimizationStatus,
    target: ResumeOptimizationStatus,
    *,
    allow_rescore_retry: bool = False,
) -> None:
    if (
        allow_rescore_retry
        and current == ResumeOptimizationStatus.APPLIED
        and target == ResumeOptimizationStatus.APPLIED
    ):
        return
    if target not in _LEGAL_STATUS_TRANSITIONS.get(current, frozenset()):
        raise InvalidOptimizationTransitionError(current, target)
