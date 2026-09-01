from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


OPTIMIZER_VERSION = "resume_optimization_v1"
POLICY_VERSION = "thin_safety_v1"
PROMPT_VERSION = "resume_optimization_prompt_v1"


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
    expected_score_gain: int = Field(default=0, ge=0, le=100)
    default_selected: bool = True
    safety_status: Literal["pending", "allowed", "blocked"] = "pending"
    safety_findings: list[str] = Field(default_factory=list)

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
        if text_changing and not self.source_refs:
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
    questions: list[OptimizationQuestion] = Field(default_factory=list, max_length=5)
    bank_suggestions: list[BankSuggestion] = Field(default_factory=list, max_length=3)
    safety_summary: OptimizationSafetySummary = Field(
        default_factory=OptimizationSafetySummary,
    )


class ResumeOptimizationRunRead(BaseModel):
    id: str
    resume_id: str
    status: ResumeOptimizationStatus
    optimizer_version: Literal[OPTIMIZER_VERSION] = OPTIMIZER_VERSION
    policy_version: Literal[POLICY_VERSION] = POLICY_VERSION
    prompt_version: Literal[PROMPT_VERSION] = PROMPT_VERSION
    source_resume_updated_at: datetime
    source_evaluation_signature: str
    source_jd_signature: str = ""
    source_snapshot_hash: str
    plan: OptimizationPlan = Field(default_factory=OptimizationPlan)
    answers: list[OptimizationAnswer] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    accepted_change_ids: list[str] = Field(default_factory=list)
    applied_content_signature: str | None = None
    created_at: datetime
    updated_at: datetime
    applied_at: datetime | None = None
    completed_at: datetime | None = None


class ResumeOptimizationStartRequest(BaseModel):
    resume_id: str
    evaluation_signature: str
    expected_resume_updated_at: datetime
    include_bank_suggestions: bool = True

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


class ResumeOptimizationFinalizeResponse(BaseModel):
    run: ResumeOptimizationRunRead


class ResumeOptimizationApplyResponse(BaseModel):
    run: ResumeOptimizationRunRead
    resume_updated_at: datetime
    applied_change_ids: list[str] = Field(default_factory=list)
