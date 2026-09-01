from __future__ import annotations

import json
from typing import Any, Mapping, Sequence

from ..ai import runtime_budget
from ..ai.llm_transport import _call_llm
from .context_service import FrozenOptimizationContext
from .normalizers import (
    OptimizationPlanNormalizationError,
    _SourceValidationContext,
    normalize_answered_optimization_changes,
    normalize_optimization_plan,
)
from .prompts import ANSWER_REWRITE_SYSTEM_PROMPT, OPTIMIZATION_SYSTEM_PROMPT
from .schemas import (
    OptimizationAnswer,
    OptimizationChange,
    OptimizationPlan,
)


_ALLOWED_SOURCE_ROOTS = (
    "/currentResume",
    "/selectedSourceExperiences",
    "/userAnswers",
)
_DIRECT_IDENTIFIER_KEYS = frozenset(
    {"name", "email", "phone", "linkedin", "location"}
)


def _known_issue_ids(evaluation: Mapping[str, Any]) -> set[str]:
    raw_issues = evaluation.get("issues")
    if not isinstance(raw_issues, list):
        raise OptimizationPlanNormalizationError(
            "six-dimensional evaluation issues must be an array"
        )
    issue_ids: list[str] = []
    for item in raw_issues:
        if not isinstance(item, Mapping):
            raise OptimizationPlanNormalizationError(
                "six-dimensional evaluation issue must be an object"
            )
        issue_id = item.get("issueId")
        if not isinstance(issue_id, str) or not issue_id.strip():
            raise OptimizationPlanNormalizationError(
                "six-dimensional evaluation issueId must be non-empty"
            )
        issue_ids.append(issue_id)
    if len(set(issue_ids)) != len(issue_ids):
        raise OptimizationPlanNormalizationError(
            "six-dimensional evaluation issue IDs must be unique"
        )
    return set(issue_ids)


def _selected_skill_ids(context: FrozenOptimizationContext) -> set[str]:
    raw_skills = context.current_resume.get("skills")
    if not isinstance(raw_skills, list):
        return set()
    result: set[str] = set()
    for item in raw_skills:
        if not isinstance(item, Mapping):
            continue
        skill_id = item.get("id")
        if isinstance(skill_id, str) and skill_id.strip():
            result.add(skill_id)
    return result


def _current_section_order(context: FrozenOptimizationContext) -> list[str]:
    raw_order = context.current_resume.get("section_order")
    if not isinstance(raw_order, list):
        return []
    return [item for item in raw_order if isinstance(item, str) and item.strip()]


def _bounded_json_content(payload: Mapping[str, Any]) -> str:
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    budget = runtime_budget.get_ai_runtime_budget()
    if len(content.encode("utf-8")) > budget.max_request_body_bytes:
        raise runtime_budget.AiRuntimeBudgetExceeded(
            runtime_budget.AiRuntimeBudgetExceeded.public_message
        )
    return content


def _minimized_planner_model_payload(
    context: FrozenOptimizationContext,
) -> dict[str, Any]:
    """Remove direct identifiers while retaining current-resume truth sources."""

    payload = context.model_payload()
    current_resume = payload.get("currentResume")
    if isinstance(current_resume, dict):
        current_resume.pop("profile", None)
        for key in _DIRECT_IDENTIFIER_KEYS:
            current_resume.pop(key, None)

    raw_facts = payload.get("factMetadata")
    if isinstance(raw_facts, list):
        filtered_facts: list[Any] = []
        for fact in raw_facts:
            if not isinstance(fact, Mapping):
                continue
            source = fact.get("source")
            if isinstance(source, str):
                tokens = source.split("/")[1:] if source.startswith("/") else []
                is_profile_fact = (
                    len(tokens) >= 2
                    and tokens[0] == "currentResume"
                    and tokens[1] == "profile"
                )
                is_direct_fact = (
                    len(tokens) == 2
                    and tokens[0] == "currentResume"
                    and tokens[1] in _DIRECT_IDENTIFIER_KEYS
                )
                if is_profile_fact or is_direct_fact:
                    continue
            filtered_facts.append(fact)
        payload["factMetadata"] = filtered_facts
    return payload


def _messages(*, system_prompt: str, payload: Mapping[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": _bounded_json_content(payload)},
    ]


@runtime_budget.ai_wall_clock_limited
async def plan_resume_optimization(
    context: FrozenOptimizationContext,
) -> OptimizationPlan:
    model_payload = _minimized_planner_model_payload(context)
    raw = await _call_llm(
        _messages(
            system_prompt=OPTIMIZATION_SYSTEM_PROMPT,
            payload={
                "context": model_payload,
                "allowedSourceRoots": list(_ALLOWED_SOURCE_ROOTS),
                "sourceGuidance": (
                    "Use only JSON pointers under the listed roots. A selected "
                    "source experience may support only that same experience."
                ),
            },
        ),
        json_mode=True,
        request_label="resume_optimization_plan",
    )
    return normalize_optimization_plan(
        raw,
        known_issue_ids=_known_issue_ids(context.evaluation),
        selected_master_ids=set(context.selected_master_experience_ids),
        selected_skill_ids=_selected_skill_ids(context),
        current_section_order=_current_section_order(context),
        _source_context=_SourceValidationContext(
            source_documents=context.source_documents,
            answer_question_modules={},
            answer_states={},
            answer_change_ids={},
        ),
    )


def _unique_answers_by_question(
    answers: Sequence[OptimizationAnswer],
) -> dict[str, OptimizationAnswer]:
    result: dict[str, OptimizationAnswer] = {}
    for answer in answers:
        if answer.question_id in result:
            raise OptimizationPlanNormalizationError(
                "submitted answers must have unique question IDs"
            )
        result[answer.question_id] = answer
    return result


def _answer_source_documents(
    context: FrozenOptimizationContext,
    module_ids: set[str],
    answers_by_question: Mapping[str, OptimizationAnswer],
) -> dict[str, Any]:
    current_resume = context.current_resume
    raw_experiences = current_resume.get("experiences")
    experiences = raw_experiences if isinstance(raw_experiences, Mapping) else {}
    selected_sources = context.selected_source_experiences
    current_document: dict[str, Any] = {}
    current_experiences: dict[str, Any] = {}
    selected_document: dict[str, Any] = {}
    for module_id in sorted(module_ids):
        if module_id in experiences:
            current_experiences[module_id] = experiences[module_id]
            selected_source = selected_sources.get(module_id)
            if selected_source is not None:
                selected_document[module_id] = selected_source
        elif module_id in {"personal_summary", "current_resume", "resume"}:
            current_document["personal_summary"] = current_resume.get(
                "personal_summary", ""
            )
        elif module_id == "skills":
            current_document["skills"] = current_resume.get("skills", [])
        elif module_id == "sections":
            current_document["section_order"] = current_resume.get(
                "section_order", []
            )
    if current_experiences:
        current_document["experiences"] = current_experiences
    return {
        "currentResume": current_document,
        "selectedSourceExperiences": selected_document,
        "userAnswers": {
            question_id: {
                "state": answer.state.value,
                "value": answer.value,
            }
            for question_id, answer in answers_by_question.items()
        },
    }


@runtime_budget.ai_wall_clock_limited
async def rewrite_answered_modules(
    *,
    context: FrozenOptimizationContext,
    existing_plan: OptimizationPlan,
    answers: list[OptimizationAnswer],
) -> list[OptimizationChange]:
    answers_by_question = _unique_answers_by_question(answers)
    questions_by_id = {
        question.question_id: question for question in existing_plan.questions
    }
    unknown_question_ids = set(answers_by_question) - set(questions_by_id)
    if unknown_question_ids:
        raise OptimizationPlanNormalizationError(
            "submitted answer references an unknown question ID"
        )

    affected_change_ids = {
        change_id
        for question_id in answers_by_question
        for change_id in questions_by_id[question_id].affects_change_ids
    }
    if not affected_change_ids:
        return []
    changes_by_id = {
        change.change_id: change for change in existing_plan.changes
    }
    if not affected_change_ids <= set(changes_by_id):
        raise OptimizationPlanNormalizationError(
            "question references a change absent from the existing plan"
        )
    affected_changes = [
        change
        for change in existing_plan.changes
        if change.change_id in affected_change_ids
    ]
    affected_module_ids = {change.module_id for change in affected_changes}
    answer_question_modules = {
        question_id: questions_by_id[question_id].module_id
        for question_id in answers_by_question
    }
    answer_states = {
        question_id: answer.state.value
        for question_id, answer in answers_by_question.items()
    }
    answer_change_ids = {
        question_id: frozenset(questions_by_id[question_id].affects_change_ids)
        for question_id in answers_by_question
    }
    source_documents = _answer_source_documents(
        context,
        affected_module_ids,
        answers_by_question,
    )
    payload = {
        "affectedModuleIds": sorted(affected_module_ids),
        "affectedChangeIds": sorted(affected_change_ids),
        "affectedChanges": [
            change.model_dump(mode="json") for change in affected_changes
        ],
        "submittedAnswers": [
            answer.model_dump(mode="json") for answer in answers
        ],
        "sourceDocuments": source_documents,
        "allowedSourceRoots": list(_ALLOWED_SOURCE_ROOTS),
    }
    raw = await _call_llm(
        _messages(
            system_prompt=ANSWER_REWRITE_SYSTEM_PROMPT,
            payload=payload,
        ),
        json_mode=True,
        request_label="resume_optimization_answer",
    )
    return normalize_answered_optimization_changes(
        raw,
        expected_changes=affected_changes,
        selected_master_ids=set(context.selected_master_experience_ids),
        selected_skill_ids=_selected_skill_ids(context),
        current_section_order=_current_section_order(context),
        source_documents=source_documents,
        answer_question_modules=answer_question_modules,
        answer_states=answer_states,
        answer_change_ids=answer_change_ids,
    )
