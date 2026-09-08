from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


OPTIMIZER_VERSION = "resume_optimization_v1"
POLICY_VERSION = "json_structure_v1"
PROMPT_VERSION = "resume_optimization_single_pass_v1"
RESUME_EVALUATION_DIMENSION_NAMES = (
    "逻辑清晰",
    "STAR应用",
    "内容可读",
    "内容完整",
    "专业表达",
    "成果量化",
)


class ResumeOptimizationStatus(str, Enum):
    PLANNING = "planning"
    AWAITING_ANSWERS = "awaiting_answers"
    PREVIEW_READY = "preview_ready"
    APPLYING = "applying"
    APPLIED = "applied"
    RESCORING = "rescoring"
    COMPLETED = "completed"
    FAILED = "failed"
    STALE = "stale"
    CANCELLED = "cancelled"
    REVERTED = "reverted"


class OptimizationAction(str, Enum):
    REWRITE_NOW = "rewrite_now"
    ASK_USER = "ask_user"
    SUGGEST_FROM_BANK = "suggest_from_bank"
    LEAVE_UNCHANGED = "leave_unchanged"


class OptimizationScope(str, Enum):
    GENERAL = "general"
    JD_TARGETED = "jd_targeted"


class OptimizationModuleType(str, Enum):
    EXPERIENCE_STAR = "experience_star"
    PERSONAL_SUMMARY = "personal_summary"
    SKILLS_ORDER = "skills_order"
    SECTION_ORDER = "section_order"
    BANK_SUGGESTION = "bank_suggestion"


class OptimizationAnswerState(str, Enum):
    ANSWERED = "answered"
    NO_DATA = "no_data"
    UNKNOWN = "unknown"
    NOT_MY_WORK = "not_my_work"
    SKIPPED = "skipped"


def _require_non_empty(value: str, *, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be empty")
    return value


def _validate_order_ids(value: Any, *, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array of existing IDs")

    resolved: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field_name} must contain non-empty string IDs")
        resolved.append(item)
    if len(set(resolved)) != len(resolved):
        raise ValueError(f"{field_name} must not contain duplicate IDs")
    return resolved


def _validate_non_empty_unique_ids(
    value: list[str],
    *,
    field_name: str,
) -> list[str]:
    seen: set[str] = set()
    for item in value:
        _require_non_empty(item, field_name=field_name)
        if item in seen:
            raise ValueError(f"{field_name} must not contain duplicate IDs")
        seen.add(item)
    return value


class OptimizationSemanticReview(BaseModel):
    """Server-created receipt; never accepted from the planning model or apply API."""

    model_config = ConfigDict(extra="forbid", strict=True)
    input_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    policy_version: str
    verdict: Literal["supported", "unsupported", "uncertain"]
    reason: str = Field(min_length=1, max_length=1000)


class OptimizationChange(BaseModel):
    change_id: str
    issue_ids: list[str]
    dimension: str
    module_type: OptimizationModuleType
    module_id: str
    field_path: str
    action_kind: OptimizationAction
    scope: OptimizationScope
    before_value: Any
    general_value: Any | None = None
    targeted_value: Any | None = None
    source_refs: list[str]
    introduced_terms: list[str] = Field(default_factory=list)
    rationale: str
    # Retained only for historical/internal ranking compatibility. It is never
    # serialized into storage or a public optimization response.
    expected_score_gain: int = Field(default=0, ge=0, le=100, exclude=True)
    default_selected: bool = True
    safety_status: Literal["pending", "allowed", "blocked", "not_reviewed"] = "pending"
    safety_findings: list[str] = Field(default_factory=list)
    semantic_review: OptimizationSemanticReview | None = None

    @field_validator("change_id", "module_id", "field_path")
    @classmethod
    def _validate_required_identifiers(cls, value: str, info) -> str:
        return _require_non_empty(value, field_name=info.field_name)

    @field_validator("source_refs")
    @classmethod
    def _validate_source_refs(cls, value: list[str]) -> list[str]:
        for source_ref in value:
            if not isinstance(source_ref, str) or not source_ref.strip():
                raise ValueError("source_refs must contain non-empty references")
        return value

    @model_validator(mode="after")
    def _validate_change_contract(self):
        if self.action_kind == OptimizationAction.REWRITE_NOW and (
            self.general_value is None or self.targeted_value is None
        ):
            raise ValueError(
                "rewrite_now actions require general_value and targeted_value",
            )

        text_module = self.module_type in {
            OptimizationModuleType.EXPERIENCE_STAR,
            OptimizationModuleType.PERSONAL_SUMMARY,
        }
        has_rewritten_value = (
            self.general_value is not None or self.targeted_value is not None
        )
        text_changing = text_module and (
            self.action_kind == OptimizationAction.REWRITE_NOW
            or (
                self.action_kind == OptimizationAction.ASK_USER
                and has_rewritten_value
            )
        )
        if text_changing and self.safety_status != "not_reviewed" and not self.source_refs:
            raise ValueError("text-changing actions require source_refs")

        if self.module_type not in {
            OptimizationModuleType.SKILLS_ORDER,
            OptimizationModuleType.SECTION_ORDER,
        }:
            return self

        existing_ids = _validate_order_ids(
            self.before_value,
            field_name="before_value",
        )
        existing_id_set = set(existing_ids)
        for field_name in ("general_value", "targeted_value"):
            value = getattr(self, field_name)
            if value is None:
                continue
            ordered_ids = _validate_order_ids(value, field_name=field_name)
            if len(ordered_ids) != len(existing_ids) or set(ordered_ids) != existing_id_set:
                raise ValueError(
                    f"{field_name} must reorder exactly the existing IDs",
                )
        return self


class OptimizationQuestionChoice(BaseModel):
    value: str
    label: str

    @field_validator("value", "label")
    @classmethod
    def _validate_choice_text(cls, value: str, info) -> str:
        return _require_non_empty(value, field_name=info.field_name)


class OptimizationQuestion(BaseModel):
    question_id: str
    module_id: str
    field_path: str
    text: str
    reason: str
    answer_type: Literal["single_choice_with_text"] = "single_choice_with_text"
    choices: list[OptimizationQuestionChoice] = Field(default_factory=list)
    affects_change_ids: list[str] = Field(default_factory=list)
    priority: int = Field(default=0, ge=0)

    @field_validator("question_id", "module_id", "field_path")
    @classmethod
    def _validate_required_identifiers(cls, value: str, info) -> str:
        return _require_non_empty(value, field_name=info.field_name)


class OptimizationAnswer(BaseModel):
    question_id: str
    state: OptimizationAnswerState
    value: str = ""

    @field_validator("question_id")
    @classmethod
    def _validate_question_id(cls, value: str) -> str:
        return _require_non_empty(value, field_name="question_id")

    @model_validator(mode="after")
    def _validate_answer_value(self):
        if self.state == OptimizationAnswerState.ANSWERED and not self.value.strip():
            raise ValueError("answered responses require a non-empty value")
        return self


class BankSuggestion(BaseModel):
    suggestion_id: str
    master_experience_id: str
    category: str
    title: str
    org: str
    match_score: int = Field(ge=0, le=100)
    reason: str
    capabilities: list[str] = Field(default_factory=list)

    @field_validator("suggestion_id", "master_experience_id")
    @classmethod
    def _validate_suggestion_identifiers(cls, value: str, info) -> str:
        return _require_non_empty(value, field_name=info.field_name)


class OptimizationSafetySummary(BaseModel):
    allowed_change_ids: list[str] = Field(default_factory=list)
    blocked_change_ids: list[str] = Field(default_factory=list)
    pending_change_ids: list[str] = Field(default_factory=list)
    findings: list[str] = Field(default_factory=list)


class OptimizationPlan(BaseModel):
    changes: list[OptimizationChange] = Field(default_factory=list)
    # Storage/protocol ceilings. New plans use the configured lower limits at
    # generation and selection time; lowering them must not invalidate saved runs.
    questions: list[OptimizationQuestion] = Field(default_factory=list, max_length=5)
    bank_suggestions: list[BankSuggestion] = Field(default_factory=list, max_length=3)
    safety_summary: OptimizationSafetySummary = Field(
        default_factory=OptimizationSafetySummary,
    )
    # Server-side planning evidence, never part of a public preview/apply payload.
    coverage: list[dict[str, Any]] = Field(default_factory=list, exclude=True)
    cleanup_fallbacks: dict[str, OptimizationChange] = Field(default_factory=dict, exclude=True)
    planning_tasks: dict[str, Any] = Field(default_factory=dict, exclude=True)

    @classmethod
    def from_storage(cls, payload: Any) -> OptimizationPlan:
        """Read complete public plans with optional server-owned metadata."""
        public_keys = {"changes", "questions", "bank_suggestions", "safety_summary"}
        private_keys = {"coverage", "cleanup_fallbacks", "planning_tasks"}
        if not isinstance(payload, Mapping) or set(payload) - private_keys != public_keys:
            raise ValueError("Persisted plan must have the complete root shape")
        return cls.model_validate(dict(payload))

    def storage_dump(self) -> dict[str, Any]:
        return {
            **self.model_dump(mode="json"),
            "coverage": self.coverage,
            "planning_tasks": self.planning_tasks,
            "cleanup_fallbacks": {
                key: value.model_dump(mode="json") for key, value in self.cleanup_fallbacks.items()
            },
        }


class ResumeOptimizationDimensionDelta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: str
    beforeScore: int = Field(ge=0, le=100)
    afterScore: int = Field(ge=0, le=100)
    delta: int = Field(ge=-100, le=100)


class ResumeOptimizationIssueCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    before: int = Field(ge=0)
    after: int = Field(ge=0)
    resolved: int = Field(ge=0)
    remaining: int = Field(ge=0)
    introduced: int = Field(ge=0)


class ResumeOptimizationPostEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal["resume_optimization_post_evaluation_v1"]
    evaluationSignature: str
    resumeUpdatedAt: datetime
    beforeScore: int = Field(ge=0, le=100)
    afterScore: int = Field(ge=0, le=100)
    scoreDelta: int = Field(ge=-100, le=100)
    dimensionDeltas: list[ResumeOptimizationDimensionDelta] = Field(
        min_length=6,
        max_length=6,
    )
    issueCounts: ResumeOptimizationIssueCounts
    unresolvedFactGapCount: int = Field(ge=0)
    acceptedChangeCount: int = Field(ge=0)
    blockedChangeCount: int = Field(ge=0)
    bankSuggestionCount: int = Field(ge=0)
    safetySummary: OptimizationSafetySummary

    @field_validator("evaluationSignature")
    @classmethod
    def _validate_evaluation_signature(cls, value: str) -> str:
        return _require_non_empty(value, field_name="evaluationSignature")

    @field_validator("resumeUpdatedAt")
    @classmethod
    def _validate_post_evaluation_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("resumeUpdatedAt must include a timezone")
        return value

    @model_validator(mode="after")
    def _validate_summary_arithmetic(self):
        if self.scoreDelta != self.afterScore - self.beforeScore:
            raise ValueError("scoreDelta does not match before/after scores")
        seen: set[str] = set()
        for item in self.dimensionDeltas:
            if item.dimension in seen:
                raise ValueError("dimensionDeltas must have unique dimensions")
            seen.add(item.dimension)
            if item.delta != item.afterScore - item.beforeScore:
                raise ValueError("dimension delta does not match before/after scores")
        if tuple(item.dimension for item in self.dimensionDeltas) != (
            RESUME_EVALUATION_DIMENSION_NAMES
        ):
            raise ValueError("dimensionDeltas must use the fixed dimension order")
        if self.issueCounts.remaining != self.issueCounts.after:
            raise ValueError("remaining issue count must match after issue count")
        if self.issueCounts.resolved > self.issueCounts.before:
            raise ValueError("resolved issue count exceeds before issue count")
        if self.issueCounts.introduced > self.issueCounts.after:
            raise ValueError("introduced issue count exceeds after issue count")
        if self.issueCounts.after != (
            self.issueCounts.before
            - self.issueCounts.resolved
            + self.issueCounts.introduced
        ):
            raise ValueError("issue count arithmetic is inconsistent")
        return self


GuidanceBand = Literal[
    "strong",
    "adequate",
    "needs_attention",
    "insufficient_evidence",
]


class ResumeOptimizationGuidanceDimensionStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: str
    beforeStatus: GuidanceBand
    afterStatus: GuidanceBand


class ResumeOptimizationGuidanceIssueSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolved: int = Field(ge=0)
    remaining: int = Field(ge=0)


class ResumeOptimizationGuidancePostEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal["guidance_optimization_post_v1"]
    evaluationSignature: str
    resumeUpdatedAt: datetime
    overallBandBefore: GuidanceBand
    overallBandAfter: GuidanceBand
    dimensionStatusChanges: list[ResumeOptimizationGuidanceDimensionStatus] = Field(
        min_length=6,
        max_length=6,
    )
    issueSummary: ResumeOptimizationGuidanceIssueSummary
    unresolvedFactGapCount: int = Field(ge=0)
    acceptedChangeCount: int = Field(ge=0)
    blockedChangeCount: int = Field(ge=0)
    bankSuggestionCount: int = Field(ge=0)
    safetySummary: OptimizationSafetySummary

    @field_validator("evaluationSignature")
    @classmethod
    def _validate_guidance_evaluation_signature(cls, value: str) -> str:
        return _require_non_empty(value, field_name="evaluationSignature")

    @field_validator("resumeUpdatedAt")
    @classmethod
    def _validate_guidance_post_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("resumeUpdatedAt must include a timezone")
        return value

    @model_validator(mode="after")
    def _validate_guidance_dimension_order(self):
        if tuple(item.dimension for item in self.dimensionStatusChanges) != (
            RESUME_EVALUATION_DIMENSION_NAMES
        ):
            raise ValueError(
                "dimensionStatusChanges must use the fixed dimension order"
            )
        return self


class ResumeOptimizationRunRead(BaseModel):
    id: str
    resume_id: str
    status: ResumeOptimizationStatus
    optimizer_version: Literal[OPTIMIZER_VERSION] = OPTIMIZER_VERSION
    policy_version: Literal["thin_safety_v1", "evidence_semantic_v2", POLICY_VERSION] = POLICY_VERSION
    prompt_version: Literal["resume_optimization_prompt_v1", "resume_optimization_tasks_v2", PROMPT_VERSION] = PROMPT_VERSION
    source_resume_updated_at: datetime
    source_evaluation_signature: str
    source_jd_signature: str = ""
    source_snapshot_hash: str
    source_before_score: int | None = Field(default=None, ge=0, le=100)
    plan: OptimizationPlan = Field(default_factory=OptimizationPlan)
    answers: list[OptimizationAnswer] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    post_evaluation: (
        ResumeOptimizationPostEvaluation
        | ResumeOptimizationGuidancePostEvaluation
        | None
    ) = None
    accepted_change_ids: list[str] = Field(default_factory=list)
    applied_content_signature: str | None = None
    created_at: datetime
    updated_at: datetime
    applied_resume_updated_at: datetime | None = None
    applied_at: datetime | None = None
    completed_at: datetime | None = None


class ResumeOptimizationStartRequest(BaseModel):
    resume_id: str
    evaluation_signature: str
    expected_resume_updated_at: datetime
    include_bank_suggestions: bool = True
    selected_suggestion_ids: list[str] = Field(default_factory=list)

    @field_validator("resume_id", "evaluation_signature")
    @classmethod
    def _validate_start_identifiers(cls, value: str, info) -> str:
        return _require_non_empty(value, field_name=info.field_name)


class ResumeOptimizationAnswersRequest(BaseModel):
    answers: list[OptimizationAnswer] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _validate_unique_question_ids(self):
        question_ids = [answer.question_id for answer in self.answers]
        if len(set(question_ids)) != len(question_ids):
            raise ValueError("answers must not contain duplicate question_id values")
        return self


class ResumeOptimizationApplyRequest(BaseModel):
    accepted_change_ids: list[str] = Field(default_factory=list)
    expected_resume_updated_at: datetime

    @field_validator("accepted_change_ids")
    @classmethod
    def _validate_accepted_change_ids(cls, value: list[str]) -> list[str]:
        return _validate_non_empty_unique_ids(
            value,
            field_name="accepted_change_ids",
        )


class _ResumeOptimizationTimestampRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_resume_updated_at: datetime

    @field_validator("expected_resume_updated_at")
    @classmethod
    def _validate_aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expected_resume_updated_at must include a timezone")
        return value


class ResumeOptimizationFinalizeRequest(_ResumeOptimizationTimestampRequest):
    claim_id: str

    @field_validator("claim_id")
    @classmethod
    def _validate_claim_id(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("claim_id must be a UUID") from exc


class ResumeOptimizationRescoreClaimRequest(_ResumeOptimizationTimestampRequest):
    claim_id: str

    @field_validator("claim_id")
    @classmethod
    def _validate_claim_id(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("claim_id must be a UUID") from exc


class ResumeOptimizationRevertRequest(_ResumeOptimizationTimestampRequest):
    claim_id: str | None = None

    @field_validator("claim_id")
    @classmethod
    def _validate_optional_claim_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return str(uuid.UUID(value))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("claim_id must be a UUID") from exc


class ResumeOptimizationFinalizeResponse(BaseModel):
    run: ResumeOptimizationRunRead


class ResumeOptimizationApplyResponse(BaseModel):
    run: ResumeOptimizationRunRead
    resume_updated_at: datetime
    applied_change_ids: list[str] = Field(default_factory=list)

    @field_validator("resume_updated_at")
    @classmethod
    def _normalize_public_resume_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class ResumeOptimizationRevertResponse(BaseModel):
    run: ResumeOptimizationRunRead
    resume_updated_at: datetime

    @field_validator("resume_updated_at")
    @classmethod
    def _normalize_public_resume_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
