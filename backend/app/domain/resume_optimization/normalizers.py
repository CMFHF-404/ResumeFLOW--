from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from ..ai import runtime_budget
from .schemas import (
    OptimizationAction,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationQuestion,
)


# Model output is never expected to need a single 20k-character scalar. Keep this
# below the shared runtime ceiling while still honoring deployments with a tighter cap.
MAX_MODEL_STRING_CHARS = 20_000

_CHANGE_KEYS = {
    "changeId": "change_id",
    "issueIds": "issue_ids",
    "dimension": "dimension",
    "moduleType": "module_type",
    "moduleId": "module_id",
    "fieldPath": "field_path",
    "actionKind": "action_kind",
    "scope": "scope",
    "beforeValue": "before_value",
    "generalValue": "general_value",
    "targetedValue": "targeted_value",
    "sourceRefs": "source_refs",
    "introducedTerms": "introduced_terms",
    "rationale": "rationale",
    "expectedScoreGain": "expected_score_gain",
    "defaultSelected": "default_selected",
}
_QUESTION_KEYS = {
    "questionId": "question_id",
    "moduleId": "module_id",
    "fieldPath": "field_path",
    "text": "text",
    "reason": "reason",
    "answerType": "answer_type",
    "choices": "choices",
    "affectsChangeIds": "affects_change_ids",
    "priority": "priority",
}
_CHOICE_KEYS = {"value": "value", "label": "label"}
_EXPERIENCE_FIELDS = frozenset({"star.s", "star.t", "star.a", "star.r"})
_EXPERIENCE_QUESTION_FIELDS = _EXPERIENCE_FIELDS | frozenset(
    {"responsibility", "ownership", "method", "result", "scale", "causality"}
)
_PERSONAL_SUMMARY_MODULE_IDS = frozenset(
    {"personal_summary", "current_resume", "resume"}
)
_PERSONAL_SUMMARY_FIELDS = frozenset({"personal_summary", "personalSummary"})
_SKILLS_ORDER_FIELDS = frozenset(
    {"skills.order", "skillsOrder", "selection.skillIds"}
)
_SECTION_ORDER_FIELDS = frozenset({"section_order", "sectionOrder"})
_OTHER_PROJECT_MARKERS = (
    "another project",
    "other project",
    "另一个项目",
    "其他项目",
    "其它项目",
    "别的项目",
)


class OptimizationPlanNormalizationError(ValueError):
    """The entire model plan is rejected when any entry violates the contract."""

    code = "resume_optimization_plan_invalid"


@dataclass(frozen=True)
class _SourceValidationContext:
    source_documents: Mapping[str, Any]
    answer_question_modules: Mapping[str, str]
    answer_states: Mapping[str, str]
    answer_change_ids: Mapping[str, frozenset[str]]
    allow_user_answers: bool = False


def _fail(message: str) -> None:
    raise OptimizationPlanNormalizationError(message)


def _bounded_string_limit() -> int:
    return min(
        MAX_MODEL_STRING_CHARS,
        runtime_budget.get_ai_runtime_budget().max_text_field_chars,
    )


def _reject_oversized_strings(value: Any, *, path: str = "result") -> None:
    limit = _bounded_string_limit()
    if isinstance(value, str):
        if len(value) > limit:
            _fail(f"{path} exceeds the {limit}-character model-output limit")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            _reject_oversized_strings(item, path=f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_oversized_strings(item, path=f"{path}[{index}]")


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _stable_id(prefix: str, value: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest.upper()}"


def _alias_object(
    raw: Any,
    *,
    aliases: Mapping[str, str],
    path: str,
) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        _fail(f"{path} must be an object")
    result: dict[str, Any] = {}
    allowed = set(aliases) | set(aliases.values())
    unknown = set(raw) - allowed
    if unknown:
        _fail(f"{path} contains unsupported fields: {sorted(unknown)}")
    for key, value in raw.items():
        normalized_key = aliases.get(key, key)
        if normalized_key in result:
            _fail(f"{path} repeats field {normalized_key}")
        result[normalized_key] = value
    return result


def _normalize_choices(raw: Any, *, path: str) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        _fail(f"{path} must be an array")
    return [
        _alias_object(item, aliases=_CHOICE_KEYS, path=f"{path}[{index}]")
        for index, item in enumerate(raw)
    ]


def _decode_pointer_token(token: str) -> str:
    if re.search(r"~(?![01])", token):
        _fail("sourceRefs must use valid RFC 6901 escaping")
    return token.replace("~1", "/").replace("~0", "~")


def _pointer_segments(source_ref: str) -> list[str]:
    if not source_ref.startswith("/"):
        _fail("sourceRefs must be absolute RFC 6901 JSON pointers")
    segments = [_decode_pointer_token(token) for token in source_ref[1:].split("/")]
    if not segments or any(not segment for segment in segments):
        _fail("sourceRefs must contain non-empty RFC 6901 segments")
    if segments[0] not in {
        "currentResume",
        "selectedSourceExperiences",
        "userAnswers",
    }:
        _fail("sourceRefs must use an exact allowed frozen-context root")
    return segments


def _resolve_pointer(source_documents: Mapping[str, Any], segments: Sequence[str]) -> Any:
    cursor: Any = source_documents
    for segment in segments:
        if isinstance(cursor, Mapping) and segment in cursor:
            cursor = cursor[segment]
            continue
        if isinstance(cursor, list) and segment.isdigit():
            index = int(segment)
            if index < len(cursor):
                cursor = cursor[index]
                continue
        _fail("sourceRef does not resolve inside the supplied sourceDocuments")
    return cursor


def _validate_source_refs(
    change: OptimizationChange,
    *,
    selected_master_ids: set[str],
    source_context: _SourceValidationContext | None,
) -> None:
    for source_ref in change.source_refs:
        segments = _pointer_segments(source_ref)
        root = segments[0]
        if root == "currentResume":
            if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
                if len(segments) < 4 or segments[1:3] != [
                    "experiences",
                    change.module_id,
                ]:
                    _fail("current-resume experience refs must use the same module ID")
            elif change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
                is_summary = segments[1:] == ["personal_summary"]
                is_selected_experience = (
                    len(segments) >= 4
                    and segments[1] == "experiences"
                    and segments[2] in selected_master_ids
                )
                if not (is_summary or is_selected_experience):
                    _fail("personal-summary refs must use the summary or a selected experience")
            elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
                if segments[1:2] != ["skills"]:
                    _fail("skills-order refs must use currentResume.skills")
            elif change.module_type == OptimizationModuleType.SECTION_ORDER:
                if segments[1:] != ["section_order"]:
                    _fail("section-order refs must use currentResume.section_order")
        elif root == "selectedSourceExperiences":
            if len(segments) < 3 or segments[1] not in selected_master_ids:
                _fail("selected-source refs must name a selected experience")
            if (
                change.module_type == OptimizationModuleType.EXPERIENCE_STAR
                and segments[1] != change.module_id
            ):
                _fail("selected source references must belong to the same experience")
            if change.module_type not in {
                OptimizationModuleType.EXPERIENCE_STAR,
                OptimizationModuleType.PERSONAL_SUMMARY,
            }:
                _fail("order changes cannot use experience text as a source")
        else:
            if source_context is None or not source_context.allow_user_answers:
                _fail("planning sourceRefs must not cite userAnswers")
            if len(segments) != 3 or segments[2] != "value":
                _fail("answer sourceRefs must have shape /userAnswers/{id}/value")
            question_module = source_context.answer_question_modules.get(segments[1])
            if question_module is None:
                _fail("answer sourceRef cites an unsubmitted question")
            if source_context.answer_states.get(segments[1]) != "answered":
                _fail("only an answered response may be cited as rewrite evidence")
            if question_module != change.module_id:
                _fail("answer sourceRef question must target the same module")
            if change.change_id not in source_context.answer_change_ids.get(
                segments[1], frozenset()
            ):
                _fail("answer sourceRef question must be linked to the same change")

        if source_context is not None:
            _resolve_pointer(source_context.source_documents, segments)


def _validate_change_target(
    change: OptimizationChange,
    *,
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_context: _SourceValidationContext | None,
) -> None:
    if change.action_kind == OptimizationAction.SUGGEST_FROM_BANK:
        _fail("the model must never generate bank suggestions")

    is_unsupported_sentinel = (
        change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
        and change.module_id == "current_resume"
        and change.field_path == "unsupported"
    )
    if is_unsupported_sentinel:
        if not (
            change.action_kind == OptimizationAction.LEAVE_UNCHANGED
            and change.before_value is None
            and change.general_value is None
            and change.targeted_value is None
            and not change.source_refs
            and not change.introduced_terms
            and change.expected_score_gain == 0
            and change.default_selected is False
        ):
            _fail("unsupported sentinel must use the exact read-only safe contract")
        return

    if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
        if change.module_id not in selected_master_ids:
            _fail("experience changes must target a selected experience")
        if change.field_path not in _EXPERIENCE_FIELDS:
            _fail("experience changes may target only STAR fields")
    elif change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        if change.module_id not in _PERSONAL_SUMMARY_MODULE_IDS:
            _fail("personal-summary changes must target the current resume")
        if change.field_path not in _PERSONAL_SUMMARY_FIELDS:
            _fail("unsupported personal-summary path")
    elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
        if change.module_id != "skills" or change.field_path not in _SKILLS_ORDER_FIELDS:
            _fail("unsupported skills-order module or path")
        if change.before_value != list(change.before_value):
            _fail("skills-order beforeValue must be an array")
        if set(change.before_value) != selected_skill_ids or len(change.before_value) != len(
            selected_skill_ids
        ):
            _fail("skills-order changes must contain exactly the selected skill IDs")
    elif change.module_type == OptimizationModuleType.SECTION_ORDER:
        if change.module_id != "sections" or change.field_path not in _SECTION_ORDER_FIELDS:
            _fail("unsupported section-order module or path")
        if change.before_value != current_section_order:
            _fail("section-order beforeValue must match the current section order")
    else:
        _fail("unsupported optimization module")

    _validate_source_refs(
        change,
        selected_master_ids=selected_master_ids,
        source_context=source_context,
    )


def _normalize_change(
    raw: Any,
    *,
    index: int,
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_context: _SourceValidationContext | None,
) -> OptimizationChange:
    value = _alias_object(raw, aliases=_CHANGE_KEYS, path=f"changes[{index}]")
    raw_id = value.pop("change_id", None)
    if raw_id is not None and (not isinstance(raw_id, str) or not raw_id.strip()):
        _fail(f"changes[{index}].changeId must be a non-empty string when provided")
    placeholder_id = raw_id or "__SERVER_GENERATED_CHANGE_ID__"
    try:
        change = OptimizationChange(change_id=placeholder_id, **value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationPlanNormalizationError(
            f"changes[{index}] violates the optimization contract"
        ) from exc
    _validate_change_target(
        change,
        selected_master_ids=selected_master_ids,
        selected_skill_ids=selected_skill_ids,
        current_section_order=current_section_order,
        source_context=source_context,
    )
    if raw_id is None:
        generated = _stable_id("CHG", value)
        change = change.model_copy(update={"change_id": generated})
    return change


def _validate_question_target(
    question: OptimizationQuestion,
    *,
    changes_by_id: Mapping[str, OptimizationChange],
    selected_master_ids: set[str],
) -> None:
    if question.module_id in selected_master_ids:
        if question.field_path not in _EXPERIENCE_QUESTION_FIELDS:
            _fail("unsupported selected-experience question path")
    elif question.module_id in _PERSONAL_SUMMARY_MODULE_IDS:
        if question.field_path not in _PERSONAL_SUMMARY_FIELDS:
            _fail("unsupported personal-summary question path")
    else:
        _fail("questions may target only a selected experience or current summary")

    question_text = f"{question.text} {question.reason}".lower()
    if any(marker in question_text for marker in _OTHER_PROJECT_MARKERS):
        _fail("questions must not ask about another project")
    if not question.affects_change_ids:
        _fail("each question must affect at least one ask_user change")
    for change_id in question.affects_change_ids:
        change = changes_by_id.get(change_id)
        if change is None:
            _fail("question references an unknown change ID")
        if change.action_kind != OptimizationAction.ASK_USER:
            _fail("questions may affect only ask_user changes")
        if change.module_id != question.module_id:
            _fail("question and affected change must target the same module")


def _normalize_question(
    raw: Any,
    *,
    index: int,
    changes_by_id: Mapping[str, OptimizationChange],
    selected_master_ids: set[str],
) -> OptimizationQuestion:
    value = _alias_object(raw, aliases=_QUESTION_KEYS, path=f"questions[{index}]")
    value["choices"] = _normalize_choices(
        value.get("choices"), path=f"questions[{index}].choices"
    )
    raw_id = value.pop("question_id", None)
    if raw_id is not None and (not isinstance(raw_id, str) or not raw_id.strip()):
        _fail(f"questions[{index}].questionId must be non-empty when provided")
    placeholder_id = raw_id or "__SERVER_GENERATED_QUESTION_ID__"
    try:
        question = OptimizationQuestion(question_id=placeholder_id, **value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationPlanNormalizationError(
            f"questions[{index}] violates the optimization contract"
        ) from exc
    if not question.text.strip() or not question.reason.strip():
        _fail("question text and reason must not be empty")
    _validate_question_target(
        question,
        changes_by_id=changes_by_id,
        selected_master_ids=selected_master_ids,
    )
    if raw_id is None:
        question = question.model_copy(
            update={"question_id": _stable_id("Q", value)}
        )
    return question


def _validate_issue_coverage(
    changes: Sequence[OptimizationChange],
    *,
    known_issue_ids: set[str],
) -> None:
    covered: set[str] = set()
    for change in changes:
        if not change.issue_ids:
            _fail("every change must reference at least one issue ID")
        if len(set(change.issue_ids)) != len(change.issue_ids):
            _fail("a change must not repeat issue IDs")
        for issue_id in change.issue_ids:
            if issue_id not in known_issue_ids:
                _fail("a change references an unknown issue ID")
            if issue_id in covered:
                _fail("each issue ID must be routed exactly once")
            covered.add(issue_id)
    if covered != known_issue_ids:
        _fail("the plan must route every known issue ID exactly once")


def normalize_optimization_plan(
    raw: Any,
    *,
    known_issue_ids: set[str],
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    _source_context: _SourceValidationContext | None = None,
) -> OptimizationPlan:
    """Normalize a model plan using whole-plan, fail-closed rejection.

    Unsafe entries are never dropped or converted to rewrites: one invalid entry
    rejects the complete model result so callers can retry or fail explicitly.
    """

    if not isinstance(raw, Mapping):
        _fail("optimization plan root must be an object")
    _reject_oversized_strings(raw)
    allowed_root_keys = {
        "changes",
        "questions",
        "bankSuggestions",
        "bank_suggestions",
    }
    unknown_root_keys = set(raw) - allowed_root_keys
    if unknown_root_keys:
        _fail(f"optimization plan contains unsupported fields: {sorted(unknown_root_keys)}")
    raw_changes = raw.get("changes", [])
    raw_questions = raw.get("questions", [])
    if not isinstance(raw_changes, list) or not isinstance(raw_questions, list):
        _fail("changes and questions must be arrays")
    if len(raw_questions) > 5:
        _fail("optimization plan may contain at most five questions")
    if "bankSuggestions" in raw and "bank_suggestions" in raw:
        _fail("bank suggestion root aliases must not both be present")
    bank_suggestions = raw.get("bankSuggestions", raw.get("bank_suggestions", []))
    if bank_suggestions not in (None, []):
        _fail("the model must never generate bank suggestions")

    changes = [
        _normalize_change(
            item,
            index=index,
            selected_master_ids=selected_master_ids,
            selected_skill_ids=selected_skill_ids,
            current_section_order=current_section_order,
            source_context=_source_context,
        )
        for index, item in enumerate(raw_changes)
    ]
    change_ids = [change.change_id for change in changes]
    if len(set(change_ids)) != len(change_ids):
        _fail("change IDs must be unique, including server-generated IDs")
    _validate_issue_coverage(changes, known_issue_ids=known_issue_ids)

    changes_by_id = {change.change_id: change for change in changes}
    questions = [
        _normalize_question(
            item,
            index=index,
            changes_by_id=changes_by_id,
            selected_master_ids=selected_master_ids,
        )
        for index, item in enumerate(raw_questions)
    ]
    question_ids = [question.question_id for question in questions]
    if len(set(question_ids)) != len(question_ids):
        _fail("question IDs must be unique, including server-generated IDs")

    affected_ask_change_ids = {
        change_id
        for question in questions
        for change_id in question.affects_change_ids
    }
    required_ask_change_ids = {
        change.change_id
        for change in changes
        if change.action_kind == OptimizationAction.ASK_USER
    }
    if affected_ask_change_ids != required_ask_change_ids:
        _fail("every ask_user change must be covered by a question")

    return OptimizationPlan(changes=changes, questions=questions)


def normalize_answered_optimization_changes(
    raw: Any,
    *,
    expected_changes: Sequence[OptimizationChange],
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_documents: Mapping[str, Any],
    answer_question_modules: Mapping[str, str],
    answer_states: Mapping[str, str],
    answer_change_ids: Mapping[str, frozenset[str]],
) -> list[OptimizationChange]:
    if not isinstance(raw, Mapping) or set(raw) != {"changes"}:
        _fail("answer rewrite must return only a changes object")
    expected_by_id = {change.change_id: change for change in expected_changes}
    known_issue_ids = {
        issue_id for change in expected_changes for issue_id in change.issue_ids
    }
    plan = normalize_optimization_plan(
        {"changes": raw["changes"], "questions": []},
        known_issue_ids=known_issue_ids,
        selected_master_ids=selected_master_ids,
        selected_skill_ids=selected_skill_ids,
        current_section_order=current_section_order,
        _source_context=_SourceValidationContext(
            source_documents=source_documents,
            answer_question_modules=answer_question_modules,
            answer_states=answer_states,
            answer_change_ids=answer_change_ids,
            allow_user_answers=True,
        ),
    )
    if set(change.change_id for change in plan.changes) != set(expected_by_id):
        _fail("answer rewrite changed the affected change-ID set")
    for change in plan.changes:
        expected = expected_by_id[change.change_id]
        if (
            change.module_type != expected.module_type
            or change.module_id != expected.module_id
            or change.field_path != expected.field_path
            or change.issue_ids != expected.issue_ids
            or change.before_value != expected.before_value
            or change.dimension != expected.dimension
            or change.scope != expected.scope
            or change.default_selected != expected.default_selected
        ):
            _fail("answer rewrite changed an affected change identity or source value")
        submitted_for_change = {
            question_id
            for question_id, change_ids in answer_change_ids.items()
            if change.change_id in change_ids
        }
        answered_for_change = {
            question_id
            for question_id in submitted_for_change
            if answer_states.get(question_id) == "answered"
        }
        cited_answer_ids = {
            segments[1]
            for source_ref in change.source_refs
            if (segments := _pointer_segments(source_ref))[0] == "userAnswers"
        }
        if change.action_kind == OptimizationAction.REWRITE_NOW and not (
            cited_answer_ids & answered_for_change
        ):
            _fail(
                "rewrite_now requires a linked submitted answered userAnswers sourceRef"
            )
        if not answered_for_change:
            if change.action_kind != OptimizationAction.LEAVE_UNCHANGED:
                _fail("non-answered responses may only produce leave_unchanged")
            for candidate in (change.general_value, change.targeted_value):
                if candidate is not None and candidate != change.before_value:
                    _fail("leave_unchanged must not introduce a new candidate value")
    return plan.changes
