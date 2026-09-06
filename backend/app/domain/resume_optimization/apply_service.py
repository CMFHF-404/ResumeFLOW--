from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any
import html as html_lib
import json
import math
import re
import uuid
from urllib.parse import urljoin, urlsplit

from sqlalchemy import and_, or_
from pydantic import ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import ALLOWED_OVERRIDE_KEYS
from ...database import AsyncSessionFactory
from ...models import ExperienceCategory, ExperienceVersion, MasterExperience
from ...utils.time_utils import utc_now_aware
from ..ai.resume_evaluation import DIMENSION_NAMES, normalize_resume_evaluation
from ..resume.models import Resume, ResumeExperienceLink
from ..resume.resume_service import _mark_resume_analysis_outdated
from .models import ResumeOptimizationRun
from .normalizers import (
    _action_boundary_parts,
    _is_action_ecmascript_whitespace,
    _is_default_ignorable_action_char,
    action_markdown_rendered_marker_indices,
    markdown_link_spans,
    normalize_action_paragraph_endings,
)
from .run_service import (
    OptimizationRunNotFoundError,
    canonical_json,
    hash_canonical_json,
)
from .schemas import (
    OptimizationAction,
    OptimizationAnswer,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationSafetySummary,
    ResumeOptimizationApplyRequest,
    ResumeOptimizationFinalizeRequest,
    ResumeOptimizationPostEvaluation,
    ResumeOptimizationRescoreClaimRequest,
    ResumeOptimizationRevertRequest,
    ResumeOptimizationStatus,
)
from .safety import preserves_rich_text_structure, verify_plan_changes
from .state_machine import InvalidOptimizationTransitionError, require_status_transition


_RESULT_ROOT_KEYS = frozenset(
    {"changes", "questions", "bank_suggestions", "safety_summary"}
)
_FROZEN_SNAPSHOT_KEYS = frozenset(
    {
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
        "bank_suggestion_candidates",
        "fact_metadata",
    }
)
_EVALUATION_SIGNATURE_SCHEMA_KEY = "evaluation_signature_schema"
_FRONTEND_EVALUATION_SIGNATURE_SCHEMA_V2 = "frontend_evaluation_v2"
_STAR_PATHS = frozenset({"star.s", "star.t", "star.a", "star.r"})
_SUMMARY_MODULE_IDS = frozenset({"personal_summary", "current_resume", "resume"})
_SUMMARY_PATHS = frozenset({"personal_summary", "personalSummary"})
_SKILL_PATHS = frozenset({"skills.order", "skillsOrder", "selection.skillIds"})
_SECTION_PATHS = frozenset({"section_order", "sectionOrder"})
_APPLY_SNAPSHOT_VERSION = "resume_optimization_apply_v1"
_ROLLBACK_BEFORE_VERSION = "resume_optimization_rollback_before_v1"
_POST_EVALUATION_VERSION = "resume_optimization_post_evaluation_v1"
_STALE_PUBLIC_MESSAGE = "简历内容或六维评估已更新，请重新生成优化方案。"
_ACTIVE_RESCORE_CLAIM_KEY = "_activeRescoreClaim"
_DEFAULT_RESCORE_CLAIM_TTL_SECONDS = 900
_EXPECTED_SIGNATURE_VALUE_UNSET = object()
_LEGACY_FRONTEND_EVALUATION_SIGNATURE_KEYS = frozenset(
    {"jdInputSignature", "resume"}
)
_POST_APPLY_SIGNATURE_COMPATIBLE_STATUSES = frozenset(
    {
        ResumeOptimizationStatus.APPLIED.value,
        ResumeOptimizationStatus.RESCORING.value,
        ResumeOptimizationStatus.COMPLETED.value,
        ResumeOptimizationStatus.REVERTED.value,
    }
)
_ACTION_MATERIALIZATION_PUNCTUATION = frozenset("。！？!?；;，,、：:.…")
_ACTION_MATERIALIZATION_HTML_RE = re.compile(
    r'''<!--[\s\S]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')*>'''
)
_ACTION_MATERIALIZATION_ENTITY_RE = re.compile(
    r"&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[A-Za-z][A-Za-z0-9]+;?)"
)
_ACTION_MATERIALIZATION_MARKDOWN_ENTITY_PLACEHOLDER = "\ue002"
_ACTION_MATERIALIZATION_MARKDOWN_PROTECTED_PLACEHOLDER = "\ue003"


class OptimizationApplyValidationError(ValueError):
    code = "resume_optimization_apply_invalid"
    status_code = 400
    public_message = "优化方案或应用选择无效，请刷新后重试。"
    retryable = False

    def __init__(self, reason: str = "Resume optimization apply request is invalid"):
        self.reason = reason
        super().__init__(reason)


class OptimizationApplyConflictError(RuntimeError):
    code = "resume_optimization_apply_conflict"
    status_code = 409
    public_message = "当前优化方案状态不允许再次应用。"
    retryable = False

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationApplyStaleError(RuntimeError):
    code = "resume_optimization_context_stale"
    status_code = 409
    public_message = _STALE_PUBLIC_MESSAGE
    retryable = False

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationFinalizePendingError(RuntimeError):
    code = "resume_optimization_evaluation_pending"
    status_code = 409
    public_message = "复评结果尚未就绪或已过期，请重新生成六维评估后重试。"
    retryable = True

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationContentConflictError(RuntimeError):
    code = "resume_optimization_content_conflict"
    status_code = 409
    public_message = "简历内容已在优化后发生变化，请刷新后再操作。"
    retryable = False

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationRescoreInProgressError(RuntimeError):
    code = "resume_optimization_rescore_in_progress"
    status_code = 409
    public_message = "该优化记录正在复评，请稍后刷新。"
    retryable = True

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationRescoreClaimLostError(RuntimeError):
    code = "resume_optimization_rescore_claim_lost"
    status_code = 409
    public_message = "本次复评租约已失效，请刷新后重试。"
    retryable = True

    def __init__(self) -> None:
        super().__init__(self.public_message)


class OptimizationRunDataInvalidError(RuntimeError):
    code = "resume_optimization_run_invalid"
    status_code = 500
    public_message = "简历优化记录数据异常，请重新生成优化方案。"
    retryable = False

    def __init__(self, reason: str = "Persisted optimization apply data is invalid") -> None:
        self.reason = reason
        super().__init__(reason)


def _is_action_materialization_suffix(char: str) -> bool:
    return (
        _is_action_ecmascript_whitespace(char)
        or _is_default_ignorable_action_char(char)
        or char in "”’\"'」』"
    )


def _action_materialization_text_sources(value: str) -> tuple[str, str]:
    """Decode visible text while keeping entity-origin Markdown markers inert."""

    rendered: list[str] = []
    markdown_source: list[str] = []
    cursor = 0
    for match in _ACTION_MATERIALIZATION_ENTITY_RE.finditer(value):
        literal = html_lib.unescape(value[cursor:match.start()])
        entity = html_lib.unescape(match.group())
        rendered.append(literal)
        markdown_source.append(literal)
        rendered.append(entity)
        markdown_source.append("".join(
            _ACTION_MATERIALIZATION_MARKDOWN_ENTITY_PLACEHOLDER
            if char in "*＊_"
            else char
            for char in entity
        ))
        cursor = match.end()
    literal = html_lib.unescape(value[cursor:])
    rendered.append(literal)
    markdown_source.append(literal)
    return "".join(rendered), "".join(markdown_source)


def _action_segment_materialization_key(
    parts: list[tuple[str, bool]],
) -> str:
    value_parts: list[str] = []
    markdown_text_segments: list[tuple[int, int, str]] = []
    protected: list[bool] = []
    for value, is_markup in parts:
        if is_markup:
            normalized = value
            markdown_source = ""
        else:
            normalized, markdown_source = _action_materialization_text_sources(value)
            segment_start = len(protected)
            markdown_text_segments.append((
                segment_start,
                segment_start + len(normalized),
                markdown_source,
            ))
        value_parts.append(normalized)
        protected.extend([is_markup] * len(normalized))
    value = "".join(value_parts)

    masked = "".join(
        " " if protected[index] else char for index, char in enumerate(value)
    )
    for start, end, label, _target in markdown_link_spans(masked):
        label_end = start + 1 + len(label)
        for index in range(start, end):
            if not (start + 1 <= index < label_end):
                protected[index] = True

    for start, end, markdown_source in markdown_text_segments:
        if len(markdown_source) != end - start:
            continue
        candidate = "".join(
            _ACTION_MATERIALIZATION_MARKDOWN_PROTECTED_PLACEHOLDER
            if protected[start + index]
            else char
            for index, char in enumerate(markdown_source)
        )
        marker_indices = action_markdown_rendered_marker_indices(candidate)
        if marker_indices is None:
            continue
        for index in marker_indices:
            if not protected[start + index]:
                protected[start + index] = True

    substantive = [
        index
        for index, char in enumerate(value)
        if not protected[index]
        and char not in _ACTION_MATERIALIZATION_PUNCTUATION
        and not _is_action_materialization_suffix(char)
    ]
    last_substantive = substantive[-1] if substantive else -1
    return "".join(
        char
        for index, char in enumerate(value)
        if not (
            index > last_substantive
            and not protected[index]
            and char in _ACTION_MATERIALIZATION_PUNCTUATION
        )
    )


def _action_materialization_key(value: str) -> str:
    """Ignore terminal Action punctuation without replaying a materializer."""

    output: list[str] = []
    for part, is_boundary in _action_boundary_parts(value):
        if is_boundary:
            output.append(part)
            continue
        segment: list[tuple[str, bool]] = []
        cursor = 0
        for match in _ACTION_MATERIALIZATION_HTML_RE.finditer(part):
            segment.append((part[cursor:match.start()], False))
            segment.append((match.group(), True))
            cursor = match.end()
        segment.append((part[cursor:], False))
        output.append(_action_segment_materialization_key(segment))
    return "".join(output)


@dataclass(frozen=True)
class OptimizationApplyPatch:
    experience_star_by_link_id: dict[str, dict[str, Any]]
    next_resume_config: dict[str, Any]
    applied_change_ids: list[str]


@dataclass(frozen=True)
class OptimizationApplyResult:
    run: ResumeOptimizationRun
    resume: Resume
    resume_updated_at: datetime
    applied_change_ids: list[str]


@dataclass(frozen=True)
class OptimizationRevertResult:
    run: ResumeOptimizationRun
    resume: Resume
    resume_updated_at: datetime


@dataclass(frozen=True)
class AppliedRunResumabilityCheck:
    """The run locked during an applied-content resumability recheck."""

    run: ResumeOptimizationRun
    is_resumable: bool

    def __bool__(self) -> bool:
        return self.is_resumable


@dataclass(frozen=True)
class _FrozenLink:
    master_id: uuid.UUID
    link_id: uuid.UUID
    source_version_id: uuid.UUID


def _as_uuid(value: Any, *, field_name: str) -> uuid.UUID:
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (AttributeError, TypeError, ValueError) as exc:
        raise OptimizationApplyValidationError(
            f"{field_name} must be a valid UUID"
        ) from exc


def _strict_final_plan(run: ResumeOptimizationRun) -> OptimizationPlan:
    raw = run.result_json
    if not isinstance(raw, Mapping) or not raw or set(raw) != _RESULT_ROOT_KEYS:
        raise OptimizationApplyValidationError(
            "Persisted final optimization result has an invalid root shape"
        )
    try:
        plan = OptimizationPlan.model_validate(raw)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationApplyValidationError(
            "Persisted final optimization result is invalid"
        ) from exc

    change_ids = [change.change_id for change in plan.changes]
    question_ids = [question.question_id for question in plan.questions]
    if len(change_ids) != len(set(change_ids)):
        raise OptimizationApplyValidationError(
            "Persisted final optimization result has duplicate change IDs"
        )
    if len(question_ids) != len(set(question_ids)):
        raise OptimizationApplyValidationError(
            "Persisted final optimization result has duplicate question IDs"
        )
    return plan


def _accepted_changes(
    run: ResumeOptimizationRun,
    accepted_change_ids: set[str],
    *,
    enforce_current_safety: bool,
) -> list[OptimizationChange]:
    if not isinstance(accepted_change_ids, (set, frozenset)):
        raise OptimizationApplyValidationError("accepted_change_ids must be a set")
    if not accepted_change_ids:
        raise OptimizationApplyValidationError("At least one change must be accepted")
    if any(not isinstance(change_id, str) or not change_id.strip() for change_id in accepted_change_ids):
        raise OptimizationApplyValidationError(
            "accepted_change_ids must contain non-empty string IDs"
        )

    plan = _strict_final_plan(run)
    verified_by_id: dict[str, OptimizationChange] | None = None
    if enforce_current_safety:
        projected = project_plan_with_current_safety(run, plan=plan)
        verified_by_id = {
            change.change_id: change for change in projected.changes
        }
    by_id = {change.change_id: change for change in plan.changes}
    if accepted_change_ids - set(by_id):
        raise OptimizationApplyValidationError("An accepted change ID is unknown")

    selected: list[OptimizationChange] = []
    for change in plan.changes:
        if change.change_id not in accepted_change_ids:
            continue
        if change.safety_status != "allowed":
            raise OptimizationApplyValidationError(
                "Only persisted safety-allowed changes may be applied"
            )
        if (
            verified_by_id is not None
            and verified_by_id[change.change_id].safety_status != "allowed"
        ):
            raise OptimizationApplyValidationError(
                "Only changes allowed by the current safety policy may be applied"
            )
        if change.action_kind not in {
            OptimizationAction.REWRITE_NOW,
            OptimizationAction.ASK_USER,
        }:
            raise OptimizationApplyValidationError(
                "Only applicable rewrite or answered changes may be accepted"
            )
        if change.targeted_value is None:
            raise OptimizationApplyValidationError(
                "Applicable changes require a targeted value"
            )
        if enforce_current_safety and change.module_type in {
            OptimizationModuleType.EXPERIENCE_STAR,
            OptimizationModuleType.PERSONAL_SUMMARY,
        } and (
            not isinstance(change.before_value, str)
            or not isinstance(change.targeted_value, str)
            or (
                not (
                    change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
                    and change.targeted_value == ""
                )
                and not preserves_rich_text_structure(
                    change.before_value,
                    change.targeted_value,
                )
            )
        ):
            raise OptimizationApplyValidationError(
                "Text changes must preserve rich-text links and emphasis"
            )
        selected.append(change)
    return selected


def _current_safety_source_documents(
    run: ResumeOptimizationRun,
    *,
    plan: OptimizationPlan,
) -> dict[str, Any]:
    snapshot = _validated_snapshot(run)
    current_resume = snapshot.get("current_resume")
    selected_sources = snapshot.get("selected_source_experiences")
    if not isinstance(current_resume, Mapping) or not isinstance(
        selected_sources, Mapping
    ):
        raise OptimizationApplyValidationError(
            "Frozen safety source documents are invalid"
        )

    raw_answers = run.answers_json
    if not isinstance(raw_answers, Mapping):
        raise OptimizationApplyValidationError(
            "Persisted optimization answers have an invalid root shape"
        )
    if not raw_answers:
        answer_items: Any = []
    elif set(raw_answers) == {"answers"}:
        answer_items = raw_answers.get("answers")
    else:
        raise OptimizationApplyValidationError(
            "Persisted optimization answers have an invalid root shape"
        )
    if not isinstance(answer_items, list):
        raise OptimizationApplyValidationError(
            "Persisted optimization answers must be an array"
        )

    answers: list[OptimizationAnswer] = []
    for raw_answer in answer_items:
        if not isinstance(raw_answer, Mapping) or set(raw_answer) != {
            "question_id",
            "state",
            "value",
        }:
            raise OptimizationApplyValidationError(
                "Persisted optimization answer has an invalid shape"
            )
        try:
            answers.append(OptimizationAnswer.model_validate(raw_answer))
        except (TypeError, ValidationError, ValueError) as exc:
            raise OptimizationApplyValidationError(
                "Persisted optimization answer is invalid"
            ) from exc

    answer_ids = [answer.question_id for answer in answers]
    question_ids = {question.question_id for question in plan.questions}
    if len(answer_ids) != len(set(answer_ids)) or not set(answer_ids) <= question_ids:
        raise OptimizationApplyValidationError(
            "Persisted optimization answers do not match the final plan"
        )

    return {
        "currentResume": deepcopy(dict(current_resume)),
        "selectedSourceExperiences": deepcopy(dict(selected_sources)),
        "userAnswers": {
            answer.question_id: {
                "state": answer.state.value,
                "value": answer.value,
            }
            for answer in answers
        },
    }


def project_plan_with_current_safety(
    run: ResumeOptimizationRun,
    *,
    plan: OptimizationPlan,
) -> OptimizationPlan:
    """Return the current-policy read/apply view without mutating persisted data."""

    copied = plan.model_copy(deep=True)
    if run.status != ResumeOptimizationStatus.PREVIEW_READY.value:
        return copied
    actionable = any(
        change.action_kind in {
            OptimizationAction.REWRITE_NOW,
            OptimizationAction.ASK_USER,
        }
        and change.targeted_value is not None
        for change in copied.changes
    )
    if not actionable:
        return copied

    source_documents = _current_safety_source_documents(run, plan=copied)
    verified_changes, _ = verify_plan_changes(
        plan=copied,
        source_documents=source_documents,
    )
    if [change.change_id for change in verified_changes] != [
        change.change_id for change in copied.changes
    ]:
        raise OptimizationApplyValidationError(
            "Current safety verification changed the persisted plan identity"
        )
    projected_changes = [
        verified
        if persisted.safety_status == "allowed"
        else persisted.model_copy(
            update={"default_selected": False},
            deep=True,
        )
        for persisted, verified in zip(copied.changes, verified_changes, strict=True)
    ]
    allowed_ids = [
        change.change_id
        for change in projected_changes
        if change.safety_status == "allowed"
    ]
    blocked_ids = [
        change.change_id
        for change in projected_changes
        if change.safety_status == "blocked"
    ]
    pending_ids = [
        change.change_id
        for change in projected_changes
        if change.safety_status == "pending"
    ]
    safety_summary = OptimizationSafetySummary(
        allowed_change_ids=allowed_ids,
        blocked_change_ids=blocked_ids,
        pending_change_ids=pending_ids,
        findings=[
            f"{change.change_id}：{finding}"
            for change in projected_changes
            for finding in change.safety_findings
        ],
    )
    return copied.model_copy(
        update={
            "changes": projected_changes,
            "safety_summary": safety_summary,
        },
        deep=True,
    )


def _validated_snapshot(run: ResumeOptimizationRun) -> dict[str, Any]:
    snapshot = run.before_snapshot
    if not isinstance(snapshot, Mapping) or set(snapshot) not in {
        _FROZEN_SNAPSHOT_KEYS,
        _FROZEN_SNAPSHOT_KEYS | {_EVALUATION_SIGNATURE_SCHEMA_KEY},
    }:
        raise OptimizationApplyValidationError("Frozen optimization snapshot is invalid")
    copied = deepcopy(dict(snapshot))
    if (
        _EVALUATION_SIGNATURE_SCHEMA_KEY in copied
        and copied.get(_EVALUATION_SIGNATURE_SCHEMA_KEY)
        != _FRONTEND_EVALUATION_SIGNATURE_SCHEMA_V2
    ):
        raise OptimizationApplyValidationError(
            "Frozen evaluation signature schema is invalid"
        )
    if hash_canonical_json(copied) != run.source_snapshot_hash:
        raise OptimizationApplyStaleError()
    if str(copied.get("resume_id")) != str(run.resume_id):
        raise OptimizationApplyStaleError()
    if (
        copied.get("evaluation_signature") != run.source_evaluation_signature
        or copied.get("jd_signature") != run.source_jd_signature
    ):
        raise OptimizationApplyValidationError(
            "Frozen optimization source identity is invalid"
        )
    return copied


def _frozen_links(run: ResumeOptimizationRun) -> dict[str, _FrozenLink]:
    snapshot = _validated_snapshot(run)
    raw_selected = snapshot.get("selected_master_experience_ids")
    raw_links = snapshot.get("selected_experience_links")
    raw_sources = snapshot.get("selected_source_experiences")
    current_resume = snapshot.get("current_resume")
    current_experiences = (
        current_resume.get("experiences")
        if isinstance(current_resume, Mapping)
        else None
    )
    if not isinstance(raw_selected, list) or not isinstance(raw_links, Mapping):
        raise OptimizationApplyValidationError("Frozen experience selection is invalid")
    if not isinstance(raw_sources, Mapping):
        raise OptimizationApplyValidationError("Frozen source experiences are invalid")
    if not isinstance(current_experiences, Mapping):
        raise OptimizationApplyValidationError(
            "Frozen current resume experiences are invalid"
        )

    selected_ids: list[str] = []
    for value in raw_selected:
        text = str(value).strip()
        if not text or text in selected_ids:
            raise OptimizationApplyValidationError(
                "Frozen selected experience IDs are invalid"
            )
        selected_ids.append(text)
    if (
        set(raw_links) != set(selected_ids)
        or set(raw_sources) != set(selected_ids)
        or set(current_experiences) != set(selected_ids)
    ):
        raise OptimizationApplyValidationError(
            "Frozen selected experiences do not have exact link/source mappings"
        )

    resolved: dict[str, _FrozenLink] = {}
    seen_link_ids: set[uuid.UUID] = set()
    for master_id_text in selected_ids:
        raw_record = raw_links.get(master_id_text)
        raw_source = raw_sources.get(master_id_text)
        if not isinstance(raw_record, Mapping) or not isinstance(raw_source, Mapping):
            raise OptimizationApplyValidationError(
                "Frozen selected experience mapping is invalid"
            )
        master_id = _as_uuid(master_id_text, field_name="master experience ID")
        link_id = _as_uuid(
            raw_record.get("resume_link_id"), field_name="resume experience link ID"
        )
        version_id = _as_uuid(
            raw_record.get("source_version_id"), field_name="source version ID"
        )
        if link_id in seen_link_ids:
            raise OptimizationApplyValidationError(
                "Frozen selected experience links are duplicated"
            )
        if str(raw_source.get("source_version_id")) != str(version_id):
            raise OptimizationApplyValidationError(
                "Frozen selected source version mapping is inconsistent"
            )
        seen_link_ids.add(link_id)
        resolved[master_id_text] = _FrozenLink(
            master_id=master_id,
            link_id=link_id,
            source_version_id=version_id,
        )
    return resolved


def _deep_merge(base: Mapping[str, Any], overlay: Mapping[str, Any]) -> dict[str, Any]:
    merged = deepcopy(dict(base))
    for key, value in overlay.items():
        existing = merged.get(key)
        if isinstance(existing, Mapping) and isinstance(value, Mapping):
            merged[key] = _deep_merge(existing, value)
        else:
            merged[key] = deepcopy(value)
    return merged


def _string_order(value: Any, *, field_name: str) -> list[str]:
    if not isinstance(value, list):
        raise OptimizationApplyValidationError(f"{field_name} must be an array")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or item in result:
            raise OptimizationApplyValidationError(
                f"{field_name} must contain unique non-empty string IDs"
            )
        result.append(item)
    return result


def _canonical_target(
    change: OptimizationChange,
    frozen_links: Mapping[str, _FrozenLink],
) -> tuple[str, str]:
    if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
        if change.field_path not in _STAR_PATHS:
            raise OptimizationApplyValidationError("Unsupported experience path")
        record = frozen_links.get(change.module_id)
        if record is None:
            raise OptimizationApplyValidationError(
                "Selected experience has no exact frozen resume link"
            )
        return (f"link:{record.link_id}", change.field_path)
    if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        if change.module_id not in _SUMMARY_MODULE_IDS or change.field_path not in _SUMMARY_PATHS:
            raise OptimizationApplyValidationError("Unsupported personal summary path")
        return ("config", "personalSummary")
    if change.module_type == OptimizationModuleType.SKILLS_ORDER:
        if change.module_id != "skills" or change.field_path not in _SKILL_PATHS:
            raise OptimizationApplyValidationError("Unsupported skill-order path")
        return ("config", "selection.skillIds")
    if change.module_type == OptimizationModuleType.SECTION_ORDER:
        if change.module_id != "sections" or change.field_path not in _SECTION_PATHS:
            raise OptimizationApplyValidationError("Unsupported section-order path")
        return ("config", "layout.sectionOrder")
    raise OptimizationApplyValidationError("Unsupported optimization module")


def _frozen_effective_star(snapshot: Mapping[str, Any], master_id: str) -> dict[str, Any]:
    current_resume = snapshot.get("current_resume")
    experiences = (
        current_resume.get("experiences") if isinstance(current_resume, Mapping) else None
    )
    experience = experiences.get(master_id) if isinstance(experiences, Mapping) else None
    star = experience.get("star") if isinstance(experience, Mapping) else None
    if not isinstance(star, Mapping):
        raise OptimizationApplyValidationError(
            "Frozen current experience STAR is unavailable"
        )
    for key in ("s", "t", "a", "r"):
        if key not in star:
            raise OptimizationApplyValidationError(
                "Frozen current experience STAR is incomplete"
            )
    return deepcopy(dict(star))


def build_apply_patch(
    *,
    run: ResumeOptimizationRun,
    accepted_change_ids: set[str],
    current_resume_config: dict[str, Any],
    current_link_overrides: dict[str, dict[str, Any]],
    enforce_current_safety: bool = True,
) -> OptimizationApplyPatch:
    if not isinstance(current_resume_config, dict):
        raise OptimizationApplyValidationError("Current resume config is invalid")
    if not isinstance(current_link_overrides, dict):
        raise OptimizationApplyValidationError("Current link overrides are invalid")

    snapshot = _validated_snapshot(run)
    frozen_links = _frozen_links(run)
    changes = _accepted_changes(
        run,
        accepted_change_ids,
        enforce_current_safety=enforce_current_safety,
    )
    next_config = deepcopy(current_resume_config)
    next_stars: dict[str, dict[str, Any]] = {}
    targets: set[tuple[str, str]] = set()
    has_effective_change = False

    for change in changes:
        target = _canonical_target(change, frozen_links)
        if target in targets:
            raise OptimizationApplyValidationError(
                "Accepted changes conflict on the same persisted field"
            )
        targets.add(target)
        value = deepcopy(change.targeted_value)

        if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
            if not isinstance(value, str):
                raise OptimizationApplyValidationError(
                    "Experience STAR changes must contain text"
                )
            record = frozen_links[change.module_id]
            link_id = str(record.link_id)
            if link_id not in current_link_overrides:
                raise OptimizationApplyValidationError(
                    "Selected experience no longer has its frozen resume link"
                )
            raw_overrides = current_link_overrides[link_id]
            if not isinstance(raw_overrides, Mapping):
                raise OptimizationApplyValidationError(
                    "Current resume link overrides are invalid"
                )
            raw_override_star = raw_overrides.get("star", {})
            if not isinstance(raw_override_star, Mapping):
                raise OptimizationApplyValidationError(
                    "Current resume STAR override is invalid"
                )
            effective_star = _frozen_effective_star(snapshot, change.module_id)
            if change.before_value != effective_star[change.field_path[-1]]:
                raise OptimizationApplyValidationError(
                    "Experience change before value no longer matches the frozen snapshot"
                )
            if change.field_path == "star.a" and enforce_current_safety:
                value = normalize_action_paragraph_endings(value)
                if enforce_current_safety and not preserves_rich_text_structure(
                    change.before_value,
                    value,
                ):
                    raise OptimizationApplyValidationError(
                        "Normalized action text must preserve rich-text links and emphasis"
                    )
            if value != effective_star[change.field_path[-1]]:
                has_effective_change = True
            star = next_stars.get(link_id)
            if star is None:
                star = _deep_merge(effective_star, raw_override_star)
            star[change.field_path[-1]] = value
            next_stars[link_id] = star
            continue

        if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
            if not isinstance(value, str):
                raise OptimizationApplyValidationError(
                    "Personal summary changes must contain text"
                )
            current_resume = snapshot.get("current_resume")
            frozen_summary = (
                current_resume.get("personal_summary")
                if isinstance(current_resume, Mapping)
                else None
            )
            if change.before_value != frozen_summary:
                raise OptimizationApplyValidationError(
                    "Summary before value no longer matches the frozen snapshot"
                )
            if value != frozen_summary:
                has_effective_change = True
            next_config["personalSummary"] = value
            continue

        if change.module_type == OptimizationModuleType.SKILLS_ORDER:
            selection = current_resume_config.get("selection")
            current_resume = snapshot.get("current_resume")
            frozen_skills = (
                current_resume.get("skills")
                if isinstance(current_resume, Mapping)
                else None
            )
            if not isinstance(frozen_skills, list):
                raise OptimizationApplyValidationError(
                    "Frozen selected skills are invalid"
                )
            frozen_order = [
                str(item.get("id"))
                for item in frozen_skills
                if isinstance(item, Mapping) and str(item.get("id") or "")
            ]
            if isinstance(selection, Mapping):
                raw_skill_ids = selection.get("skillIds")
                current_order = (
                    list(frozen_order)
                    if raw_skill_ids is None
                    else _string_order(
                        raw_skill_ids,
                        field_name="selection.skillIds",
                    )
                )
                next_selection = deepcopy(dict(selection))
            elif selection is None:
                current_order = list(frozen_order)
                next_selection = {}
            else:
                raise OptimizationApplyValidationError(
                    "Resume skill selection is invalid"
                )
            next_order = _string_order(value, field_name="targeted skill order")
            if change.before_value != frozen_order:
                raise OptimizationApplyValidationError(
                    "Skill-order before value no longer matches the frozen snapshot"
                )
            if (
                len(current_order) != len(frozen_order)
                or set(current_order) != set(frozen_order)
            ):
                raise OptimizationApplyValidationError(
                    "Current config skill IDs no longer match the frozen selection"
                )
            if len(next_order) != len(frozen_order) or set(next_order) != set(frozen_order):
                raise OptimizationApplyValidationError(
                    "Skill order must contain exactly the selected skill IDs"
                )
            if next_order != current_order:
                has_effective_change = True
            next_selection["skillIds"] = next_order
            next_config["selection"] = next_selection
            continue

        if change.module_type == OptimizationModuleType.SECTION_ORDER:
            layout = current_resume_config.get("layout")
            if not isinstance(layout, Mapping):
                raise OptimizationApplyValidationError("Resume layout is invalid")
            current_order = _string_order(
                layout.get("sectionOrder"), field_name="layout.sectionOrder"
            )
            current_resume = snapshot.get("current_resume")
            frozen_order = (
                current_resume.get("section_order")
                if isinstance(current_resume, Mapping)
                else None
            )
            next_order = _string_order(value, field_name="targeted section order")
            if change.before_value != current_order or change.before_value != frozen_order:
                raise OptimizationApplyValidationError(
                    "Section-order before value no longer matches current config"
                )
            if len(next_order) != len(current_order) or set(next_order) != set(current_order):
                raise OptimizationApplyValidationError(
                    "Section order must contain exactly the existing section IDs"
                )
            if next_order != current_order:
                has_effective_change = True
            next_layout = deepcopy(dict(layout))
            next_layout["sectionOrder"] = next_order
            next_config["layout"] = next_layout
            continue

        raise OptimizationApplyValidationError("Unsupported optimization change")

    if enforce_current_safety and not has_effective_change:
        raise OptimizationApplyValidationError(
            "Accepted changes do not modify the frozen resume content"
        )

    skills_changed = any(
        change.module_type == OptimizationModuleType.SKILLS_ORDER
        for change in changes
    )
    before_has_selection = "selection" in current_resume_config
    after_has_selection = "selection" in next_config
    before_selection = current_resume_config.get("selection")
    after_selection = next_config.get("selection")
    if not skills_changed:
        if (
            before_has_selection != after_has_selection
            or deepcopy(before_selection) != deepcopy(after_selection)
        ):
            raise OptimizationApplyValidationError(
                "Apply cannot change resume selection"
            )
    else:
        if not isinstance(after_selection, Mapping):
            raise OptimizationApplyValidationError(
                "Skill ordering requires a persisted selection object"
            )
        if isinstance(before_selection, Mapping):
            if set(after_selection) != set(before_selection) | {"skillIds"}:
                raise OptimizationApplyValidationError(
                    "Apply cannot add or remove selection fields"
                )
            for key in set(before_selection) - {"skillIds"}:
                if deepcopy(before_selection.get(key)) != deepcopy(
                    after_selection.get(key)
                ):
                    raise OptimizationApplyValidationError(
                        "Apply cannot change selected resume item IDs"
                    )
        elif before_selection is None:
            if set(after_selection) != {"skillIds"}:
                raise OptimizationApplyValidationError(
                    "Implicit skill selection may materialize only skillIds"
                )
        else:
            raise OptimizationApplyValidationError(
                "Skill ordering requires a valid selection object"
            )

    return OptimizationApplyPatch(
        experience_star_by_link_id=next_stars,
        next_resume_config=next_config,
        applied_change_ids=[change.change_id for change in changes],
    )


def _normalize_current_timestamp(value: datetime) -> datetime:
    if not isinstance(value, datetime):
        raise OptimizationApplyStaleError()
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_aware_timestamp(value: datetime, *, field_name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise OptimizationApplyValidationError(f"{field_name} must include a timezone")
    return value.astimezone(timezone.utc)


def _snapshot_timestamp(snapshot: Mapping[str, Any]) -> datetime:
    raw = snapshot.get("resume_updated_at")
    if not isinstance(raw, str):
        raise OptimizationApplyStaleError()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise OptimizationApplyStaleError() from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise OptimizationApplyStaleError()
    return parsed.astimezone(timezone.utc)


def _validate_current_report(
    run: ResumeOptimizationRun,
    resume: Resume,
    snapshot: Mapping[str, Any],
) -> None:
    if not source_snapshot_uses_v2_signature_contract(snapshot):
        raise OptimizationApplyStaleError()
    config = resume.config
    analysis = config.get("jdAnalysis") if isinstance(config, Mapping) else None
    result = analysis.get("result") if isinstance(analysis, Mapping) else None
    evaluation = result.get("resumeEvaluation") if isinstance(result, Mapping) else None
    if (
        not isinstance(analysis, Mapping)
        or analysis.get("evaluationIsOutdated") is True
        or not isinstance(evaluation, Mapping)
        or analysis.get("evaluationSignature") != run.source_evaluation_signature
        or analysis.get("jdInputSignature") != run.source_jd_signature
        or snapshot.get("evaluation_signature") != run.source_evaluation_signature
        or snapshot.get("jd_signature") != run.source_jd_signature
    ):
        raise OptimizationApplyStaleError()
    try:
        _parse_frontend_evaluation_signature(
            run.source_evaluation_signature,
            jd_input_signature=run.source_jd_signature,
            field_name="source evaluation signature",
            expected_evaluation=evaluation,
            expected_jd_result=result,
        )
    except OptimizationRunDataInvalidError as exc:
        raise OptimizationApplyValidationError(
            "Optimization requires the current editor evaluation signature"
        ) from exc


def source_snapshot_uses_v2_signature_contract(snapshot: Any) -> bool:
    """Return whether a frozen source was server-marked for current apply."""

    return (
        isinstance(snapshot, Mapping)
        and snapshot.get(_EVALUATION_SIGNATURE_SCHEMA_KEY)
        == _FRONTEND_EVALUATION_SIGNATURE_SCHEMA_V2
    )


async def _lock_run(
    session: AsyncSession,
    *,
    user_id: str,
    run_id: str,
) -> ResumeOptimizationRun:
    parsed_run_id = _as_uuid(run_id, field_name="run_id")
    statement = (
        select(ResumeOptimizationRun)
        .where(
            ResumeOptimizationRun.id == parsed_run_id,
            ResumeOptimizationRun.user_id == user_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    result = await session.execute(statement)
    run = result.scalars().first()
    if run is None:
        raise OptimizationRunNotFoundError(run_id)
    return run


async def _lock_resume(
    session: AsyncSession,
    *,
    user_id: str,
    run: ResumeOptimizationRun,
) -> Resume:
    statement = (
        select(Resume)
        .where(Resume.id == run.resume_id, Resume.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    result = await session.execute(statement)
    resume = result.scalars().first()
    if resume is None:
        raise OptimizationRunNotFoundError(str(run.id))
    return resume


async def _lock_frozen_links(
    session: AsyncSession,
    *,
    user_id: str,
    resume: Resume,
    records: Mapping[str, _FrozenLink],
) -> list[ResumeExperienceLink]:
    if not records:
        return []
    predicates = [
        and_(
            ResumeExperienceLink.id == record.link_id,
            ResumeExperienceLink.experience_version_id == record.source_version_id,
            ExperienceVersion.id == record.source_version_id,
            ExperienceVersion.master_experience_id == record.master_id,
        )
        for record in records.values()
    ]
    statement = (
        select(ResumeExperienceLink)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == ResumeExperienceLink.experience_version_id,
        )
        .join(
            MasterExperience,
            MasterExperience.id == ExperienceVersion.master_experience_id,
        )
        .where(
            ResumeExperienceLink.resume_id == resume.id,
            MasterExperience.user_id == user_id,
            MasterExperience.category.in_(
                [ExperienceCategory.WORK, ExperienceCategory.PROJECT]
            ),
            or_(*predicates),
        )
        .order_by(ResumeExperienceLink.id)
        .with_for_update(of=ResumeExperienceLink)
        .execution_options(populate_existing=True)
    )
    result = await session.execute(statement)
    links = list(result.scalars().all())
    if len(links) != len(records):
        raise OptimizationApplyStaleError()
    by_id = {str(link.id): link for link in links}
    if len(by_id) != len(records):
        raise OptimizationApplyStaleError()
    for record in records.values():
        link = by_id.get(str(record.link_id))
        if (
            link is None
            or str(link.resume_id) != str(resume.id)
            or str(link.experience_version_id) != str(record.source_version_id)
        ):
            raise OptimizationApplyStaleError()
    return links


async def _lock_current_selected_resume_links(
    session: AsyncSession,
    *,
    user_id: str,
    resume: Resume,
    frozen_records: Mapping[str, _FrozenLink],
    applied_config: Any,
) -> list[ResumeExperienceLink]:
    config = _snapshot_object(applied_config, field_name="applied resume config")
    selection = config.get("selection")
    explicit_master_ids: list[str] | None = None
    if isinstance(selection, Mapping) and "experienceIds" in selection:
        raw_ids = selection.get("experienceIds")
        if not isinstance(raw_ids, list):
            raise OptimizationRunDataInvalidError(
                "applied selection.experienceIds must be an array"
            )
        explicit_master_ids = []
        for raw_id in raw_ids:
            master_id = str(raw_id)
            if not master_id or master_id in explicit_master_ids:
                raise OptimizationRunDataInvalidError(
                    "applied selection.experienceIds is invalid"
                )
            explicit_master_ids.append(master_id)
        if not set(frozen_records).issubset(explicit_master_ids):
            raise OptimizationRunDataInvalidError(
                "applied selected experience IDs disagree with frozen selection"
            )
        hidden_master_ids = [
            master_id for master_id in explicit_master_ids
            if master_id not in frozen_records
        ]
        if hidden_master_ids:
            # Context construction excludes archived experiences from the frozen
            # snapshot while retaining their IDs in the user's resume config.
            # Reconfirm that omission here; an active or unknown extra ID must
            # still fail rather than silently expand the applied selection.
            # Hold confirmed rows until commit. Skip concurrent bank mutations
            # instead of waiting in reverse (resume -> master) lock order.
            archived_result = await session.execute(
                select(MasterExperience.id).where(
                    MasterExperience.user_id == user_id,
                    MasterExperience.id.in_([
                        _as_uuid(item, field_name="hidden selected master experience ID")
                        for item in hidden_master_ids
                    ]),
                    MasterExperience.is_archived.is_(True),
                ).with_for_update(of=MasterExperience, skip_locked=True)
            )
            archived_ids = {str(item) for item in archived_result.scalars().all()}
            if set(hidden_master_ids) != archived_ids:
                raise OptimizationContentConflictError()
            explicit_master_ids = [
                item for item in explicit_master_ids if item in frozen_records
            ]
    statement = (
        select(ResumeExperienceLink)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == ResumeExperienceLink.experience_version_id,
        )
        .join(
            MasterExperience,
            MasterExperience.id == ExperienceVersion.master_experience_id,
        )
        .where(
            ResumeExperienceLink.resume_id == resume.id,
            MasterExperience.user_id == user_id,
            MasterExperience.category.in_(
                [ExperienceCategory.WORK, ExperienceCategory.PROJECT]
            ),
        )
        .order_by(ResumeExperienceLink.id)
        .with_for_update(of=ResumeExperienceLink)
        .execution_options(populate_existing=True)
    )
    if explicit_master_ids is not None:
        statement = statement.where(
            MasterExperience.id.in_(
                [
                    _as_uuid(item, field_name="selected master experience ID")
                    for item in explicit_master_ids
                ]
            )
        )
    result = await session.execute(statement)
    links = list(result.scalars().all())
    expected = {
        str(record.link_id): str(record.source_version_id)
        for record in frozen_records.values()
    }
    if explicit_master_ids is None:
        hidden_link_ids = {
            str(link.id) for link in links if str(link.id) not in expected
        }
        if hidden_link_ids:
            # Implicit selection includes every linked experience, but the
            # frozen frontend snapshot omits archived bank entries. Exclude
            # only those omissions we can still confirm and lock as archived.
            archived_result = await session.execute(
                select(ResumeExperienceLink.id)
                .join(
                    ExperienceVersion,
                    ExperienceVersion.id == ResumeExperienceLink.experience_version_id,
                )
                .join(
                    MasterExperience,
                    MasterExperience.id == ExperienceVersion.master_experience_id,
                )
                .where(
                    ResumeExperienceLink.resume_id == resume.id,
                    MasterExperience.user_id == user_id,
                    ResumeExperienceLink.id.in_([
                        _as_uuid(item, field_name="hidden resume experience link ID")
                        for item in sorted(hidden_link_ids)
                    ]),
                    MasterExperience.is_archived.is_(True),
                )
                .with_for_update(of=MasterExperience, skip_locked=True)
            )
            archived_link_ids = {str(item) for item in archived_result.scalars().all()}
            if hidden_link_ids != archived_link_ids:
                raise OptimizationContentConflictError()
            links = [link for link in links if str(link.id) not in archived_link_ids]
    current = {
        str(link.id): str(link.experience_version_id)
        for link in links
        if str(link.resume_id) == str(resume.id)
    }
    if len(current) != len(links) or current != expected:
        raise OptimizationContentConflictError()
    return links


def build_applied_content_projection(
    *,
    resume: Resume,
    selected_links: list[ResumeExperienceLink],
) -> dict[str, Any]:
    config = deepcopy(resume.config) if isinstance(resume.config, dict) else {}
    config.pop("jdAnalysis", None)
    return {
        "title": resume.title,
        "target_role": resume.target_role,
        "resume_config": config,
        "selected_links": {
            str(link.id): {
                "source_version_id": str(link.experience_version_id),
                "display_order": int(link.display_order),
                "overrides_json": deepcopy(link.overrides_json),
            }
            for link in sorted(selected_links, key=lambda item: str(item.id))
        },
    }


def _value_presence(mapping: Mapping[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    cursor: Any = mapping
    for token in path[:-1]:
        if not isinstance(cursor, Mapping) or token not in cursor:
            return {"present": False, "value": None}
        cursor = cursor[token]
    if not isinstance(cursor, Mapping) or path[-1] not in cursor:
        return {"present": False, "value": None}
    return {"present": True, "value": deepcopy(cursor[path[-1]])}


def _touched_config_paths(changes: list[OptimizationChange]) -> dict[str, tuple[str, ...]]:
    result: dict[str, tuple[str, ...]] = {}
    for change in changes:
        if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
            result["personalSummary"] = ("personalSummary",)
        elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
            result["selection"] = ("selection",)
            result["selection.skillIds"] = ("selection", "skillIds")
        elif change.module_type == OptimizationModuleType.SECTION_ORDER:
            result["layout.sectionOrder"] = ("layout", "sectionOrder")
    return result


def _timestamp_like(reference: datetime, now: datetime) -> datetime:
    return now.replace(tzinfo=None) if reference.tzinfo is None else now


def _rollback_before_signature(
    *,
    run_id: Any,
    resume_id: Any,
    source_snapshot_hash: str,
    applied_change_ids: list[str],
    before: Any,
) -> str:
    return hash_canonical_json(
        {
            "version": _ROLLBACK_BEFORE_VERSION,
            "run_id": str(run_id),
            "resume_id": str(resume_id),
            "source_snapshot_hash": source_snapshot_hash,
            "applied_change_ids": list(applied_change_ids),
            "before": deepcopy(before),
        }
    )


async def _write_stale(
    session: AsyncSession,
    run: ResumeOptimizationRun,
) -> None:
    current = ResumeOptimizationStatus(run.status)
    require_status_transition(current, ResumeOptimizationStatus.STALE)
    now = utc_now_aware()
    run.status = ResumeOptimizationStatus.STALE.value
    run.error_json = {
        "code": OptimizationApplyStaleError.code,
        "message": OptimizationApplyStaleError.public_message,
        "statusCode": OptimizationApplyStaleError.status_code,
        "retryable": False,
    }
    run.updated_at = _timestamp_like(run.updated_at, now)
    session.add(run)
    await session.flush()
    await session.commit()


async def _persist_stale_after_rollback(
    session: AsyncSession,
    *,
    user_id: str,
    run_id: str,
    stale_session_factory: Any,
) -> None:
    await session.rollback()
    async with stale_session_factory() as stale_session:
        stale_run = await _lock_run(
            stale_session,
            user_id=user_id,
            run_id=run_id,
        )
        if stale_run.status != ResumeOptimizationStatus.PREVIEW_READY.value:
            await stale_session.rollback()
            raise OptimizationApplyConflictError()
        await _write_stale(stale_session, stale_run)


async def apply_resume_optimization(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationApplyRequest,
    stale_session_factory: Any | None = None,
) -> OptimizationApplyResult:
    expected = _require_aware_timestamp(
        payload.expected_resume_updated_at,
        field_name="expected_resume_updated_at",
    )
    resolved_stale_session_factory = (
        stale_session_factory
        or getattr(session, "stale_session_factory", None)
        or AsyncSessionFactory
    )

    async def persist_stale() -> None:
        await _persist_stale_after_rollback(
            session,
            user_id=user_id,
            run_id=run_id,
            stale_session_factory=resolved_stale_session_factory,
        )

    try:
        run = await _lock_run(session, user_id=user_id, run_id=run_id)
        resume = await _lock_resume(session, user_id=user_id, run=run)

        try:
            current_status = ResumeOptimizationStatus(run.status)
        except ValueError as exc:
            raise OptimizationApplyConflictError() from exc
        if current_status != ResumeOptimizationStatus.PREVIEW_READY:
            raise OptimizationApplyConflictError()

        try:
            snapshot = _validated_snapshot(run)
        except OptimizationApplyStaleError:
            await persist_stale()
            raise
        try:
            source_timestamp = _require_aware_timestamp(
                run.source_resume_updated_at,
                field_name="run.source_resume_updated_at",
            )
        except OptimizationApplyValidationError as exc:
            await persist_stale()
            raise OptimizationApplyStaleError() from exc
        try:
            frozen_timestamp = _snapshot_timestamp(snapshot)
            current_timestamp = _normalize_current_timestamp(resume.updated_at)
        except OptimizationApplyStaleError:
            await persist_stale()
            raise
        if not (
            expected == current_timestamp == source_timestamp == frozen_timestamp
        ):
            await persist_stale()
            raise OptimizationApplyStaleError()
        try:
            _validate_current_report(run, resume, snapshot)
        except OptimizationApplyStaleError:
            await persist_stale()
            raise
        if str(run.source_evaluation_signature).lstrip().startswith("{"):
            try:
                _source_frontend_evaluation_snapshot(run)
            except OptimizationRunDataInvalidError as exc:
                raise OptimizationApplyValidationError(
                    "Optimization requires a canonical editor evaluation snapshot"
                ) from exc

        changes = _accepted_changes(
            run,
            set(payload.accepted_change_ids),
            enforce_current_safety=True,
        )
        try:
            frozen_links = _frozen_links(run)
        except OptimizationApplyStaleError:
            await persist_stale()
            raise
        try:
            links = await _lock_frozen_links(
                session,
                user_id=user_id,
                resume=resume,
                records=frozen_links,
            )
        except OptimizationApplyStaleError:
            await persist_stale()
            raise

        current_overrides = {
            str(link.id): deepcopy(link.overrides_json) for link in links
        }
        patch = build_apply_patch(
            run=run,
            accepted_change_ids=set(payload.accepted_change_ids),
            current_resume_config=deepcopy(resume.config),
            current_link_overrides=current_overrides,
        )

        try:
            require_status_transition(
                ResumeOptimizationStatus(run.status),
                ResumeOptimizationStatus.APPLYING,
            )
        except InvalidOptimizationTransitionError as exc:
            raise OptimizationApplyConflictError() from exc
        now = utc_now_aware()
        run.status = ResumeOptimizationStatus.APPLYING.value
        run.updated_at = _timestamp_like(run.updated_at, now)
        session.add(run)
        await session.flush()

        before_config = deepcopy(resume.config)
        before_overrides = deepcopy(current_overrides)
        link_by_id = {str(link.id): link for link in links}
        for link_id, star in patch.experience_star_by_link_id.items():
            link = link_by_id[link_id]
            next_overrides = deepcopy(link.overrides_json)
            if not isinstance(next_overrides, dict):
                raise OptimizationApplyValidationError(
                    "Current resume link overrides are invalid"
                )
            if "star" not in ALLOWED_OVERRIDE_KEYS:
                raise AssertionError("STAR override support is unavailable")
            next_overrides["star"] = deepcopy(star)
            link.overrides_json = next_overrides
            session.add(link)

        next_config = _mark_resume_analysis_outdated(patch.next_resume_config)
        resume.config = deepcopy(next_config)
        resume.updated_at = _timestamp_like(resume.updated_at, now)
        session.add(resume)

        protected_content = build_applied_content_projection(
            resume=resume,
            selected_links=links,
        )
        config_paths = _touched_config_paths(changes)
        touched_config = {
            path_name: {
                "before": _value_presence(before_config, path),
                "after": _value_presence(resume.config, path),
            }
            for path_name, path in config_paths.items()
        }
        touched_links = {}
        for link_id in patch.experience_star_by_link_id:
            record = next(
                item for item in frozen_links.values() if str(item.link_id) == link_id
            )
            before_raw = before_overrides[link_id]
            after_raw = deepcopy(link_by_id[link_id].overrides_json)
            touched_links[link_id] = {
                "source_version_id": str(record.source_version_id),
                "before_overrides_json": deepcopy(before_raw),
                "after_overrides_json": after_raw,
                "before_star": {
                    "present": "star" in before_raw,
                    "value": deepcopy(before_raw.get("star")),
                },
                "after_star": {
                    "present": "star" in after_raw,
                    "value": deepcopy(after_raw.get("star")),
                },
            }
        after_snapshot = {
            "version": _APPLY_SNAPSHOT_VERSION,
            "run_id": str(run.id),
            "resume_id": str(resume.id),
            "applied_at": now.isoformat(),
            "applied_change_ids": list(patch.applied_change_ids),
            "before": {
                "touched_config": {
                    key: deepcopy(value["before"])
                    for key, value in touched_config.items()
                },
                "touched_links": {
                    key: {
                        "source_version_id": value["source_version_id"],
                        "overrides_json": deepcopy(value["before_overrides_json"]),
                        "star": deepcopy(value["before_star"]),
                    }
                    for key, value in touched_links.items()
                },
            },
            "after": deepcopy(protected_content),
            "touched_config": touched_config,
            "touched_links": touched_links,
            "protected_content": deepcopy(protected_content),
        }
        after_snapshot["rollback_before_signature"] = _rollback_before_signature(
            run_id=run.id,
            resume_id=resume.id,
            source_snapshot_hash=run.source_snapshot_hash,
            applied_change_ids=list(patch.applied_change_ids),
            before=after_snapshot["before"],
        )
        applied_signature = hash_canonical_json(protected_content)

        require_status_transition(
            ResumeOptimizationStatus(run.status),
            ResumeOptimizationStatus.APPLIED,
        )
        run.status = ResumeOptimizationStatus.APPLIED.value
        run.accepted_change_ids = list(patch.applied_change_ids)
        run.after_snapshot = after_snapshot
        run.applied_content_signature = applied_signature
        run.applied_at = _timestamp_like(run.applied_at or run.updated_at, now)
        run.updated_at = _timestamp_like(run.updated_at, now)
        run.error_json = {}
        session.add(run)
        await session.flush()
        await session.commit()
        return OptimizationApplyResult(
            run=run,
            resume=resume,
            resume_updated_at=resume.updated_at,
            applied_change_ids=list(patch.applied_change_ids),
        )
    except OptimizationApplyStaleError:
        raise
    except BaseException:
        try:
            await session.rollback()
        except Exception:
            pass
        raise


class _PersistedEvaluationPending(ValueError):
    pass


def _require_mapping(value: Any, *, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise OptimizationRunDataInvalidError(f"{field_name} must be an object")
    return value


def _require_exact_keys(
    value: Any,
    expected: set[str] | frozenset[str],
    *,
    field_name: str,
) -> Mapping[str, Any]:
    mapping = _require_mapping(value, field_name=field_name)
    if set(mapping) != set(expected):
        raise OptimizationRunDataInvalidError(f"{field_name} has an invalid shape")
    return mapping


def _validated_presence(value: Any, *, field_name: str) -> dict[str, Any]:
    record = _require_exact_keys(
        value,
        {"present", "value"},
        field_name=field_name,
    )
    if not isinstance(record.get("present"), bool):
        raise OptimizationRunDataInvalidError(
            f"{field_name}.present must be a boolean"
        )
    if record["present"] is False and record.get("value") is not None:
        raise OptimizationRunDataInvalidError(
            f"{field_name}.value must be null when absent"
        )
    return {"present": record["present"], "value": deepcopy(record.get("value"))}


def _restore_presence(
    target: dict[str, Any],
    path: tuple[str, ...],
    presence: Mapping[str, Any],
) -> None:
    cursor = target
    for token in path[:-1]:
        existing = cursor.get(token)
        if not isinstance(existing, dict):
            if presence["present"] is False:
                return
            existing = {}
            cursor[token] = existing
        cursor = existing
    if presence["present"]:
        cursor[path[-1]] = deepcopy(presence.get("value"))
    else:
        cursor.pop(path[-1], None)


_EVALUATION_SECTION_ORDER = (
    "summary",
    "education",
    "work",
    "project",
    "certifications",
    "skills",
)


def _frontend_evaluation_section_order(
    raw_order: list[Any],
    *,
    has_summary: bool,
) -> list[str]:
    editor_order: list[str] = []
    for raw_id in raw_order:
        section_id = str(raw_id)
        if (
            section_id in _EVALUATION_SECTION_ORDER
            and section_id not in editor_order
        ):
            editor_order.append(section_id)
    if "summary" not in editor_order:
        editor_order.insert(0, "summary")
    for section_id in _EVALUATION_SECTION_ORDER:
        if section_id not in editor_order:
            editor_order.append(section_id)
    return [
        section_id
        for section_id in editor_order
        if section_id != "summary" or has_summary
    ]


@dataclass
class _FrontendHtmlSourceNode:
    tag: str | None
    text: str | None
    attrs: tuple[tuple[str, str | None], ...]
    children: list[_FrontendHtmlSourceNode]
    had_child_node: bool


@dataclass
class _FrontendSanitizedNode:
    tag: str | None
    text: str | None
    children: list[_FrontendSanitizedNode | object]


class _FrontendHtmlSourceParser(HTMLParser):
    _VOID_TAGS = frozenset(
        {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _FrontendHtmlSourceNode(None, None, (), [], False)
        self._stack = [self.root]

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.lower()
        node = _FrontendHtmlSourceNode(
            normalized_tag,
            None,
            tuple((name.lower(), value) for name, value in attrs),
            [],
            False,
        )
        self._stack[-1].had_child_node = True
        self._stack[-1].children.append(node)
        if normalized_tag not in self._VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.lower()
        self._stack[-1].had_child_node = True
        self._stack[-1].children.append(
            _FrontendHtmlSourceNode(
                normalized_tag,
                None,
                tuple((name.lower(), value) for name, value in attrs),
                [],
                False,
            )
        )

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == normalized_tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if data:
            self._stack[-1].had_child_node = True
            self._stack[-1].children.append(
                _FrontendHtmlSourceNode(None, data, (), [], False)
            )

    def handle_comment(self, data: str) -> None:
        self._stack[-1].had_child_node = True

    def handle_decl(self, decl: str) -> None:
        # In a fragment/body context Chromium ignores a doctype token instead
        # of creating a child node. An otherwise empty block therefore takes
        # the editor's explicit-break path.
        return None

    def handle_pi(self, data: str) -> None:
        self._stack[-1].had_child_node = True

    def unknown_decl(self, data: str) -> None:
        self._stack[-1].had_child_node = True


_FRONTEND_HTML_BREAK = object()
_FRONTEND_INLINE_TAGS = frozenset({"b", "strong", "i", "em", "u", "a"})
_FRONTEND_LIST_TAGS = frozenset({"ul", "ol", "li"})
_FRONTEND_BLOCK_TAGS = frozenset({"div", "p"})
_FRONTEND_MARKDOWN_TRIGGER_RE = re.compile(
    r"(?:\*\*|＊＊|__|\]\(|\*[^*\r\n]+\*)"
)
_FRONTEND_RICH_TEXT_HTML_TAG_RE = re.compile(
    r"</?(?:b|strong|i|em|u|a|br|ul|ol|li)\b",
    re.IGNORECASE,
)
_FRONTEND_MARKDOWN_HTML_SPLIT_RE = re.compile(r"(<[^>]+>)")
_FRONTEND_MARKDOWN_BOLD_RE = re.compile(
    r"(?:\*\*|＊＊)([^*\r\n＊]+)(?:\*\*|＊＊)"
)
_FRONTEND_MARKDOWN_UNDERLINE_RE = re.compile(r"__([^_\r\n]+)__")
_FRONTEND_MARKDOWN_ITALIC_RE = re.compile(
    r"(^|[^*])\*([^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029"
    r"\u202f\u205f\u3000\ufeff*](?:[^*\r\n]*?[^\t\n\v\f\r \u00a0"
    r"\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff*])?)"
    r"\*(?!\*)"
)
_FRONTEND_NUMERIC_CHARACTER_REFERENCE_RE = re.compile(
    r"&#(?:(?P<hex>[xX][0-9a-fA-F]+)|(?P<decimal>[0-9]+));?"
)


def _frontend_append_break(
    parent: list[_FrontendSanitizedNode | object],
    *,
    explicit: bool = False,
) -> None:
    if explicit or not parent or parent[-1] is not _FRONTEND_HTML_BREAK:
        parent.append(_FRONTEND_HTML_BREAK)


def _frontend_normalize_markdown_token(value: str) -> str:
    normalized = value.replace("\u00a0", " ").replace("\u3000", " ")
    start = 0
    end = len(normalized)
    while start < end and (
        _is_action_ecmascript_whitespace(normalized[start])
        or normalized[start] in "\u200b\u200c\u200d"
    ):
        start += 1
    while end > start and (
        _is_action_ecmascript_whitespace(normalized[end - 1])
        or normalized[end - 1] in "\u200b\u200c\u200d"
    ):
        end -= 1
    return normalized[start:end]


def _frontend_escape_markdown_link_target(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _frontend_markdown_links_to_html(value: str) -> str:
    output: list[str] = []
    cursor = 0
    for start, end, label, target in markdown_link_spans(value):
        output.append(value[cursor:start])
        output.append(
            f'<a href="{_frontend_escape_markdown_link_target(target)}">'
            f"{_frontend_normalize_markdown_token(label)}</a>"
        )
        cursor = end
    output.append(value[cursor:])
    return "".join(output)


def _frontend_apply_legacy_markdown(value: str) -> str:
    rendered = _frontend_markdown_links_to_html(value)
    rendered = _FRONTEND_MARKDOWN_BOLD_RE.sub(
        lambda match: f"<b>{_frontend_normalize_markdown_token(match.group(1))}</b>",
        rendered,
    )
    rendered = _FRONTEND_MARKDOWN_UNDERLINE_RE.sub(
        lambda match: f"<u>{_frontend_normalize_markdown_token(match.group(1))}</u>",
        rendered,
    )
    return _FRONTEND_MARKDOWN_ITALIC_RE.sub(
        lambda match: (
            f"{match.group(1)}<i>"
            f"{_frontend_normalize_markdown_token(match.group(2))}</i>"
        ),
        rendered,
    )


def _frontend_maybe_convert_legacy_markdown(value: str) -> str:
    if not value or _FRONTEND_MARKDOWN_TRIGGER_RE.search(value) is None:
        return value
    if re.search(r"<[^>]+>", value) is None:
        return _frontend_apply_legacy_markdown(value)
    return "".join(
        part
        if part.startswith("<") and part.endswith(">")
        else _frontend_apply_legacy_markdown(part)
        for part in _FRONTEND_MARKDOWN_HTML_SPLIT_RE.split(value)
    )


def _frontend_preserve_numeric_reference_characters(
    value: str,
) -> tuple[str, dict[str, str]]:
    """Protect HTML5 numeric references that Python's parser incorrectly drops."""

    replacements: dict[str, str] = {}
    next_placeholder = 0xF0000

    def replace(match: re.Match[str]) -> str:
        nonlocal next_placeholder
        digits = match.group("hex") or match.group("decimal")
        base = 16 if match.group("hex") else 10
        if match.group("hex"):
            digits = digits[1:]
        try:
            codepoint = int(digits, base)
        except (TypeError, ValueError):
            return match.group()
        is_disallowed_control = (
            1 <= codepoint <= 8
            or codepoint == 11
            or 14 <= codepoint <= 31
            or codepoint == 127
        )
        is_noncharacter = (
            0xFDD0 <= codepoint <= 0xFDEF
            or (
                codepoint <= 0x10FFFF
                and (codepoint & 0xFFFF) in {0xFFFE, 0xFFFF}
            )
        )
        if not (is_disallowed_control or is_noncharacter):
            return match.group()
        while chr(next_placeholder) in value or chr(next_placeholder) in replacements:
            next_placeholder += 1
        placeholder = chr(next_placeholder)
        next_placeholder += 1
        replacements[placeholder] = chr(codepoint)
        return placeholder

    return _FRONTEND_NUMERIC_CHARACTER_REFERENCE_RE.sub(replace, value), replacements


def _frontend_append_text(
    parent: list[_FrontendSanitizedNode | object],
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> None:
    normalized = value.replace("\u00a0", " ")
    if preserve_text_line_breaks:
        if normalized:
            parent.append(_FrontendSanitizedNode(None, normalized, []))
        return
    parts = re.split(r"\r?\n", normalized)
    for index, part in enumerate(parts):
        if part:
            parent.append(_FrontendSanitizedNode(None, part, []))
        if index < len(parts) - 1:
            _frontend_append_break(parent, explicit=True)


def _frontend_style_tags(node: _FrontendHtmlSourceNode) -> list[str]:
    style = next((value for name, value in node.attrs if name == "style"), "") or ""
    declarations: dict[str, str] = {}
    for declaration in style.split(";"):
        name, separator, value = declaration.partition(":")
        if separator:
            declarations[name.strip().lower()] = value.strip().lower()
    tags: list[str] = []
    font_weight = declarations.get("font-weight", "")
    numeric_weight = re.match(r"^[+-]?\d+", font_weight)
    if font_weight in {"bold", "bolder"} or (
        numeric_weight is not None and int(numeric_weight.group()) >= 600
    ):
        tags.append("b")
    if re.match(r"^(?:italic|oblique)\b", declarations.get("font-style", "")):
        tags.append("i")
    text_decoration = " ".join(
        (
            declarations.get("text-decoration-line", ""),
            declarations.get("text-decoration", ""),
        )
    )
    if re.search(r"\bunderline\b", text_decoration):
        tags.append("u")
    return tags


def _frontend_safe_href(node: _FrontendHtmlSourceNode) -> bool:
    href = next((value for name, value in node.attrs if name == "href"), None)
    if not href:
        return False
    try:
        scheme = urlsplit(urljoin("https://fallback.local", href)).scheme
    except ValueError:
        return False
    return scheme in {"http", "https", "mailto", "tel"}


def _frontend_wrap_inline_styles(
    child: _FrontendSanitizedNode,
    style_tags: list[str],
) -> _FrontendSanitizedNode:
    wrapped = child
    for tag in reversed(style_tags):
        wrapped = _FrontendSanitizedNode(tag, None, [wrapped])
    return wrapped


def _frontend_styled_content_parent(
    parent: list[_FrontendSanitizedNode | object],
    style_tags: list[str],
) -> list[_FrontendSanitizedNode | object]:
    current = parent
    for tag in style_tags:
        wrapper = _FrontendSanitizedNode(tag, None, [])
        current.append(wrapper)
        current = wrapper.children
    return current


def _frontend_sanitize_nodes(
    nodes: list[_FrontendHtmlSourceNode],
    parent: list[_FrontendSanitizedNode | object],
    *,
    preserve_text_line_breaks: bool,
) -> None:
    for node in nodes:
        if node.tag is None:
            _frontend_append_text(
                parent,
                node.text or "",
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            continue
        if node.tag == "br":
            _frontend_append_break(parent, explicit=True)
            continue
        if node.tag in _FRONTEND_INLINE_TAGS:
            if node.tag == "a" and not _frontend_safe_href(node):
                _frontend_sanitize_nodes(
                    node.children,
                    parent,
                    preserve_text_line_breaks=preserve_text_line_breaks,
                )
                continue
            mapped_tag = {"strong": "b", "em": "i"}.get(node.tag, node.tag)
            inline = _FrontendSanitizedNode(mapped_tag, None, [])
            _frontend_sanitize_nodes(
                node.children,
                inline.children,
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            style_tags = [
                tag for tag in _frontend_style_tags(node) if tag != mapped_tag
            ]
            parent.append(_frontend_wrap_inline_styles(inline, style_tags))
            continue
        if node.tag in _FRONTEND_LIST_TAGS:
            block = _FrontendSanitizedNode(node.tag, None, [])
            _frontend_sanitize_nodes(
                node.children,
                block.children,
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            parent.append(block)
            continue
        content_parent = _frontend_styled_content_parent(
            parent,
            _frontend_style_tags(node),
        )
        _frontend_sanitize_nodes(
            node.children,
            content_parent,
            preserve_text_line_breaks=preserve_text_line_breaks,
        )
        if node.tag in _FRONTEND_BLOCK_TAGS:
            _frontend_append_break(parent, explicit=not node.had_child_node)


def _frontend_flatten_sanitized_node(
    node: _FrontendSanitizedNode | object,
) -> str:
    if node is _FRONTEND_HTML_BREAK:
        return "\n"
    if not isinstance(node, _FrontendSanitizedNode):
        return ""
    if node.text is not None:
        return node.text
    flattened = "".join(
        _frontend_flatten_sanitized_node(child) for child in node.children
    )
    return f"{flattened}\n" if node.tag == "li" else flattened


def _frontend_serialize_sanitized_node(
    node: _FrontendSanitizedNode | object,
) -> str:
    if node is _FRONTEND_HTML_BREAK:
        return "<br>"
    if not isinstance(node, _FrontendSanitizedNode):
        return ""
    if node.text is not None:
        return html_lib.escape(node.text, quote=False)
    content = "".join(
        _frontend_serialize_sanitized_node(child) for child in node.children
    )
    return f"<{node.tag}>{content}</{node.tag}>" if node.tag else content


def _frontend_sanitized_nodes(
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> tuple[list[_FrontendSanitizedNode | object], dict[str, str]]:
    value = _frontend_maybe_convert_legacy_markdown(value)
    value, preserved_references = _frontend_preserve_numeric_reference_characters(value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    parser = _FrontendHtmlSourceParser()
    parser.feed(value)
    parser.close()
    sanitized: list[_FrontendSanitizedNode | object] = []
    _frontend_sanitize_nodes(
        parser.root.children,
        sanitized,
        preserve_text_line_breaks=preserve_text_line_breaks,
    )
    while sanitized and sanitized[-1] is _FRONTEND_HTML_BREAK:
        sanitized.pop()
    return sanitized, preserved_references


def _frontend_restore_preserved_references(
    value: str,
    preserved_references: Mapping[str, str],
) -> str:
    for placeholder, character in preserved_references.items():
        value = value.replace(placeholder, character)
    return value


def _frontend_sanitized_html(value: str) -> str:
    """Mirror one browser ``sanitizeRichTextHtml`` serialize pass."""

    sanitized, preserved_references = _frontend_sanitized_nodes(
        value,
        preserve_text_line_breaks=False,
    )
    return _frontend_restore_preserved_references(
        "".join(_frontend_serialize_sanitized_node(node) for node in sanitized),
        preserved_references,
    )


def _frontend_sanitized_plain_text(
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> str:
    sanitized, preserved_references = _frontend_sanitized_nodes(
        value,
        preserve_text_line_breaks=preserve_text_line_breaks,
    )
    # The frontend serializes the sanitized tree and parses it once more before
    # reading textContent. That second HTML parse canonicalizes CR character
    # references in text nodes to LF.
    flattened = "".join(
        _frontend_flatten_sanitized_node(node) for node in sanitized
    ).replace("\r\n", "\n").replace("\r", "\n")
    return _frontend_restore_preserved_references(
        flattened,
        preserved_references,
    )


def _frontend_plain_text(
    value: Any,
    *,
    preserve_plain_line_breaks: bool = False,
) -> str:
    text = "" if value is None else str(value)
    if not text:
        return ""
    text = _frontend_sanitized_plain_text(
        text,
        preserve_text_line_breaks=preserve_plain_line_breaks,
    )
    start = 0
    end = len(text)
    while start < end and _is_action_ecmascript_whitespace(text[start]):
        start += 1
    while end > start and _is_action_ecmascript_whitespace(text[end - 1]):
        end -= 1
    return text[start:end]


def _frontend_decode_rich_text_entities_deep(value: Any) -> str:
    text = "" if value is None else str(value)
    rich_entity_pattern = re.compile(
        r"&(lt|gt|amp;lt|amp;gt);",
        re.IGNORECASE,
    )
    for _ in range(2):
        if rich_entity_pattern.search(text) is None:
            break
        protected, preserved_references = (
            _frontend_preserve_numeric_reference_characters(text)
        )
        decoded = html_lib.unescape(protected)
        for placeholder, character in preserved_references.items():
            decoded = decoded.replace(placeholder, character)
        if decoded == text:
            break
        text = decoded
    return text


def _frontend_star_plain_text(value: Any) -> str:
    """Mirror normalizeStarValue followed by evaluation plainText."""

    normalized = _frontend_decode_rich_text_entities_deep(value)
    if (
        _FRONTEND_RICH_TEXT_HTML_TAG_RE.search(normalized) is not None
        or _FRONTEND_MARKDOWN_TRIGGER_RE.search(normalized) is not None
    ):
        normalized = _frontend_sanitized_html(normalized)
    return _frontend_plain_text(normalized)


def _frontend_snapshot_plain_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    start = 0
    end = len(text)
    while start < end and _is_action_ecmascript_whitespace(text[start]):
        start += 1
    while end > start and _is_action_ecmascript_whitespace(text[end - 1]):
        end -= 1
    return text[start:end]


def _snapshot_object(value: Any, *, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise OptimizationRunDataInvalidError(f"{field_name} must be an object")
    return value


def _snapshot_array(value: Any, *, field_name: str) -> list[Any]:
    if not isinstance(value, list):
        raise OptimizationRunDataInvalidError(f"{field_name} must be an array")
    return value


def _exact_frontend_item(
    value: Any,
    *,
    required: set[str],
    optional: set[str] = frozenset(),
    nullable: set[str] = frozenset(),
    field_name: str,
) -> Mapping[str, Any]:
    item = _snapshot_object(value, field_name=field_name)
    if not required.issubset(item) or set(item) - required - optional:
        raise OptimizationRunDataInvalidError(f"{field_name} has an invalid shape")
    for key in set(item) - {"star"}:
        if item[key] is None and key in nullable:
            continue
        if not isinstance(item[key], str):
            raise OptimizationRunDataInvalidError(
                f"{field_name}.{key} must be text"
            )
    return item


def _rebuild_frontend_fact_metadata(
    snapshot: Mapping[str, Any],
    *,
    normalized_profile_summary: bool = True,
) -> list[dict[str, Any]]:
    resume = _snapshot_object(snapshot.get("resume"), field_name="frontend resume")
    profile = _snapshot_object(
        resume.get("profile"),
        field_name="frontend resume.profile",
    )
    experiences = _snapshot_array(
        resume.get("experiences"),
        field_name="frontend resume.experiences",
    )
    educations = _snapshot_array(
        resume.get("educations"),
        field_name="frontend resume.educations",
    )
    certifications = _snapshot_array(
        resume.get("certifications"),
        field_name="frontend resume.certifications",
    )
    skills = _snapshot_array(
        resume.get("skills"),
        field_name="frontend resume.skills",
    )
    facts: list[dict[str, Any]] = []

    def add(source: str, value: Any, *, already_plain: bool = False) -> None:
        content = (
            _frontend_snapshot_plain_text(value)
            if already_plain
            else _frontend_plain_text(value)
        )
        if not content:
            return
        facts.append(
            {
                "fact_id": f"FACT_{len(facts) + 1:03d}",
                "content": content,
                "verification_status": "user_claimed",
                "source": source,
                "confidence": 1,
            }
        )

    for field in ("name", "email", "phone", "location", "linkedin"):
        add(
            f"resume.profile.{field}",
            profile.get(field),
            already_plain=normalized_profile_summary,
        )
    add(
        "resume.personal_summary",
        resume.get("personal_summary"),
        already_plain=normalized_profile_summary,
    )
    for index, raw_item in enumerate(experiences):
        item = _snapshot_object(raw_item, field_name="frontend experience")
        base = f"resume.experiences[{index}]"
        add(f"{base}.org", item.get("org"))
        add(f"{base}.title", item.get("title"))
        add(f"{base}.start_date", item.get("start_date"))
        add(f"{base}.end_date", item.get("end_date"))
        star = _snapshot_object(item.get("star"), field_name="frontend experience.star")
        for key in ("s", "t", "a", "r"):
            add(f"{base}.star.{key}", star.get(key), already_plain=True)
    for index, raw_item in enumerate(educations):
        item = _snapshot_object(raw_item, field_name="frontend education")
        base = f"resume.educations[{index}]"
        for field in (
            "school",
            "major",
            "degree",
            "start_date",
            "end_date",
            "gpa",
            "courses",
        ):
            add(f"{base}.{field}", item.get(field), already_plain=True)
    for index, raw_item in enumerate(certifications):
        item = _snapshot_object(raw_item, field_name="frontend certification")
        base = f"resume.certifications[{index}]"
        for field in ("name", "issuer", "issue_date"):
            add(f"{base}.{field}", item.get(field))
    for index, raw_item in enumerate(skills):
        item = _snapshot_object(raw_item, field_name="frontend skill")
        add(f"resume.skills[{index}].name", item.get("name"))
        add(f"resume.skills[{index}].category", item.get("category"))
    add("target_role", snapshot.get("target_role"), already_plain=True)
    return facts


def _validate_exact_frontend_evaluation_snapshot(
    value: Any,
    *,
    normalized_profile_summary_facts: bool = True,
) -> dict[str, Any]:
    snapshot = _require_exact_keys(
        value,
        {
            "evaluation_scope",
            "target_role",
            "resume",
            "experience_atoms",
            "match_candidates",
            "fact_metadata",
        },
        field_name="frontend evaluation snapshot",
    )
    if snapshot.get("evaluation_scope") != "full_resume" or not isinstance(
        snapshot.get("target_role"),
        str,
    ):
        raise OptimizationRunDataInvalidError("frontend evaluation identity is invalid")
    resume = _require_exact_keys(
        snapshot.get("resume"),
        {
            "section_order",
            "profile",
            "personal_summary",
            "experiences",
            "educations",
            "certifications",
            "skills",
        },
        field_name="frontend resume",
    )
    profile = _require_exact_keys(
        resume.get("profile"),
        {"name", "email", "phone", "location", "linkedin"},
        field_name="frontend resume.profile",
    )
    if any(not isinstance(value, str) for value in profile.values()) or not isinstance(
        resume.get("personal_summary"),
        str,
    ):
        raise OptimizationRunDataInvalidError("frontend profile is invalid")
    order = _snapshot_array(
        resume.get("section_order"),
        field_name="frontend resume.section_order",
    )
    if (
        any(not isinstance(item, str) for item in order)
        or len(order) != len(set(order))
        or any(item not in _EVALUATION_SECTION_ORDER for item in order)
    ):
        raise OptimizationRunDataInvalidError("frontend section order is invalid")
    if _frontend_snapshot_plain_text(snapshot["target_role"]) != snapshot["target_role"]:
        raise OptimizationRunDataInvalidError("frontend target role must be plain text")
    for value_to_check in [*profile.values(), resume["personal_summary"]]:
        if _frontend_snapshot_plain_text(value_to_check) != value_to_check:
            raise OptimizationRunDataInvalidError(
                "frontend visible profile must be plain text"
            )

    experiences = _snapshot_array(
        resume.get("experiences"),
        field_name="frontend resume.experiences",
    )
    for index, value_item in enumerate(experiences):
        item = _exact_frontend_item(
            value_item,
            required={"id", "title", "org", "star", "category"},
            optional={"start_date", "end_date"},
            nullable={"start_date", "end_date"},
            field_name=f"frontend resume.experiences[{index}]",
        )
        if item["category"] not in {"work", "project"}:
            raise OptimizationRunDataInvalidError("frontend experience category is invalid")
        star = _require_exact_keys(
            item.get("star"),
            {"s", "t", "a", "r"},
            field_name=f"frontend resume.experiences[{index}].star",
        )
        if any(
            not isinstance(value, str)
            or _frontend_snapshot_plain_text(value) != value
            for value in star.values()
        ):
            raise OptimizationRunDataInvalidError("frontend formal STAR must be plain text")

    for index, value_item in enumerate(
        _snapshot_array(resume.get("educations"), field_name="frontend educations")
    ):
        item = _exact_frontend_item(
            value_item,
            required={"id", "school", "major", "degree"},
            optional={"start_date", "end_date", "gpa", "courses"},
            field_name=f"frontend resume.educations[{index}]",
        )
        if any(
            _frontend_snapshot_plain_text(value) != value for value in item.values()
        ):
            raise OptimizationRunDataInvalidError("frontend education must be plain text")
    for index, value_item in enumerate(
        _snapshot_array(
            resume.get("certifications"),
            field_name="frontend certifications",
        )
    ):
        _exact_frontend_item(
            value_item,
            required={"id", "name", "issuer", "issue_date"},
            field_name=f"frontend resume.certifications[{index}]",
        )
    for index, value_item in enumerate(
        _snapshot_array(resume.get("skills"), field_name="frontend skills")
    ):
        _exact_frontend_item(
            value_item,
            required={"id", "name", "category"},
            field_name=f"frontend resume.skills[{index}]",
        )
    for index, value_item in enumerate(
        _snapshot_array(
            snapshot.get("experience_atoms"),
            field_name="frontend experience_atoms",
        )
    ):
        item = _exact_frontend_item(
            value_item,
            required={"id", "title", "org", "star"},
            optional={"start_date", "end_date"},
            nullable={"start_date", "end_date"},
            field_name=f"frontend experience_atoms[{index}]",
        )
        star = _require_exact_keys(
            item.get("star"),
            {"s", "t", "a", "r"},
            field_name=f"frontend experience_atoms[{index}].star",
        )
        if any(not isinstance(value, str) for value in star.values()):
            raise OptimizationRunDataInvalidError("frontend candidate STAR is invalid")
    candidates = _require_exact_keys(
        snapshot.get("match_candidates"),
        {"certifications", "skills"},
        field_name="frontend match_candidates",
    )
    for index, value_item in enumerate(
        _snapshot_array(
            candidates.get("certifications"),
            field_name="frontend candidate certifications",
        )
    ):
        _exact_frontend_item(
            value_item,
            required={"id", "name", "issuer", "issue_date"},
            field_name=f"frontend match_candidates.certifications[{index}]",
        )
    for index, value_item in enumerate(
        _snapshot_array(
            candidates.get("skills"),
            field_name="frontend candidate skills",
        )
    ):
        _exact_frontend_item(
            value_item,
            required={"id", "name", "category"},
            field_name=f"frontend match_candidates.skills[{index}]",
        )
    fact_metadata = _snapshot_array(
        snapshot.get("fact_metadata"),
        field_name="frontend fact_metadata",
    )
    rebuilt_facts = _rebuild_frontend_fact_metadata(
        snapshot,
        normalized_profile_summary=normalized_profile_summary_facts,
    )
    if fact_metadata != rebuilt_facts:
        raise OptimizationRunDataInvalidError("frontend fact metadata is invalid")
    return deepcopy(dict(snapshot))


def _source_frontend_evaluation_snapshot(
    run: ResumeOptimizationRun,
    *,
    allow_legacy: bool = False,
) -> dict[str, Any]:
    if allow_legacy and run.status not in _POST_APPLY_SIGNATURE_COMPATIBLE_STATUSES:
        raise OptimizationRunDataInvalidError(
            "legacy source signatures are restricted to post-apply runs"
        )
    snapshot = _validated_snapshot(run)
    legacy_allowed_for_snapshot = (
        allow_legacy and _EVALUATION_SIGNATURE_SCHEMA_KEY not in snapshot
    )
    uses_v2_fact_contract = (
        snapshot.get(_EVALUATION_SIGNATURE_SCHEMA_KEY)
        == _FRONTEND_EVALUATION_SIGNATURE_SCHEMA_V2
    )
    return _parse_frontend_evaluation_signature(
        run.source_evaluation_signature,
        jd_input_signature=run.source_jd_signature,
        field_name="source evaluation signature",
        expected_evaluation=snapshot.get("evaluation"),
        allow_legacy=legacy_allowed_for_snapshot,
        normalized_profile_summary_facts=uses_v2_fact_contract,
    )


def _frontend_json_key_order(value: str) -> bytes:
    """Match Array.sort's UTF-16 code-unit order used by canonicalStringify."""

    return value.encode("utf-16-be", "surrogatepass")


def _reject_nonfinite_json_constant(value: str) -> Any:
    raise ValueError(f"non-finite JSON constant: {value}")


def _is_finite_json_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except (OverflowError, TypeError, ValueError):
        return False


def _require_finite_json_tree(value: Any) -> None:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and not _is_finite_json_number(value)
    ):
        raise ValueError("non-finite JSON number")
    if isinstance(value, list):
        for item in value:
            _require_finite_json_tree(item)
    elif isinstance(value, Mapping):
        for item in value.values():
            _require_finite_json_tree(item)


def _load_frontend_canonical_json(raw_value: Any, *, field_name: str) -> Any:
    """Parse frontend canonical JSON without reserializing JS number tokens.

    JavaScript JSON.stringify and Python json.dumps intentionally render some
    finite numbers differently (for example 1e-6 and negative zero).  The
    signature is already persisted and hash-bound, so canonicality here is the
    structural contract: compact JSON, sorted object keys, and no duplicates.
    Parsed values are subsequently checked against trusted persisted objects.
    """

    if not isinstance(raw_value, str):
        raise OptimizationRunDataInvalidError(f"{field_name} is not canonical JSON")

    in_string = False
    escaped = False
    for char in raw_value:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in " \t\r\n":
            raise OptimizationRunDataInvalidError(
                f"{field_name} is not canonical JSON"
            )

    def canonical_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        keys = [key for key, _value in pairs]
        if len(keys) != len(set(keys)) or keys != sorted(
            keys, key=_frontend_json_key_order
        ):
            raise ValueError("object keys are duplicated or not canonical")
        return dict(pairs)

    try:
        parsed = json.loads(
            raw_value,
            object_pairs_hook=canonical_object,
            parse_constant=_reject_nonfinite_json_constant,
        )
        _require_finite_json_tree(parsed)
        return parsed
    except (TypeError, ValueError) as exc:
        raise OptimizationRunDataInvalidError(
            f"{field_name} is not canonical JSON"
        ) from exc


def _json_values_semantically_equal(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return left is None and right is None
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if isinstance(left, (int, float)) or isinstance(right, (int, float)):
        return (
            _is_finite_json_number(left)
            and _is_finite_json_number(right)
            and left == right
        )
    if isinstance(left, str) or isinstance(right, str):
        return isinstance(left, str) and isinstance(right, str) and left == right
    if isinstance(left, list) or isinstance(right, list):
        return (
            isinstance(left, list)
            and isinstance(right, list)
            and len(left) == len(right)
            and all(
                _json_values_semantically_equal(left_item, right_item)
                for left_item, right_item in zip(left, right)
            )
        )
    if isinstance(left, Mapping) or isinstance(right, Mapping):
        return (
            isinstance(left, Mapping)
            and isinstance(right, Mapping)
            and set(left) == set(right)
            and all(
                _json_values_semantically_equal(left[key], right[key])
                for key in left
            )
        )
    return False


def _parse_frontend_evaluation_signature(
    raw_signature: Any,
    *,
    jd_input_signature: str,
    field_name: str,
    expected_evaluation: Any = _EXPECTED_SIGNATURE_VALUE_UNSET,
    expected_jd_result: Any = _EXPECTED_SIGNATURE_VALUE_UNSET,
    expected_jd_result_identity: str | None = None,
    allow_legacy: bool = False,
    normalized_profile_summary_facts: bool = True,
) -> dict[str, Any]:
    # Optimization runs accept the editor's canonical frontend snapshot only.
    # Agent final-snapshot attestations use a different snapshot domain and must
    # be refreshed in the editor before an optimization run can be created.
    parsed = _load_frontend_canonical_json(raw_signature, field_name=field_name)
    if (
        isinstance(parsed, Mapping)
        and set(parsed) == _LEGACY_FRONTEND_EVALUATION_SIGNATURE_KEYS
    ):
        if not allow_legacy or parsed.get("jdInputSignature") != jd_input_signature:
            raise OptimizationRunDataInvalidError(
                f"{field_name} legacy identity is invalid"
            )
        return _validate_exact_frontend_evaluation_snapshot(
            _snapshot_object(
                parsed.get("resume"),
                field_name="legacy source frontend evaluation snapshot",
            ),
            normalized_profile_summary_facts=normalized_profile_summary_facts,
        )
    signature = _require_exact_keys(
        parsed,
        {
            "jdInputSignature",
            "resume",
            "jdAvailable",
            "jdResultIdentity",
            "jdMatchPercentage",
        },
        field_name=field_name,
    )
    jd_available = signature.get("jdAvailable")
    jd_result_identity = signature.get("jdResultIdentity")
    jd_match_percentage = signature.get("jdMatchPercentage")
    if (
        signature.get("jdInputSignature") != jd_input_signature
        or not isinstance(jd_available, bool)
        or not isinstance(jd_result_identity, str)
    ):
        raise OptimizationRunDataInvalidError(
            f"{field_name} identity is invalid"
        )
    parsed_jd_identity = _load_frontend_canonical_json(
        jd_result_identity,
        field_name=f"{field_name} JD result identity",
    )
    match_is_number = (
        _is_finite_json_number(jd_match_percentage)
        and 0 <= float(jd_match_percentage) <= 100
    )
    if (
        (jd_available and (not match_is_number or parsed_jd_identity is None))
        or (
            not jd_available
            and (jd_match_percentage is not None or parsed_jd_identity is not None)
        )
    ):
        raise OptimizationRunDataInvalidError(
            f"{field_name} JD availability is invalid"
        )

    if expected_evaluation is not _EXPECTED_SIGNATURE_VALUE_UNSET:
        if not isinstance(expected_evaluation, Mapping):
            raise OptimizationRunDataInvalidError(
                f"{field_name} evaluation is invalid"
            )
        evaluation_match = expected_evaluation.get("jdMatch")
        if "jdMatch" not in expected_evaluation:
            evaluation_match = expected_evaluation.get("jd_match")
        evaluation_available = evaluation_match is not None
        if evaluation_available != jd_available or (
            evaluation_available
            and (
                not _is_finite_json_number(evaluation_match)
                or float(evaluation_match) != float(jd_match_percentage)
            )
        ):
            raise OptimizationRunDataInvalidError(
                f"{field_name} JD match disagrees with the evaluation"
            )

    if expected_jd_result is not _EXPECTED_SIGNATURE_VALUE_UNSET:
        expected_identity: Any = None
        if jd_available:
            if not isinstance(expected_jd_result, Mapping):
                raise OptimizationRunDataInvalidError(
                    f"{field_name} persisted JD result is invalid"
                )
            identity_payload = deepcopy(dict(expected_jd_result))
            identity_payload.pop("resumeEvaluation", None)
            expected_identity = identity_payload
            outer_match = expected_jd_result.get("matchPercentage")
            if (
                not _is_finite_json_number(outer_match)
                or float(outer_match) != float(jd_match_percentage)
            ):
                raise OptimizationRunDataInvalidError(
                    f"{field_name} JD match disagrees with the persisted result"
                )
        if not _json_values_semantically_equal(
            parsed_jd_identity,
            expected_identity,
        ):
            raise OptimizationRunDataInvalidError(
                f"{field_name} JD result identity disagrees with persisted data"
            )
    if (
        expected_jd_result_identity is not None
        and not _json_values_semantically_equal(
            parsed_jd_identity,
            _load_frontend_canonical_json(
                expected_jd_result_identity,
                field_name=f"{field_name} expected JD result identity",
            ),
        )
    ):
        raise OptimizationRunDataInvalidError(
            f"{field_name} JD result identity changed"
        )
    raw_snapshot = _snapshot_object(
        signature.get("resume"),
        field_name="source frontend evaluation snapshot",
    )
    return _validate_exact_frontend_evaluation_snapshot(
        raw_snapshot,
        normalized_profile_summary_facts=normalized_profile_summary_facts,
    )


def _one_snapshot_item(
    items: Any,
    *,
    item_id: str,
    field_name: str,
) -> Mapping[str, Any]:
    matches = [
        item
        for item in _snapshot_array(items, field_name=field_name)
        if isinstance(item, Mapping) and str(item.get("id")) == item_id
    ]
    if len(matches) != 1:
        raise _PersistedEvaluationPending()
    return matches[0]


def _validated_post_frontend_evaluation_context(
    *,
    run: ResumeOptimizationRun,
    changes: list[OptimizationChange],
    persisted_signature: Any,
    applied_config: Any,
    persisted_evaluation: Any,
    persisted_jd_result: Any,
) -> tuple[dict[str, Any], str]:
    try:
        source = _source_frontend_evaluation_snapshot(run, allow_legacy=True)
        source_signature = _load_frontend_canonical_json(
            run.source_evaluation_signature,
            field_name="source evaluation signature",
        )
        source_jd_result_identity = (
            source_signature.get("jdResultIdentity")
            if isinstance(source_signature, Mapping)
            else None
        )
        post = _parse_frontend_evaluation_signature(
            persisted_signature,
            jd_input_signature=run.source_jd_signature,
            field_name="post evaluation signature",
            expected_evaluation=persisted_evaluation,
            expected_jd_result=persisted_jd_result,
            expected_jd_result_identity=(
                source_jd_result_identity
                if isinstance(source_jd_result_identity, str)
                else None
            ),
        )
    except OptimizationRunDataInvalidError as exc:
        raise _PersistedEvaluationPending() from exc

    source_resume = _snapshot_object(
        source.get("resume"),
        field_name="source frontend resume",
    )
    post_resume = _snapshot_object(
        post.get("resume"),
        field_name="post frontend resume",
    )
    untouched = deepcopy(post)
    untouched_resume = untouched["resume"]
    config = _snapshot_object(applied_config, field_name="applied resume config")
    raw_layout = config.get("layout")
    if raw_layout is not None and not isinstance(raw_layout, Mapping):
        raise OptimizationRunDataInvalidError("applied resume layout is invalid")
    layout = raw_layout if isinstance(raw_layout, Mapping) else {}
    summary_change = next(
        (
            item
            for item in changes
            if item.module_type == OptimizationModuleType.PERSONAL_SUMMARY
        ),
        None,
    )
    section_change = next(
        (
            item
            for item in changes
            if item.module_type == OptimizationModuleType.SECTION_ORDER
        ),
        None,
    )
    summary_visible = layout.get("isSummaryVisible") is not False
    expected_summary = source_resume.get("personal_summary")
    if summary_change is not None and summary_visible:
        expected_summary = _frontend_plain_text(summary_change.targeted_value)
    if post_resume.get("personal_summary") != expected_summary:
        raise _PersistedEvaluationPending()
    if summary_change is not None and summary_visible:
        untouched_resume["personal_summary"] = deepcopy(
            source_resume.get("personal_summary")
        )

    raw_section_order = layout.get("sectionOrder")
    if raw_section_order is not None and not isinstance(raw_section_order, list):
        raise _PersistedEvaluationPending()
    if section_change is not None and not isinstance(raw_section_order, list):
        raise _PersistedEvaluationPending()
    if isinstance(raw_section_order, list) or (
        summary_change is not None and summary_visible
    ):
        order_source: list[Any] = (
            raw_section_order
            if isinstance(raw_section_order, list)
            else []
        )
        expected_section_order = _frontend_evaluation_section_order(
            order_source,
            has_summary=bool(expected_summary),
        )
    else:
        expected_section_order = deepcopy(source_resume.get("section_order"))
    if post_resume.get("section_order") != expected_section_order:
        raise _PersistedEvaluationPending()
    if section_change is not None or (
        summary_change is not None and summary_visible
    ):
        untouched_resume["section_order"] = deepcopy(
            source_resume.get("section_order")
        )

    for change in changes:
        if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
            source_experience = _one_snapshot_item(
                source_resume.get("experiences"),
                item_id=change.module_id,
                field_name="source frontend experiences",
            )
            post_experience = _one_snapshot_item(
                post_resume.get("experiences"),
                item_id=change.module_id,
                field_name="post frontend experiences",
            )
            untouched_experience = _one_snapshot_item(
                untouched_resume.get("experiences"),
                item_id=change.module_id,
                field_name="post frontend experiences",
            )
            star_key = change.field_path[-1]
            source_star = _snapshot_object(
                source_experience.get("star"),
                field_name="source frontend experience.star",
            )
            post_star = _snapshot_object(
                post_experience.get("star"),
                field_name="post frontend experience.star",
            )
            target_text = _frontend_star_plain_text(change.targeted_value)
            if post_star.get(star_key) != target_text:
                raise _PersistedEvaluationPending()
            untouched_experience["star"][star_key] = deepcopy(source_star[star_key])

            source_atom = _one_snapshot_item(
                source.get("experience_atoms"),
                item_id=change.module_id,
                field_name="source frontend experience_atoms",
            )
            post_atom = _one_snapshot_item(
                post.get("experience_atoms"),
                item_id=change.module_id,
                field_name="post frontend experience_atoms",
            )
            untouched_atom = _one_snapshot_item(
                untouched.get("experience_atoms"),
                item_id=change.module_id,
                field_name="post frontend experience_atoms",
            )
            source_atom_star = _snapshot_object(
                source_atom.get("star"),
                field_name="source frontend experience_atom.star",
            )
            post_atom_star = _snapshot_object(
                post_atom.get("star"),
                field_name="post frontend experience_atom.star",
            )
            if _frontend_plain_text(post_atom_star.get(star_key)) != target_text:
                raise _PersistedEvaluationPending()
            untouched_atom["star"][star_key] = deepcopy(source_atom_star[star_key])
        elif change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
            continue
        elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
            targeted_ids = _string_order(
                change.targeted_value,
                field_name="targeted skill order",
            )
            source_skills = _snapshot_array(
                source_resume.get("skills"),
                field_name="source frontend skills",
            )
            post_skills = _snapshot_array(
                post_resume.get("skills"),
                field_name="post frontend skills",
            )
            source_by_id = {
                str(item.get("id")): item
                for item in source_skills
                if isinstance(item, Mapping)
            }
            if (
                [str(item.get("id")) for item in post_skills] != targeted_ids
                or len(source_by_id) != len(source_skills)
                or set(source_by_id) != set(targeted_ids)
                or any(
                    deepcopy(item) != deepcopy(source_by_id.get(str(item.get("id"))))
                    for item in post_skills
                    if isinstance(item, Mapping)
                )
            ):
                raise _PersistedEvaluationPending()
            untouched_resume["skills"] = deepcopy(source_skills)
        elif change.module_type == OptimizationModuleType.SECTION_ORDER:
            continue
        else:
            raise _PersistedEvaluationPending()

    untouched["fact_metadata"] = deepcopy(source.get("fact_metadata"))
    if untouched != source:
        raise _PersistedEvaluationPending()
    return post, str(persisted_signature)


def _normalized_evaluation(
    raw: Any,
    *,
    jd_available: bool,
    fact_metadata: Any,
) -> dict[str, Any]:
    if not isinstance(fact_metadata, list):
        raise ValueError("evaluation fact metadata must be an array")
    return normalize_resume_evaluation(
        raw,
        jd_available=jd_available,
        fact_metadata=fact_metadata,
    )


def _raw_evaluation_jd_available(raw: Any) -> bool:
    if not isinstance(raw, Mapping):
        raise ValueError("resume evaluation must be an object")
    value = raw.get("jdMatch")
    if "jdMatch" not in raw:
        value = raw.get("jd_match")
    return value is not None


def source_before_score_from_run(
    run: ResumeOptimizationRun,
    *,
    allow_legacy: bool = False,
) -> int:
    try:
        snapshot = _validated_snapshot(run)
        source_frontend_snapshot = _source_frontend_evaluation_snapshot(
            run,
            allow_legacy=allow_legacy,
        )
        jd_available = _raw_evaluation_jd_available(snapshot.get("evaluation"))
        before = _normalized_evaluation(
            snapshot.get("evaluation"),
            jd_available=jd_available,
            fact_metadata=source_frontend_snapshot.get("fact_metadata"),
        )
        return int(before["overallScore"])
    except (
        OptimizationApplyValidationError,
        OptimizationApplyStaleError,
        TypeError,
        ValueError,
    ) as exc:
        raise OptimizationRunDataInvalidError(
            "Frozen source evaluation is invalid"
        ) from exc


def _semantic_issue_identity(issue: Any) -> tuple[Any, ...]:
    if not isinstance(issue, Mapping):
        raise ValueError("normalized issue must be an object")
    description = re.sub(r"\s+", "", str(issue.get("description") or "")).casefold()
    primary_dimension = str(issue.get("primaryDimension") or "")
    related = issue.get("relatedDimensions")
    if not isinstance(related, list):
        raise ValueError("normalized issue relatedDimensions must be an array")
    return (primary_dimension, description, tuple(sorted(str(item) for item in related)))


def _post_evaluation_summary(
    *,
    run: ResumeOptimizationRun,
    resume: Resume,
    evaluation_signature: str,
    before: Mapping[str, Any],
    after: Mapping[str, Any],
) -> dict[str, Any]:
    before_dimensions = {
        item["dimension"]: item
        for item in before.get("dimensions", [])
        if isinstance(item, Mapping)
    }
    after_dimensions = {
        item["dimension"]: item
        for item in after.get("dimensions", [])
        if isinstance(item, Mapping)
    }
    if set(before_dimensions) != set(DIMENSION_NAMES) or set(after_dimensions) != set(
        DIMENSION_NAMES
    ):
        raise ValueError("normalized evaluations do not contain six dimensions")

    dimension_deltas = []
    for name in DIMENSION_NAMES:
        before_score = int(before_dimensions[name]["score"])
        after_score = int(after_dimensions[name]["score"])
        dimension_deltas.append(
            {
                "dimension": name,
                "beforeScore": before_score,
                "afterScore": after_score,
                "delta": after_score - before_score,
            }
        )

    before_issues = {
        _semantic_issue_identity(issue) for issue in before.get("issues", [])
    }
    after_issues = {
        _semantic_issue_identity(issue) for issue in after.get("issues", [])
    }
    plan = _strict_final_plan(run)
    safety = plan.safety_summary
    before_score = int(before["overallScore"])
    after_score = int(after["overallScore"])
    payload = {
        "version": _POST_EVALUATION_VERSION,
        "evaluationSignature": evaluation_signature,
        "resumeUpdatedAt": _normalize_current_timestamp(resume.updated_at),
        "beforeScore": before_score,
        "afterScore": after_score,
        "scoreDelta": after_score - before_score,
        "dimensionDeltas": dimension_deltas,
        "issueCounts": {
            "before": len(before_issues),
            "after": len(after_issues),
            "resolved": len(before_issues - after_issues),
            "remaining": len(after_issues),
            "introduced": len(after_issues - before_issues),
        },
        "unresolvedFactGapCount": len(after.get("missingInformation", [])),
        "acceptedChangeCount": len(run.accepted_change_ids),
        "blockedChangeCount": len(safety.blocked_change_ids),
        "bankSuggestionCount": len(plan.bank_suggestions),
        "safetySummary": safety.model_dump(mode="json"),
    }
    return ResumeOptimizationPostEvaluation.model_validate(payload).model_dump(
        mode="json"
    )


def _safe_finalize_error() -> dict[str, Any]:
    return {
        "code": OptimizationFinalizePendingError.code,
        "message": OptimizationFinalizePendingError.public_message,
        "statusCode": OptimizationFinalizePendingError.status_code,
        "retryable": True,
    }


def _validate_applied_identity(
    run: ResumeOptimizationRun,
) -> tuple[
    dict[str, Any],
    dict[str, _FrozenLink],
    list[OptimizationChange],
]:
    if not isinstance(run.accepted_change_ids, list):
        raise OptimizationRunDataInvalidError("accepted_change_ids must be an array")
    accepted_ids = list(run.accepted_change_ids)
    if (
        not accepted_ids
        or any(not isinstance(item, str) or not item.strip() for item in accepted_ids)
        or len(accepted_ids) != len(set(accepted_ids))
    ):
        raise OptimizationRunDataInvalidError("accepted_change_ids are invalid")
    try:
        snapshot = _validated_snapshot(run)
        frozen_links = _frozen_links(run)
        changes = _accepted_changes(
            run,
            set(accepted_ids),
            enforce_current_safety=False,
        )
    except (OptimizationApplyValidationError, OptimizationApplyStaleError) as exc:
        raise OptimizationRunDataInvalidError() from exc
    if [change.change_id for change in changes] != accepted_ids:
        raise OptimizationRunDataInvalidError(
            "accepted_change_ids do not match persisted plan order"
        )
    if not isinstance(run.applied_content_signature, str) or not re.fullmatch(
        r"[0-9a-f]{64}",
        run.applied_content_signature,
    ):
        raise OptimizationRunDataInvalidError("applied content signature is invalid")
    return snapshot, frozen_links, changes


def _validated_apply_journal(
    run: ResumeOptimizationRun,
    *,
    frozen_links: Mapping[str, _FrozenLink],
    changes: list[OptimizationChange],
) -> dict[str, Any]:
    journal = _require_exact_keys(
        run.after_snapshot,
        {
            "version",
            "run_id",
            "resume_id",
            "applied_at",
            "applied_change_ids",
            "before",
            "after",
            "touched_config",
            "touched_links",
            "protected_content",
            "rollback_before_signature",
        },
        field_name="after_snapshot",
    )
    if (
        journal.get("version") != _APPLY_SNAPSHOT_VERSION
        or str(journal.get("run_id")) != str(run.id)
        or str(journal.get("resume_id")) != str(run.resume_id)
        or journal.get("applied_change_ids") != list(run.accepted_change_ids)
    ):
        raise OptimizationRunDataInvalidError("after_snapshot identity is invalid")
    if run.applied_at is None or not isinstance(journal.get("applied_at"), str):
        raise OptimizationRunDataInvalidError("after_snapshot applied_at is invalid")
    try:
        journal_applied_at = datetime.fromisoformat(
            str(journal["applied_at"]).replace("Z", "+00:00")
        )
    except ValueError as exc:
        raise OptimizationRunDataInvalidError(
            "after_snapshot applied_at is invalid"
        ) from exc
    if (
        journal_applied_at.tzinfo is None
        or journal_applied_at.utcoffset() is None
        or journal_applied_at.astimezone(timezone.utc)
        != _require_aware_timestamp(run.applied_at, field_name="run.applied_at")
    ):
        raise OptimizationRunDataInvalidError("after_snapshot applied_at does not match")

    expected_config_paths = _touched_config_paths(changes)
    expected_link_ids: set[str] = set()
    seen_targets: set[tuple[str, str]] = set()
    for change in changes:
        target = _canonical_target(change, frozen_links)
        if target in seen_targets:
            raise OptimizationRunDataInvalidError("accepted targets are duplicated")
        seen_targets.add(target)
        if target[0].startswith("link:"):
            expected_link_ids.add(target[0][len("link:") :])

    touched_config = _require_mapping(
        journal.get("touched_config"),
        field_name="after_snapshot.touched_config",
    )
    if set(touched_config) != set(expected_config_paths):
        raise OptimizationRunDataInvalidError("touched config targets are invalid")
    normalized_config: dict[str, Any] = {}
    for name in expected_config_paths:
        item = _require_exact_keys(
            touched_config[name],
            {"before", "after"},
            field_name=f"after_snapshot.touched_config.{name}",
        )
        normalized_config[name] = {
            "before": _validated_presence(
                item["before"],
                field_name=f"after_snapshot.touched_config.{name}.before",
            ),
            "after": _validated_presence(
                item["after"],
                field_name=f"after_snapshot.touched_config.{name}.after",
            ),
        }

    touched_links = _require_mapping(
        journal.get("touched_links"),
        field_name="after_snapshot.touched_links",
    )
    if set(touched_links) != expected_link_ids:
        raise OptimizationRunDataInvalidError("touched link targets are invalid")
    normalized_links: dict[str, Any] = {}
    frozen_by_link = {str(record.link_id): record for record in frozen_links.values()}
    for link_id in sorted(expected_link_ids):
        item = _require_exact_keys(
            touched_links[link_id],
            {
                "source_version_id",
                "before_overrides_json",
                "after_overrides_json",
                "before_star",
                "after_star",
            },
            field_name=f"after_snapshot.touched_links.{link_id}",
        )
        record = frozen_by_link.get(link_id)
        if record is None or str(item.get("source_version_id")) != str(
            record.source_version_id
        ):
            raise OptimizationRunDataInvalidError("touched link source is invalid")
        before_overrides = item.get("before_overrides_json")
        after_overrides = item.get("after_overrides_json")
        if not isinstance(before_overrides, Mapping) or not isinstance(
            after_overrides,
            Mapping,
        ):
            raise OptimizationRunDataInvalidError("touched link overrides are invalid")
        normalized_links[link_id] = {
            "source_version_id": str(record.source_version_id),
            "before_overrides_json": deepcopy(dict(before_overrides)),
            "after_overrides_json": deepcopy(dict(after_overrides)),
            "before_star": _validated_presence(
                item["before_star"],
                field_name=f"after_snapshot.touched_links.{link_id}.before_star",
            ),
            "after_star": _validated_presence(
                item["after_star"],
                field_name=f"after_snapshot.touched_links.{link_id}.after_star",
            ),
        }

    protected = _require_mapping(
        journal.get("protected_content"),
        field_name="after_snapshot.protected_content",
    )
    after = _require_mapping(journal.get("after"), field_name="after_snapshot.after")
    if deepcopy(dict(after)) != deepcopy(dict(protected)):
        raise OptimizationRunDataInvalidError("after/protected content disagree")
    if hash_canonical_json(protected) != run.applied_content_signature:
        raise OptimizationRunDataInvalidError("protected content signature is invalid")
    if set(protected) != {
        "title",
        "target_role",
        "resume_config",
        "selected_links",
    }:
        raise OptimizationRunDataInvalidError("protected content shape is invalid")
    protected_config = _require_mapping(
        protected.get("resume_config"),
        field_name="after_snapshot.protected_content.resume_config",
    )
    protected_links = _require_mapping(
        protected.get("selected_links"),
        field_name="after_snapshot.protected_content.selected_links",
    )
    if set(protected_links) != {
        str(record.link_id) for record in frozen_links.values()
    }:
        raise OptimizationRunDataInvalidError("protected selected links are invalid")
    for link_id, record in frozen_by_link.items():
        protected_link = _require_exact_keys(
            protected_links[link_id],
            {"source_version_id", "display_order", "overrides_json"},
            field_name=f"after_snapshot.protected_content.selected_links.{link_id}",
        )
        if (
            str(protected_link.get("source_version_id"))
            != str(record.source_version_id)
            or isinstance(protected_link.get("display_order"), bool)
            or not isinstance(protected_link.get("display_order"), int)
            or not isinstance(protected_link.get("overrides_json"), Mapping)
        ):
            raise OptimizationRunDataInvalidError("protected selected link is invalid")

    for name, path in expected_config_paths.items():
        if normalized_config[name]["after"] != _value_presence(protected_config, path):
            raise OptimizationRunDataInvalidError(
                "touched config after value disagrees with protected content"
            )
    if "selection" in normalized_config:
        parent_before = normalized_config["selection"]["before"]
        parent_after = normalized_config["selection"]["after"]
        expected_before_leaf = (
            _value_presence(parent_before["value"], ("skillIds",))
            if parent_before["present"] and isinstance(parent_before["value"], Mapping)
            else {"present": False, "value": None}
        )
        expected_after_leaf = (
            _value_presence(parent_after["value"], ("skillIds",))
            if parent_after["present"] and isinstance(parent_after["value"], Mapping)
            else {"present": False, "value": None}
        )
        if (
            normalized_config.get("selection.skillIds", {}).get("before")
            != expected_before_leaf
            or normalized_config.get("selection.skillIds", {}).get("after")
            != expected_after_leaf
        ):
            raise OptimizationRunDataInvalidError(
                "selection parent and leaf journal entries disagree"
            )
    for link_id, item in normalized_links.items():
        protected_overrides = protected_links[link_id]["overrides_json"]
        if item["after_overrides_json"] != deepcopy(dict(protected_overrides)):
            raise OptimizationRunDataInvalidError(
                "touched link after overrides disagree with protected content"
            )
        if item["before_star"] != _value_presence(
            item["before_overrides_json"],
            ("star",),
        ) or item["after_star"] != _value_presence(
            item["after_overrides_json"],
            ("star",),
        ):
            raise OptimizationRunDataInvalidError(
                "touched link STAR presence disagrees with raw overrides"
            )

    before = _require_exact_keys(
        journal.get("before"),
        {"touched_config", "touched_links"},
        field_name="after_snapshot.before",
    )
    rollback_signature = journal.get("rollback_before_signature")
    if (
        not isinstance(rollback_signature, str)
        or not re.fullmatch(r"[0-9a-f]{64}", rollback_signature)
        or rollback_signature
        != _rollback_before_signature(
            run_id=run.id,
            resume_id=run.resume_id,
            source_snapshot_hash=run.source_snapshot_hash,
            applied_change_ids=list(run.accepted_change_ids),
            before=before,
        )
    ):
        raise OptimizationRunDataInvalidError(
            "rollback-before journal signature is invalid"
        )
    before_config = _require_mapping(
        before.get("touched_config"),
        field_name="after_snapshot.before.touched_config",
    )
    if set(before_config) != set(normalized_config):
        raise OptimizationRunDataInvalidError("duplicated before config targets disagree")
    for name, item in normalized_config.items():
        if deepcopy(before_config[name]) != item["before"]:
            raise OptimizationRunDataInvalidError("duplicated before config data disagree")
    before_links = _require_mapping(
        before.get("touched_links"),
        field_name="after_snapshot.before.touched_links",
    )
    if set(before_links) != set(normalized_links):
        raise OptimizationRunDataInvalidError("duplicated before link targets disagree")
    for link_id, item in normalized_links.items():
        duplicate = _require_exact_keys(
            before_links[link_id],
            {"source_version_id", "overrides_json", "star"},
            field_name=f"after_snapshot.before.touched_links.{link_id}",
        )
        if (
            duplicate.get("source_version_id") != item["source_version_id"]
            or deepcopy(duplicate.get("overrides_json"))
            != item["before_overrides_json"]
            or deepcopy(duplicate.get("star")) != item["before_star"]
        ):
            raise OptimizationRunDataInvalidError("duplicated before link data disagree")

    try:
        frozen_snapshot = _validated_snapshot(run)
    except OptimizationApplyStaleError as exc:
        raise OptimizationRunDataInvalidError() from exc
    frozen_resume = _snapshot_object(
        frozen_snapshot.get("current_resume"),
        field_name="frozen current resume",
    )
    star_changes_by_link: dict[str, dict[str, OptimizationChange]] = {}
    for change in changes:
        if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
            raw_before = normalized_config["personalSummary"]["before"]
            frozen_summary = frozen_resume.get("personal_summary")
            raw_after = normalized_config["personalSummary"]["after"]
            if change.before_value != frozen_summary or (
                raw_before["present"]
                and raw_before["value"] is not None
                and raw_before["value"] != frozen_summary
            ):
                raise OptimizationRunDataInvalidError(
                    "summary rollback value is not frozen-source-backed"
                )
            if not raw_after["present"] or not isinstance(raw_after["value"], str):
                raise OptimizationRunDataInvalidError(
                    "summary applied value is invalid"
                )
            if raw_after["value"] != change.targeted_value:
                raise OptimizationRunDataInvalidError(
                    "summary applied value disagrees with the persisted plan"
                )
        elif change.module_type == OptimizationModuleType.SECTION_ORDER:
            raw_before = normalized_config["layout.sectionOrder"]["before"]
            raw_after = normalized_config["layout.sectionOrder"]["after"]
            if (
                raw_before != {"present": True, "value": change.before_value}
                or raw_before["value"] != frozen_resume.get("section_order")
            ):
                raise OptimizationRunDataInvalidError(
                    "section-order rollback value is not frozen-source-backed"
                )
            try:
                after_order = _string_order(
                    raw_after["value"] if raw_after["present"] else None,
                    field_name="journal layout.sectionOrder",
                )
            except OptimizationApplyValidationError as exc:
                raise OptimizationRunDataInvalidError(
                    "section-order applied value is invalid"
                ) from exc
            if len(after_order) != len(raw_before["value"]) or set(
                after_order
            ) != set(raw_before["value"]):
                raise OptimizationRunDataInvalidError(
                    "section-order applied membership is invalid"
                )
            if after_order != change.targeted_value:
                raise OptimizationRunDataInvalidError(
                    "section-order applied value disagrees with the persisted plan"
                )
        elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
            parent_before = normalized_config["selection"]["before"]
            parent_after = normalized_config["selection"]["after"]
            leaf_before = normalized_config["selection.skillIds"]["before"]
            leaf_after = normalized_config["selection.skillIds"]["after"]
            if parent_before["present"] and isinstance(
                parent_before["value"],
                Mapping,
            ):
                if not parent_after["present"] or not isinstance(
                    parent_after["value"],
                    Mapping,
                ):
                    raise OptimizationRunDataInvalidError(
                        "selection rollback parent is invalid"
                    )
                before_siblings = {
                    key: deepcopy(value)
                    for key, value in parent_before["value"].items()
                    if key != "skillIds"
                }
                after_siblings = {
                    key: deepcopy(value)
                    for key, value in parent_after["value"].items()
                    if key != "skillIds"
                }
                if before_siblings != after_siblings:
                    raise OptimizationRunDataInvalidError(
                        "selection rollback siblings changed during apply"
                    )
            elif parent_before not in (
                {"present": False, "value": None},
                {"present": True, "value": None},
            ):
                raise OptimizationRunDataInvalidError(
                    "selection rollback parent is invalid"
                )
            elif (
                not parent_after["present"]
                or not isinstance(parent_after["value"], Mapping)
                or set(parent_after["value"]) != {"skillIds"}
            ):
                raise OptimizationRunDataInvalidError(
                    "selection applied parent is invalid"
                )
            if leaf_before["present"] and leaf_before["value"] is not None:
                before_order = _string_order(
                    leaf_before["value"],
                    field_name="rollback selection.skillIds",
                )
                frozen_skill_ids = [
                    str(item.get("id"))
                    for item in frozen_resume.get("skills", [])
                    if isinstance(item, Mapping)
                ]
                if (
                    len(before_order) != len(frozen_skill_ids)
                    or set(before_order) != set(frozen_skill_ids)
                ):
                    raise OptimizationRunDataInvalidError(
                        "selection rollback membership is not frozen-source-backed"
                    )
            else:
                before_order = [
                    str(item.get("id"))
                    for item in frozen_resume.get("skills", [])
                    if isinstance(item, Mapping)
                ]
            if change.before_value != before_order:
                raise OptimizationRunDataInvalidError(
                    "selection rollback value disagrees with the persisted plan"
                )
            try:
                after_order = _string_order(
                    leaf_after["value"] if leaf_after["present"] else None,
                    field_name="journal selection.skillIds",
                )
            except OptimizationApplyValidationError as exc:
                raise OptimizationRunDataInvalidError(
                    "selection applied value is invalid"
                ) from exc
            if len(after_order) != len(before_order) or set(after_order) != set(
                before_order
            ):
                raise OptimizationRunDataInvalidError(
                    "selection applied membership is invalid"
                )
            if after_order != change.targeted_value:
                raise OptimizationRunDataInvalidError(
                    "selection applied value disagrees with the persisted plan"
                )
        elif change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
            record = frozen_links[change.module_id]
            touched = normalized_links[str(record.link_id)]
            before_star = touched["before_star"]
            frozen_star = _frozen_effective_star(
                frozen_snapshot,
                change.module_id,
            )
            field_name = change.field_path[-1]
            if change.before_value != frozen_star[field_name]:
                raise OptimizationRunDataInvalidError(
                    "STAR rollback value disagrees with the frozen source"
                )
            star_changes_by_link.setdefault(str(record.link_id), {})[
                field_name
            ] = change
            if before_star["present"]:
                if not isinstance(before_star["value"], Mapping):
                    raise OptimizationRunDataInvalidError(
                        "STAR rollback value is invalid"
                    )
                for key in ("s", "t", "a", "r"):
                    if key in before_star["value"] and (
                        before_star["value"][key] != frozen_star[key]
                    ):
                        raise OptimizationRunDataInvalidError(
                            "STAR rollback value is not frozen-source-backed"
                        )

    master_id_by_link = {
        str(record.link_id): master_id for master_id, record in frozen_links.items()
    }
    for link_id, touched in normalized_links.items():
        before_overrides = touched["before_overrides_json"]
        after_overrides = touched["after_overrides_json"]
        before_siblings = {
            key: deepcopy(value)
            for key, value in before_overrides.items()
            if key != "star"
        }
        after_siblings = {
            key: deepcopy(value)
            for key, value in after_overrides.items()
            if key != "star"
        }
        if before_siblings != after_siblings:
            raise OptimizationRunDataInvalidError(
                "non-STAR link overrides changed during apply"
            )

        raw_before_star = before_overrides.get("star", {})
        if not isinstance(raw_before_star, Mapping):
            raise OptimizationRunDataInvalidError(
                "rollback STAR override is invalid"
            )
        after_star = touched["after_star"]
        if not after_star["present"] or not isinstance(after_star["value"], Mapping):
            raise OptimizationRunDataInvalidError("applied STAR override is invalid")
        frozen_star = _frozen_effective_star(
            frozen_snapshot,
            master_id_by_link[link_id],
        )
        effective_before_star = _deep_merge(frozen_star, raw_before_star)
        materialized_star = deepcopy(dict(after_star["value"]))
        if set(materialized_star) != set(effective_before_star):
            raise OptimizationRunDataInvalidError(
                "applied STAR shape disagrees with the frozen source"
            )
        changed_fields = star_changes_by_link.get(link_id, {})
        for field_name, before_value in effective_before_star.items():
            after_value = materialized_star[field_name]
            if field_name in changed_fields:
                if not isinstance(after_value, str):
                    raise OptimizationRunDataInvalidError(
                        "applied STAR target must be text"
                    )
                targeted_value = changed_fields[field_name].targeted_value
                target_matches = (
                    isinstance(targeted_value, str)
                    and (
                        _action_materialization_key(after_value)
                        == _action_materialization_key(targeted_value)
                        if field_name == "a"
                        else after_value == targeted_value
                    )
                )
                if not target_matches:
                    raise OptimizationRunDataInvalidError(
                        "applied STAR value disagrees with the persisted plan"
                    )
            elif after_value != before_value:
                raise OptimizationRunDataInvalidError(
                    "non-target STAR content changed during apply"
                )

    return {
        "protected_content": deepcopy(dict(protected)),
        "touched_config": normalized_config,
        "touched_links": normalized_links,
    }


def _rescore_claim_is_active(
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
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return False
    return parsed.astimezone(timezone.utc) + timedelta(
        seconds=ttl_seconds
    ) > now.astimezone(timezone.utc)


async def _require_applied_content_current_locked(
    *,
    session: AsyncSession,
    user_id: str,
    run: ResumeOptimizationRun,
    resume: Resume,
) -> None:
    analysis = (
        resume.config.get("jdAnalysis")
        if isinstance(resume.config, Mapping)
        else None
    )
    if (
        not isinstance(analysis, Mapping)
        or analysis.get("jdInputSignature") != run.source_jd_signature
    ):
        raise OptimizationContentConflictError()
    _, frozen_links, changes = _validate_applied_identity(run)
    journal = _validated_apply_journal(
        run,
        frozen_links=frozen_links,
        changes=changes,
    )
    links = await _lock_current_selected_resume_links(
        session,
        user_id=user_id,
        resume=resume,
        frozen_records=frozen_links,
        applied_config=journal["protected_content"]["resume_config"],
    )
    current_projection = build_applied_content_projection(
        resume=resume,
        selected_links=links,
    )
    if (
        current_projection != journal["protected_content"]
        or hash_canonical_json(current_projection) != run.applied_content_signature
    ):
        raise OptimizationContentConflictError()


async def is_applied_run_resumable(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
) -> AppliedRunResumabilityCheck:
    """Return the locked run and whether its applied content remains current."""

    run = await _lock_run(session, user_id=user_id, run_id=run_id)
    if run.status != ResumeOptimizationStatus.APPLIED.value:
        return AppliedRunResumabilityCheck(run=run, is_resumable=False)
    resume = await _lock_resume(session, user_id=user_id, run=run)
    try:
        await _require_applied_content_current_locked(
            session=session,
            user_id=user_id,
            run=run,
            resume=resume,
        )
    except OptimizationContentConflictError:
        return AppliedRunResumabilityCheck(run=run, is_resumable=False)
    return AppliedRunResumabilityCheck(run=run, is_resumable=True)


async def claim_resume_optimization_rescore(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationRescoreClaimRequest,
    claim_ttl_seconds: int = _DEFAULT_RESCORE_CLAIM_TTL_SECONDS,
) -> ResumeOptimizationRun:
    """Atomically reserve one run's paid post-apply evaluation."""

    if (
        isinstance(claim_ttl_seconds, bool)
        or not isinstance(claim_ttl_seconds, int)
        or claim_ttl_seconds <= 0
    ):
        raise ValueError("claim_ttl_seconds must be a positive integer")
    expected = _require_aware_timestamp(
        payload.expected_resume_updated_at,
        field_name="expected_resume_updated_at",
    )
    try:
        run = await _lock_run(session, user_id=user_id, run_id=run_id)
        resume = await _lock_resume(session, user_id=user_id, run=run)
        if run.status == ResumeOptimizationStatus.COMPLETED.value:
            await session.commit()
            return run
        if run.status != ResumeOptimizationStatus.APPLIED.value:
            raise OptimizationApplyConflictError()
        if _normalize_current_timestamp(resume.updated_at) != expected:
            raise OptimizationContentConflictError()
        await _require_applied_content_current_locked(
            session=session,
            user_id=user_id,
            run=run,
            resume=resume,
        )

        now = utc_now_aware()
        error_json = deepcopy(run.error_json) if isinstance(run.error_json, dict) else {}
        active_claim = error_json.get(_ACTIVE_RESCORE_CLAIM_KEY)
        claim_is_active = _rescore_claim_is_active(
            active_claim,
            now=now,
            ttl_seconds=claim_ttl_seconds,
        )
        if (
            claim_is_active
            and isinstance(active_claim, Mapping)
            and active_claim.get("claimId") == payload.claim_id
        ):
            error_json[_ACTIVE_RESCORE_CLAIM_KEY] = {
                "claimId": payload.claim_id,
                "claimedAt": now.isoformat(),
            }
            run.error_json = error_json
            run.updated_at = _timestamp_like(run.updated_at, now)
            session.add(run)
            await session.flush()
            await session.commit()
            return run
        if claim_is_active:
            raise OptimizationRescoreInProgressError()

        error_json[_ACTIVE_RESCORE_CLAIM_KEY] = {
            "claimId": payload.claim_id,
            "claimedAt": now.isoformat(),
        }
        run.error_json = error_json
        run.updated_at = _timestamp_like(run.updated_at, now)
        session.add(run)
        await session.flush()
        await session.commit()
        return run
    except BaseException:
        try:
            await session.rollback()
        except Exception:
            pass
        raise


async def finalize_run_from_persisted_evaluation(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationFinalizeRequest,
) -> ResumeOptimizationRun:
    expected = _require_aware_timestamp(
        payload.expected_resume_updated_at,
        field_name="expected_resume_updated_at",
    )
    original_status: str | None = None
    try:
        run = await _lock_run(session, user_id=user_id, run_id=run_id)
        resume = await _lock_resume(session, user_id=user_id, run=run)
        original_status = run.status
        current_timestamp = _normalize_current_timestamp(resume.updated_at)
        if current_timestamp != expected:
            raise OptimizationContentConflictError()
        if run.status == ResumeOptimizationStatus.COMPLETED.value:
            try:
                completed_summary = ResumeOptimizationPostEvaluation.model_validate(
                    run.post_evaluation_json
                )
            except (TypeError, ValidationError, ValueError) as exc:
                raise OptimizationRunDataInvalidError() from exc
            if _normalize_current_timestamp(
                completed_summary.resumeUpdatedAt
            ) != expected:
                raise OptimizationContentConflictError()
            await session.commit()
            return run
        if run.status != ResumeOptimizationStatus.APPLIED.value:
            raise OptimizationApplyConflictError()

        active_claim = (
            run.error_json.get(_ACTIVE_RESCORE_CLAIM_KEY)
            if isinstance(run.error_json, Mapping)
            else None
        )
        if (
            not isinstance(active_claim, Mapping)
            or active_claim.get("claimId") != payload.claim_id
            or not _rescore_claim_is_active(
                active_claim,
                now=utc_now_aware(),
                ttl_seconds=_DEFAULT_RESCORE_CLAIM_TTL_SECONDS,
            )
        ):
            raise OptimizationRescoreClaimLostError()

        snapshot, frozen_links, changes = _validate_applied_identity(run)
        journal = _validated_apply_journal(
            run,
            frozen_links=frozen_links,
            changes=changes,
        )
        await _require_applied_content_current_locked(
            session=session,
            user_id=user_id,
            run=run,
            resume=resume,
        )

        require_status_transition(
            ResumeOptimizationStatus.APPLIED,
            ResumeOptimizationStatus.RESCORING,
        )
        now = utc_now_aware()
        run.status = ResumeOptimizationStatus.RESCORING.value
        run.updated_at = _timestamp_like(run.updated_at, now)
        session.add(run)
        await session.flush()

        try:
            config = resume.config
            analysis = config.get("jdAnalysis") if isinstance(config, Mapping) else None
            result = analysis.get("result") if isinstance(analysis, Mapping) else None
            raw_after = (
                result.get("resumeEvaluation") if isinstance(result, Mapping) else None
            )
            if (
                not isinstance(analysis, Mapping)
                or analysis.get("evaluationIsOutdated") is not False
                or analysis.get("jdInputSignature") != run.source_jd_signature
                or not isinstance(raw_after, Mapping)
            ):
                raise _PersistedEvaluationPending()

            current_snapshot, expected_signature = (
                _validated_post_frontend_evaluation_context(
                    run=run,
                    changes=changes,
                    persisted_signature=analysis.get("evaluationSignature"),
                    applied_config=journal["protected_content"]["resume_config"],
                    persisted_evaluation=raw_after,
                    persisted_jd_result=result,
                )
            )
            if (
                not isinstance(current_snapshot, Mapping)
                or analysis.get("evaluationSignature") != expected_signature
            ):
                raise _PersistedEvaluationPending()
            raw_before = snapshot.get("evaluation")
            before_jd_available = _raw_evaluation_jd_available(raw_before)
            after_jd_available = _raw_evaluation_jd_available(raw_after)
            if before_jd_available != after_jd_available:
                raise _PersistedEvaluationPending()
            before = _normalized_evaluation(
                raw_before,
                jd_available=before_jd_available,
                fact_metadata=_source_frontend_evaluation_snapshot(
                    run,
                    allow_legacy=True,
                ).get(
                    "fact_metadata"
                ),
            )
            after = _normalized_evaluation(
                raw_after,
                jd_available=before_jd_available,
                fact_metadata=current_snapshot.get("fact_metadata"),
            )
            post_evaluation = _post_evaluation_summary(
                run=run,
                resume=resume,
                evaluation_signature=expected_signature,
                before=before,
                after=after,
            )
        except (
            _PersistedEvaluationPending,
            OptimizationApplyValidationError,
            ValidationError,
            TypeError,
            ValueError,
        ):
            require_status_transition(
                ResumeOptimizationStatus.RESCORING,
                ResumeOptimizationStatus.APPLIED,
            )
            run.status = ResumeOptimizationStatus.APPLIED.value
            run.error_json = _safe_finalize_error()
            run.updated_at = _timestamp_like(run.updated_at, utc_now_aware())
            session.add(run)
            await session.flush()
            await session.commit()
            raise OptimizationFinalizePendingError()

        require_status_transition(
            ResumeOptimizationStatus.RESCORING,
            ResumeOptimizationStatus.COMPLETED,
        )
        completed_now = utc_now_aware()
        run.post_evaluation_json = post_evaluation
        run.status = ResumeOptimizationStatus.COMPLETED.value
        run.completed_at = _timestamp_like(run.completed_at or run.updated_at, completed_now)
        run.updated_at = _timestamp_like(run.updated_at, completed_now)
        run.error_json = {}
        session.add(run)
        await session.flush()
        await session.commit()
        return run
    except OptimizationFinalizePendingError:
        raise
    except BaseException:
        if original_status is not None and "run" in locals():
            run.status = original_status
        try:
            await session.rollback()
        except Exception:
            pass
        raise


async def revert_resume_optimization(
    *,
    session: AsyncSession,
    user_id: str,
    run_id: str,
    payload: ResumeOptimizationRevertRequest,
) -> OptimizationRevertResult:
    expected = _require_aware_timestamp(
        payload.expected_resume_updated_at,
        field_name="expected_resume_updated_at",
    )
    try:
        run = await _lock_run(session, user_id=user_id, run_id=run_id)
        resume = await _lock_resume(session, user_id=user_id, run=run)
        active_claim = (
            run.error_json.get(_ACTIVE_RESCORE_CLAIM_KEY)
            if isinstance(run.error_json, Mapping)
            else None
        )
        if _rescore_claim_is_active(
            active_claim,
            now=utc_now_aware(),
            ttl_seconds=_DEFAULT_RESCORE_CLAIM_TTL_SECONDS,
        ) and (
            not isinstance(active_claim, Mapping)
            or payload.claim_id is None
            or active_claim.get("claimId") != payload.claim_id
        ):
            raise OptimizationRescoreInProgressError()
        if run.status not in {
            ResumeOptimizationStatus.APPLIED.value,
            ResumeOptimizationStatus.COMPLETED.value,
        }:
            raise OptimizationApplyConflictError()
        if _normalize_current_timestamp(resume.updated_at) != expected:
            raise OptimizationContentConflictError()

        _, frozen_links, changes = _validate_applied_identity(run)
        journal = _validated_apply_journal(
            run,
            frozen_links=frozen_links,
            changes=changes,
        )
        links = await _lock_current_selected_resume_links(
            session,
            user_id=user_id,
            resume=resume,
            frozen_records=frozen_links,
            applied_config=journal["protected_content"]["resume_config"],
        )
        current_projection = build_applied_content_projection(
            resume=resume,
            selected_links=links,
        )
        if (
            current_projection != journal["protected_content"]
            or hash_canonical_json(current_projection)
            != run.applied_content_signature
        ):
            raise OptimizationContentConflictError()

        current_config = resume.config
        current_analysis = (
            current_config.get("jdAnalysis")
            if isinstance(current_config, Mapping)
            else None
        )
        if not isinstance(current_config, dict) or not isinstance(
            current_analysis,
            Mapping,
        ):
            raise OptimizationContentConflictError()

        next_config = deepcopy(current_config)
        touched_config = journal["touched_config"]
        if "selection" in touched_config:
            _restore_presence(
                next_config,
                ("selection",),
                touched_config["selection"]["before"],
            )
        for name, path in {
            "personalSummary": ("personalSummary",),
            "layout.sectionOrder": ("layout", "sectionOrder"),
        }.items():
            if name in touched_config:
                _restore_presence(
                    next_config,
                    path,
                    touched_config[name]["before"],
                )
        next_config["jdAnalysis"] = deepcopy(dict(current_analysis))

        link_by_id = {str(link.id): link for link in links}
        next_link_overrides: dict[str, dict[str, Any]] = {}
        for link_id, touched in journal["touched_links"].items():
            link = link_by_id.get(link_id)
            if link is None or not isinstance(link.overrides_json, dict):
                raise OptimizationContentConflictError()
            restored = deepcopy(link.overrides_json)
            before_star = touched["before_star"]
            if before_star["present"]:
                restored["star"] = deepcopy(before_star["value"])
            else:
                restored.pop("star", None)
            if restored != touched["before_overrides_json"]:
                raise OptimizationRunDataInvalidError(
                    "Rollback journal does not reconstruct raw link overrides"
                )
            next_link_overrides[link_id] = restored

        stale_config = _mark_resume_analysis_outdated(next_config)
        now = utc_now_aware()
        resume.config = deepcopy(stale_config)
        resume.updated_at = _timestamp_like(resume.updated_at, now)
        session.add(resume)
        for link_id, overrides in next_link_overrides.items():
            link = link_by_id[link_id]
            link.overrides_json = deepcopy(overrides)
            session.add(link)

        require_status_transition(
            ResumeOptimizationStatus(run.status),
            ResumeOptimizationStatus.REVERTED,
        )
        run.status = ResumeOptimizationStatus.REVERTED.value
        run.updated_at = _timestamp_like(run.updated_at, now)
        run.error_json = {}
        session.add(run)
        await session.flush()
        await session.commit()
        return OptimizationRevertResult(
            run=run,
            resume=resume,
            resume_updated_at=resume.updated_at,
        )
    except BaseException:
        try:
            await session.rollback()
        except Exception:
            pass
        raise
