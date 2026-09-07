from __future__ import annotations

from copy import deepcopy
import asyncio
import json
import re
import unicodedata
from typing import Any, Mapping, Sequence

from ..ai import runtime_budget
from ..ai.llm_transport import _call_llm
from ..ai.public_errors import AiProviderPayloadError
from .context_service import FrozenOptimizationContext
from .normalizers import (
    OptimizationPlanNormalizationError,
    _SourceValidationContext,
    normalize_answered_optimization_changes,
    normalize_optimization_plan,
)
from .prompts import ANSWER_REWRITE_SYSTEM_PROMPT, OPTIMIZATION_SYSTEM_PROMPT
from .schemas import (
    OptimizationAction,
    OptimizationAnswer,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationQuestionChoice,
    RESUME_EVALUATION_DIMENSION_NAMES,
)


_ALLOWED_SOURCE_ROOTS = (
    "/currentResume",
    "/selectedSourceExperiences",
    "/userAnswers",
)


async def _bounded_model_call(*args: Any, **kwargs: Any) -> Any:
    try:
        async with asyncio.timeout(90):
            return await _call_llm(*args, **kwargs)
    except TimeoutError as exc:
        raise runtime_budget.AiRuntimeTimeoutError("Optimization model stage timed out") from exc
_DIRECT_IDENTIFIER_KEYS = frozenset(
    {"name", "email", "phone", "linkedin", "location"}
)
_PROFILE_VALUE_REDACTION = "[profile data omitted]"
_RESUME_TEXT_KEYS = frozenset(
    {
        "target_role",
        "personal_summary",
        "title",
        "org",
        "summary",
        "s",
        "t",
        "a",
        "r",
        "school",
        "major",
        "degree",
        "gpa",
        "courses",
        "name",
        "issuer",
    }
)
_EVALUATION_TEXT_KEYS = frozenset(
    {
        "targetRole",
        "sourceText",
        "description",
        "strengths",
        "improvementQuestions",
        "field",
        "reason",
        "question",
        "action",
        "recommendation",
        "explanation",
    }
)
_UNTRUSTED_EVALUATION_TEXT_KEYS = frozenset(
    {
        "description",
        "strengths",
        "improvementQuestions",
        "field",
        "reason",
        "question",
        "action",
        "recommendation",
        "explanation",
    }
)
_UNTRUSTED_EVALUATION_TEXT_REDACTION = "[evaluation text omitted]"
_ENGLISH_MONTH_NAMES = frozenset(
    {
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    }
)


def _strict_object_schema(properties: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": dict(properties),
        "required": list(properties),
        "additionalProperties": False,
    }


_STRING_ARRAY_SCHEMA = {"type": "array", "items": {"type": "string"}}
_ANSWER_REWRITE_CHANGE_RESPONSE_SCHEMA = _strict_object_schema(
    {
        "changeId": {"type": "string"},
        "issueIds": _STRING_ARRAY_SCHEMA,
        "dimension": {"type": "string"},
        "moduleType": {
            "type": "string",
            "enum": ["experience_star", "personal_summary"],
        },
        "moduleId": {"type": "string"},
        "fieldPath": {"type": "string"},
        "actionKind": {
            "type": "string",
            "enum": ["rewrite_now", "leave_unchanged"],
        },
        "scope": {"type": "string", "enum": ["general", "jd_targeted"]},
        "beforeValue": {"type": ["string", "null"]},
        "generalValue": {"type": ["string", "null"]},
        "targetedValue": {"type": ["string", "null"]},
        "sourceRefs": _STRING_ARRAY_SCHEMA,
        "introducedTerms": _STRING_ARRAY_SCHEMA,
        "rationale": {"type": "string"},
        "expectedScoreGain": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
        },
        "defaultSelected": {"type": "boolean"},
    }
)
_ANSWER_REWRITE_RESPONSE_SCHEMA = _strict_object_schema(
    {
        "changes": {
            "type": "array",
            "minItems": 1,
            "items": _strict_object_schema({
                key: value
                for key, value in _ANSWER_REWRITE_CHANGE_RESPONSE_SCHEMA["properties"].items()
                if key in {"changeId", "actionKind", "generalValue", "targetedValue", "sourceRefs", "introducedTerms", "rationale", "expectedScoreGain"}
            }),
        }
    }
)

_PLAN_CHANGE_SCHEMA = deepcopy(_ANSWER_REWRITE_CHANGE_RESPONSE_SCHEMA)
_PLAN_CHANGE_SCHEMA["properties"]["moduleType"]["enum"] = [
    "experience_star", "personal_summary", "skills_order", "section_order",
]
_PLAN_CHANGE_SCHEMA["properties"]["actionKind"]["enum"] = [
    "rewrite_now", "ask_user", "leave_unchanged",
]
for _candidate_key in ("beforeValue", "generalValue", "targetedValue"):
    _PLAN_CHANGE_SCHEMA["properties"][_candidate_key] = {
        "anyOf": [{"type": "string"}, {"type": "null"}, _STRING_ARRAY_SCHEMA],
    }
_PLAN_RESPONSE_SCHEMA = _strict_object_schema({
    "changes": {"type": "array", "items": _PLAN_CHANGE_SCHEMA},
    "safeCleanupCandidates": {"type": "array", "maxItems": 5, "items": _strict_object_schema({
        "changeId": {"type": "string"}, "value": {"type": "string"},
    })},
    "questions": {"type": "array", "maxItems": 5, "items": _strict_object_schema({
        "questionId": {"type": "string"}, "moduleId": {"type": "string"},
        "fieldPath": {"type": "string"}, "text": {"type": "string"},
        "reason": {"type": "string"},
        "answerType": {"type": "string", "enum": ["single_choice_with_text"]},
        "choices": {"type": "array", "items": _strict_object_schema({
            "value": {"type": "string"}, "label": {"type": "string"},
        })},
        "affectsChangeIds": _STRING_ARRAY_SCHEMA,
        "priority": {"type": "integer", "minimum": 0},
    })},
})


def _answer_patch_schema(source_documents: Mapping[str, Any], change_ids: Sequence[str]) -> dict[str, Any]:
    schema=deepcopy(_ANSWER_REWRITE_RESPONSE_SCHEMA)
    refs=[]
    def visit(value: Any, pointer: str, key: str="") -> None:
        if isinstance(value, Mapping):
            for child,nested in value.items():
                if child in {"id","state","source_version_id","master_experience_id"}:
                    continue
                token=str(child).replace("~","~0").replace("/","~1")
                visit(nested,pointer+"/"+token,str(child))
        elif isinstance(value,list):
            for index,nested in enumerate(value):visit(nested,pointer+"/"+str(index),key)
        elif isinstance(value,str) and value.strip():
            refs.append(pointer)
    visit(source_documents,"")
    props=schema["properties"]["changes"]["items"]["properties"]
    props["changeId"]["enum"]=list(change_ids)
    if refs:
        # deepcopy preserves shared references inside the schema. Detach this
        # field before narrowing it so introducedTerms remains ordinary text.
        props["sourceRefs"] = deepcopy(props["sourceRefs"])
        props["sourceRefs"]["items"]["enum"] = refs
    return schema


def _bind_identical_owned_sources(raw: Any, context: FrozenOptimizationContext) -> None:
    """Repair a pointer typo only when the target owns the exact same leaf text.

    Never borrow another experience's facts, resolve bank contents, or move answers.
    The ordinary strict scope and semantic checks still run on the bound pointer.
    """
    from .safety import resolve_source_ref
    if not isinstance(raw,dict) or not isinstance(raw.get("changes"),list):
        return
    selected=set(context.selected_master_experience_ids)
    documents=context.source_documents
    for change in raw["changes"]:
        if not isinstance(change,dict) or change.get("moduleType",change.get("module_type"))!="experience_star":
            continue
        target=change.get("moduleId",change.get("module_id"))
        if not isinstance(target,str) or target not in selected:
            continue
        if "sourceRefs" in change and "source_refs" in change:
            continue
        key="sourceRefs" if "sourceRefs" in change else "source_refs"
        refs=change.get(key)
        if not isinstance(refs,list):continue
        for index,ref in enumerate(refs):
            if not isinstance(ref,str):continue
            parts=ref.split("/")
            position=3 if parts[:3]==["","currentResume","experiences"] else 2 if parts[:2]==["","selectedSourceExperiences"] else None
            if position is None or len(parts)<=position+1 or parts[position] not in selected or parts[position]==target:
                continue
            own_parts=list(parts);own_parts[position]=target.replace("~","~0").replace("/","~1")
            own_ref="/".join(own_parts)
            try:
                source=resolve_source_ref(documents,ref)
                own=resolve_source_ref(documents,own_ref)
            except (ValueError,KeyError,IndexError,TypeError):
                continue
            if isinstance(source,str) and source.strip() and source==own:
                refs[index]=own_ref


class OptimizationAnswerRewriteNormalizationError(OptimizationPlanNormalizationError):
    """A model answer rewrite violated the contract and can be regenerated safely."""

    status_code = 502
    retryable = True
    public_message = "AI 返回的优化结果结构异常，请重试。"

    def __init__(self) -> None:
        super().__init__("answer rewrite response violates the optimization contract")


def _known_issue_dimensions(evaluation: Mapping[str, Any]) -> dict[str, str]:
    raw_issues = evaluation.get("issues")
    if not isinstance(raw_issues, list):
        raise OptimizationPlanNormalizationError(
            "six-dimensional evaluation issues must be an array"
        )
    issue_dimensions: dict[str, str] = {}
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
        primary_dimension = item.get("primaryDimension")
        if not isinstance(primary_dimension, str) or not primary_dimension.strip():
            raise OptimizationPlanNormalizationError(
                "six-dimensional evaluation issue primaryDimension must be non-empty"
            )
        if issue_id in issue_dimensions:
            raise OptimizationPlanNormalizationError(
                "six-dimensional evaluation issue IDs must be unique"
            )
        issue_dimensions[issue_id] = primary_dimension
    return issue_dimensions


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


def _sorted_profile_values(
    values: set[tuple[str, str]],
) -> tuple[tuple[str, str], ...]:
    return tuple(sorted(values, key=lambda item: (-len(item[1]), item)))


def _collect_profile_values(
    current_resume: Mapping[str, Any],
) -> tuple[tuple[str, str], ...]:
    values: set[tuple[str, str]] = set()
    raw_profile = current_resume.get("profile")
    profile = raw_profile if isinstance(raw_profile, Mapping) else {}
    for key in _DIRECT_IDENTIFIER_KEYS:
        for raw_value in (profile.get(key), current_resume.get(key)):
            if isinstance(raw_value, str) and raw_value.strip():
                values.add((key, raw_value.strip()))
    return _sorted_profile_values(values)


def _profile_fact_kind(source: Any) -> str | None:
    if not isinstance(source, str) or not source.startswith("/"):
        return None
    tokens = source.split("/")[1:]
    if len(tokens) < 2 or tokens[0] != "currentResume":
        return None
    if tokens[1] == "profile":
        return tokens[2] if len(tokens) >= 3 else "profile"
    if len(tokens) == 2 and tokens[1] in _DIRECT_IDENTIFIER_KEYS:
        return tokens[1]
    return None


def _retain_evidence_references(value: Any, allowed_ids: set[str]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "evidenceIds" and isinstance(nested, list):
                value[key] = [item for item in nested if item in allowed_ids]
            else:
                _retain_evidence_references(nested, allowed_ids)
        return
    if isinstance(value, list):
        for nested in value:
            _retain_evidence_references(nested, allowed_ids)


def _normalized_profile_text(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def _bounded_text_contains(haystack: str, needle: str) -> bool:
    prefix = r"(?<![a-z0-9])" if needle[0].isascii() and needle[0].isalnum() else ""
    suffix = r"(?![a-z0-9])" if needle[-1].isascii() and needle[-1].isalnum() else ""
    return re.search(f"{prefix}{re.escape(needle)}{suffix}", haystack) is not None


def _linkedin_profile_paths(value: str) -> set[str]:
    normalized = _normalized_profile_text(value)
    matches = re.finditer(
        r"(?<![a-z0-9.-])(?:https?://)?(?:www\.)?linkedin\.com/([^\s?#]+)",
        normalized,
    )
    return {
        match.group(1).rstrip("/.,;:)]}，。；：！？")
        for match in matches
        if match.group(1).rstrip("/.,;:)]}，。；：！？")
    }


def _phone_main_digits(value: str) -> str:
    normalized = _normalized_profile_text(value)
    without_extension = re.sub(
        r"(?<=\d)\s*(?:ext(?:ension)?\.?|x|#)\s*[:.-]?\s*\d+\s*$",
        "",
        normalized,
    )
    return re.sub(r"\D", "", without_extension)


def _name_aliases(value: str) -> tuple[str, ...]:
    normalized = _normalized_profile_text(value).strip()
    if not normalized:
        return ()
    aliases = {normalized}
    aliases.update(
        token
        for token in re.findall(r"[a-z]+", normalized)
        if len(token) >= 4
    )
    return tuple(sorted(aliases, key=lambda item: (-len(item), item)))


def _is_calendar_month_mention(alias: str, value: str, match: re.Match[str]) -> bool:
    """Recognize date-shaped uses of a month-name alias without exposing names."""
    if alias not in _ENGLISH_MONTH_NAMES:
        return False
    before = value[:match.start()]
    after = value[match.end():]
    if re.search(
        r"(?<![a-z0-9])(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+$",
        before,
        re.IGNORECASE,
    ):
        return True
    if re.match(r"\s*,?\s*(?:19|20)\d{2}\b", after):
        return True
    if re.match(
        r"\s+(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:,\s*(?:19|20)\d{2}\b|\b)",
        after,
        re.IGNORECASE,
    ):
        return True
    return re.match(
        r"\s*(?:[/\-–—]|to\b|through\b|until\b)\s*"
        r"(?:january|february|march|april|may|june|july|august|"
        r"september|october|november|december)\b"
        r"(?=\s*,?\s*(?:19|20)\d{2}\b)",
        after,
        re.IGNORECASE,
    ) is not None


def _is_common_word_name_alias(alias: str, value: str, match: re.Match[str]) -> bool:
    """Recognize narrowly structured common-word aliases."""
    before = value[:match.start()]
    after = value[match.end():]
    if alias == "bill":
        if match.group() != alias:
            return False
        return (
            re.search(
                r"\b(?:the|a|an|this|that|my|your|our|their)\s+$",
                before,
                re.IGNORECASE,
            )
            is not None
            and re.match(
                r"\s+(?:processing|payment|amount|total|invoice|cycle|review|"
                r"approval|collection|billing|reconciliation)\b",
                after,
                re.IGNORECASE,
            )
            is not None
        )
    if alias == "will":
        if match.group() != alias:
            return False
        if re.match(r"\s+[a-z][a-z-]*\b", after) is None:
            return False
        subject = re.split(r"[.!?;:]\s*", before.rstrip())[-1]
        return (
            re.fullmatch(
                r"(?:i|we|you|he|she|it|they|this|that|these|those)",
                subject,
                re.IGNORECASE,
            )
            is not None
            or re.fullmatch(r"[a-z][a-z-]*", subject, re.IGNORECASE) is not None
            or re.fullmatch(
                r"(?:this|that|these|those|the|a|an|my|your|our|their)\s+"
                r"[a-z][a-z-]*",
                subject,
                re.IGNORECASE,
            )
            is not None
        )
    if alias == "grace":
        return re.match(r"\s+period\b", after, re.IGNORECASE) is not None
    if alias == "grant":
        return re.match(r"\s+funding\b", after, re.IGNORECASE) is not None
    if alias == "mark":
        return re.search(r"\bquality\s+$", before, re.IGNORECASE) is not None
    return False


def _name_mention_spans(value: str, profile_value: str) -> list[tuple[int, int]]:
    """Keep name aliases private, except for explicit business collocations.

    A name component can also be an ordinary word (e.g. grant funding). Use
    the same occurrence-level matches for detection and redaction so a real
    person mention does not cause unrelated uses of that word to be removed.
    These narrow contexts may disambiguate a single-word profile name, while a
    complete multi-token name remains protected.
    """
    spans: list[tuple[int, int]] = []
    for alias in _name_aliases(profile_value):
        prefix = r"(?<![a-z0-9])" if alias[0].isascii() and alias[0].isalnum() else ""
        suffix = r"(?![a-z0-9])" if alias[-1].isascii() and alias[-1].isalnum() else ""
        name_pattern = r"\s+".join(re.escape(part) for part in alias.split())
        for match in re.finditer(f"{prefix}{name_pattern}{suffix}", value, re.IGNORECASE):
            if _is_calendar_month_mention(
                alias,
                value,
                match,
            ) or _is_common_word_name_alias(alias, value, match):
                continue
            spans.append(match.span())
    merged: list[tuple[int, int]] = []
    for start, end in sorted(set(spans)):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _email_variant_pattern(value: str) -> str | None:
    normalized = _normalized_profile_text(value).strip()
    if normalized.count("@") != 1:
        return None
    local, domain = normalized.split("@", 1)
    labels = domain.split(".")
    if not local or len(labels) < 2 or any(not label for label in labels):
        return None
    at_separator = r"\s*(?:@|\[\s*at\s*\]|\(\s*at\s*\)|\bat\b)\s*"
    dot_separator = r"\s*(?:\.|\[\s*dot\s*\]|\(\s*dot\s*\)|\bdot\b)\s*"
    domain_pattern = dot_separator.join(re.escape(label) for label in labels)
    return (
        r"(?<![a-z0-9._%+-])"
        + re.escape(local)
        + at_separator
        + domain_pattern
        + r"(?![a-z0-9.-])"
    )


def _profile_value_matches(value: str, *, kind: str, profile_value: str) -> bool:
    normalized = _normalized_profile_text(value)
    normalized_profile = _normalized_profile_text(profile_value).strip()
    if not normalized_profile:
        return False
    if kind == "phone":
        digits = re.sub(r"\D", "", normalized)
        profile_digits = _phone_main_digits(profile_value)
        if len(profile_digits) < 7:
            return False
        local_digits = profile_digits[-8:] if len(profile_digits) > 8 else profile_digits
        return profile_digits in digits or local_digits in digits
    if kind == "linkedin":
        profile_paths = _linkedin_profile_paths(profile_value)
        if profile_paths:
            return bool(profile_paths & _linkedin_profile_paths(value))
        canonical_text = re.sub(r"\bhttps?://(?:www\.)?", "", normalized)
        canonical_profile = re.sub(
            r"\bhttps?://(?:www\.)?",
            "",
            normalized_profile,
        ).rstrip("/")
        return bool(canonical_profile) and _bounded_text_contains(
            canonical_text,
            canonical_profile,
        )
    if kind == "email":
        compact = re.sub(r"\s+", "", normalized)
        compact_profile = re.sub(r"\s+", "", normalized_profile)
        variant_pattern = _email_variant_pattern(profile_value)
        return (
            bool(compact_profile)
            and compact_profile in compact
            or variant_pattern is not None
            and re.search(variant_pattern, normalized) is not None
        )
    if kind == "name":
        return bool(_name_mention_spans(normalized, profile_value))

    if _bounded_text_contains(normalized, normalized_profile):
        return True
    compact_profile = re.sub(r"\s+", "", normalized_profile)
    if len(compact_profile) < 6:
        return False
    compact = re.sub(r"\s+", "", normalized)
    return _bounded_text_contains(compact, compact_profile)


def _replace_direct_profile_value(
    value: str,
    *,
    kind: str,
    profile_value: str,
) -> str | None:
    if kind == "name":
        spans = _name_mention_spans(value, profile_value)
        if not spans:
            return None
        replaced = value
        for start, end in reversed(spans):
            replaced = replaced[:start] + _PROFILE_VALUE_REDACTION + replaced[end:]
        return replaced
    candidates = (_normalized_profile_text(profile_value).strip(),)
    if kind == "email":
        variant_pattern = _email_variant_pattern(profile_value)
        if variant_pattern is not None:
            replaced, count = re.subn(
                variant_pattern,
                _PROFILE_VALUE_REDACTION,
                value,
                flags=re.IGNORECASE,
            )
            if count:
                return replaced
    replaced = value
    total_count = 0
    for candidate in candidates:
        if not candidate:
            continue
        escaped = re.escape(candidate)
        prefix = (
            r"(?<![A-Za-z0-9])"
            if candidate[0].isascii() and candidate[0].isalnum()
            else ""
        )
        suffix = (
            r"(?![A-Za-z0-9])"
            if candidate[-1].isascii() and candidate[-1].isalnum()
            else ""
        )
        replaced, count = re.subn(
            f"{prefix}{escaped}{suffix}",
            _PROFILE_VALUE_REDACTION,
            replaced,
            flags=re.IGNORECASE,
        )
        total_count += count
    return replaced if total_count else None


def _scrub_human_text(
    value: Any,
    profile_values: tuple[tuple[str, str], ...],
) -> Any:
    if isinstance(value, str):
        scrubbed = value
        for kind, profile_value in profile_values:
            if not _profile_value_matches(
                scrubbed,
                kind=kind,
                profile_value=profile_value,
            ):
                continue
            direct_replacement = _replace_direct_profile_value(
                scrubbed,
                kind=kind,
                profile_value=profile_value,
            )
            scrubbed = direct_replacement or _PROFILE_VALUE_REDACTION
        return scrubbed
    if isinstance(value, list):
        return [_scrub_human_text(item, profile_values) for item in value]
    if isinstance(value, dict):
        return {
            key: _scrub_human_text(item, profile_values)
            for key, item in value.items()
        }
    return value


def _scrub_named_text_fields(
    value: Any,
    *,
    text_keys: frozenset[str],
    profile_values: tuple[tuple[str, str], ...],
) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in text_keys:
                value[key] = _scrub_human_text(nested, profile_values)
            else:
                _scrub_named_text_fields(
                    nested,
                    text_keys=text_keys,
                    profile_values=profile_values,
                )
        return
    if isinstance(value, list):
        for nested in value:
            _scrub_named_text_fields(
                nested,
                text_keys=text_keys,
                profile_values=profile_values,
            )


def _scrub_skill_category_text(
    resume: Mapping[str, Any],
    profile_values: tuple[tuple[str, str], ...],
) -> None:
    raw_skills = resume.get("skills")
    if not isinstance(raw_skills, list):
        return
    for skill in raw_skills:
        if isinstance(skill, dict) and "category" in skill:
            skill["category"] = _scrub_human_text(
                skill["category"],
                profile_values,
            )


def _redact_untrusted_evaluation_text(value: Any) -> Any:
    if isinstance(value, str):
        return _UNTRUSTED_EVALUATION_TEXT_REDACTION
    if isinstance(value, list):
        return [_redact_untrusted_evaluation_text(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _redact_untrusted_evaluation_text(item)
            for key, item in value.items()
        }
    return value


def _minimize_untrusted_evaluation_text(evaluation: dict[str, Any]) -> None:
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                if key in _UNTRUSTED_EVALUATION_TEXT_KEYS:
                    value[key] = _redact_untrusted_evaluation_text(nested)
                else:
                    visit(nested)
            return
        if isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(evaluation)


def _project_allowed_evaluation_evidence(
    evaluation: dict[str, Any],
    facts: Sequence[Any],
) -> set[str]:
    facts_by_id: dict[str, Mapping[str, Any]] = {}
    for fact in facts:
        if not isinstance(fact, Mapping):
            continue
        fact_id = fact.get("fact_id", fact.get("factId"))
        if isinstance(fact_id, str) and fact_id:
            facts_by_id[fact_id] = fact

    raw_evidence = evaluation.get("evidence")
    if not isinstance(raw_evidence, list):
        return set()
    allowed_evidence_ids: set[str] = set()
    filtered_evidence: list[Any] = []
    for evidence in raw_evidence:
        if not isinstance(evidence, Mapping):
            continue
        evidence_id = evidence.get("evidenceId")
        fact_id = evidence.get("factId")
        fact = facts_by_id.get(fact_id) if isinstance(fact_id, str) else None
        if fact is None or not isinstance(evidence_id, str) or not evidence_id:
            continue
        projected = dict(evidence)
        projected["sourceText"] = fact.get("content", "")
        projected["location"] = fact.get("source", "")
        filtered_evidence.append(projected)
        allowed_evidence_ids.add(evidence_id)
    evaluation["evidence"] = filtered_evidence
    return allowed_evidence_ids


def _planner_issue_id_aliases(
    evaluation: Mapping[str, Any],
) -> dict[str, str]:
    raw_issues = evaluation.get("issues")
    if not isinstance(raw_issues, list):
        return {}
    aliases: dict[str, str] = {}
    for item in raw_issues:
        if not isinstance(item, Mapping):
            continue
        issue_id = item.get("issueId")
        if isinstance(issue_id, str) and issue_id and issue_id not in aliases:
            aliases[issue_id] = f"ISSUE_{len(aliases) + 1:03d}"
    return aliases


def _alias_evaluation_graph_ids(evaluation: dict[str, Any]) -> None:
    issue_aliases = _planner_issue_id_aliases(evaluation)
    raw_evidence = evaluation.get("evidence")
    evidence_aliases: dict[str, str] = {}
    if isinstance(raw_evidence, list):
        for item in raw_evidence:
            if not isinstance(item, dict):
                continue
            evidence_id = item.get("evidenceId")
            if (
                isinstance(evidence_id, str)
                and evidence_id
                and evidence_id not in evidence_aliases
            ):
                evidence_aliases[evidence_id] = (
                    f"EVIDENCE_{len(evidence_aliases) + 1:03d}"
                )
            if isinstance(evidence_id, str) and evidence_id in evidence_aliases:
                item["evidenceId"] = evidence_aliases[evidence_id]

    def alias_evidence_refs(value: Any) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                if key == "evidenceIds" and isinstance(nested, list):
                    value[key] = [
                        evidence_aliases[item]
                        for item in nested
                        if item in evidence_aliases
                    ]
                else:
                    alias_evidence_refs(nested)
            return
        if isinstance(value, list):
            for nested in value:
                alias_evidence_refs(nested)

    alias_evidence_refs(evaluation)

    raw_issues = evaluation.get("issues")
    if isinstance(raw_issues, list):
        for item in raw_issues:
            if isinstance(item, dict):
                issue_id = item.get("issueId")
                if isinstance(issue_id, str) and issue_id in issue_aliases:
                    item["issueId"] = issue_aliases[issue_id]
    raw_dimensions = evaluation.get("dimensions")
    if isinstance(raw_dimensions, list):
        for dimension in raw_dimensions:
            if not isinstance(dimension, dict):
                continue
            issue_ids = dimension.get("issues")
            if isinstance(issue_ids, list):
                dimension["issues"] = [
                    issue_aliases[item]
                    for item in issue_ids
                    if item in issue_aliases
                ]
    raw_priorities = evaluation.get("topPriorities")
    if isinstance(raw_priorities, list):
        for priority in raw_priorities:
            if not isinstance(priority, dict):
                continue
            issue_id = priority.get("issueId")
            if isinstance(issue_id, str) and issue_id in issue_aliases:
                priority["issueId"] = issue_aliases[issue_id]


def _restore_planner_issue_ids(
    raw: Any,
    alias_to_original: Mapping[str, str],
) -> Any:
    if not isinstance(raw, Mapping):
        return raw
    restored = deepcopy(dict(raw))
    raw_changes = restored.get("changes")
    if not isinstance(raw_changes, list):
        return restored
    for change in raw_changes:
        if not isinstance(change, dict):
            continue
        for key in ("issueIds", "issue_ids"):
            issue_ids = change.get(key)
            if isinstance(issue_ids, list):
                change[key] = [
                    alias_to_original.get(item, item)
                    if isinstance(item, str)
                    else item
                    for item in issue_ids
                ]
    return restored


def _restore_planner_change_ids(
    raw: Any,
    alias_to_original: Mapping[str, str],
) -> Any:
    if not isinstance(raw, Mapping):
        return raw
    restored = deepcopy(dict(raw))
    raw_changes = restored.get("changes")
    if not isinstance(raw_changes, list):
        return restored
    for change in raw_changes:
        if not isinstance(change, dict):
            continue
        for key in ("changeId", "change_id"):
            change_id = change.get(key)
            if isinstance(change_id, str):
                change[key] = alias_to_original.get(change_id, change_id)
    return restored


def _restore_user_answer_source_refs(
    raw: Any,
    alias_to_original: Mapping[str, str],
) -> Any:
    if not isinstance(raw, Mapping):
        return raw
    restored = deepcopy(dict(raw))
    raw_changes = restored.get("changes")
    if not isinstance(raw_changes, list):
        return restored
    replacements = {
        f"/userAnswers/{alias}/": (
            "/userAnswers/"
            + question_id.replace("~", "~0").replace("/", "~1")
            + "/"
        )
        for alias, question_id in alias_to_original.items()
    }
    for change in raw_changes:
        if not isinstance(change, dict):
            continue
        for key in ("sourceRefs", "source_refs"):
            source_refs = change.get(key)
            if not isinstance(source_refs, list):
                continue
            restored_refs: list[Any] = []
            for source_ref in source_refs:
                if not isinstance(source_ref, str):
                    restored_refs.append(source_ref)
                    continue
                restored_ref = source_ref
                for alias_prefix, original_prefix in replacements.items():
                    if restored_ref.startswith(alias_prefix):
                        restored_ref = original_prefix + restored_ref[len(alias_prefix):]
                        break
                restored_refs.append(restored_ref)
            change[key] = restored_refs
    return restored


def _aliased_change_payloads(
    changes: Sequence[OptimizationChange],
    context: FrozenOptimizationContext,
    issue_aliases: Mapping[str, str],
    change_aliases: Mapping[str, str],
) -> list[dict[str, Any]]:
    profile_values = _collect_profile_values(context.current_resume)
    payloads: list[dict[str, Any]] = []
    for change in changes:
        payload = change.model_dump(mode="json")
        change_alias = change_aliases.get(change.change_id)
        if change_alias is None:
            raise OptimizationPlanNormalizationError(
                "optimization change has no model-safe alias"
            )
        issue_ids = payload.get("issue_ids")
        if not isinstance(issue_ids, list):
            raise OptimizationPlanNormalizationError(
                "optimization change issue IDs must be an array"
            )
        if any(
            not isinstance(issue_id, str) or issue_id not in issue_aliases
            for issue_id in issue_ids
        ):
            raise OptimizationPlanNormalizationError(
                "optimization change references an unknown issue ID"
            )
        frozen_before = _frozen_mutable_text_value(context, change)
        if frozen_before is None:
            raise OptimizationPlanNormalizationError(
                "optimization answer change has no frozen mutable target"
            )
        payload.update(
            {
                "change_id": change_alias,
                "issue_ids": [issue_aliases[issue_id] for issue_id in issue_ids],
                "before_value": _scrub_human_text(frozen_before, profile_values),
                "general_value": None,
                "targeted_value": None,
                "source_refs": [],
                "introduced_terms": [],
                "rationale": "已省略历史说明。",
                "default_selected": False,
            }
        )
        payload.pop("safety_status", None)
        payload.pop("safety_findings", None)
        payload.pop("semantic_review", None)
        payloads.append(payload)
    return payloads


def _frozen_mutable_text_value(
    context: FrozenOptimizationContext,
    change: OptimizationChange,
) -> str | None:
    current_resume = context.current_resume
    if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        if change.field_path not in {"personal_summary", "personalSummary"}:
            return None
        value = current_resume.get("personal_summary")
        return value if isinstance(value, str) else None
    if change.module_type != OptimizationModuleType.EXPERIENCE_STAR:
        return None
    if change.field_path not in {"star.s", "star.t", "star.a", "star.r"}:
        return None
    raw_experiences = current_resume.get("experiences")
    if not isinstance(raw_experiences, Mapping):
        return None
    experience = raw_experiences.get(change.module_id)
    if not isinstance(experience, Mapping):
        return None
    raw_star = experience.get("star")
    if not isinstance(raw_star, Mapping):
        return None
    value = raw_star.get(change.field_path.removeprefix("star."))
    return value if isinstance(value, str) else None


def _private_target_original_value(
    context: FrozenOptimizationContext,
    change: OptimizationChange,
) -> str | None:
    original_value = _frozen_mutable_text_value(context, change)
    if original_value is None:
        return None
    profile_values = _collect_profile_values(context.current_resume)
    if _scrub_human_text(original_value, profile_values) == original_value:
        return None
    return original_value


def _local_leave_unchanged_change(
    change: OptimizationChange,
    *,
    original_value: str,
    rationale: str,
) -> OptimizationChange:
    return change.model_copy(
        deep=True,
        update={
            "action_kind": OptimizationAction.LEAVE_UNCHANGED,
            "before_value": original_value,
            "general_value": original_value,
            "targeted_value": original_value,
            "source_refs": [],
            "introduced_terms": [],
            "rationale": rationale,
            "expected_score_gain": 0,
            "default_selected": False,
            "safety_status": "pending",
            "safety_findings": [],
        },
    )


def _protect_private_target_changes(
    plan: OptimizationPlan,
    context: FrozenOptimizationContext,
) -> OptimizationPlan:
    protected_change_ids: set[str] = set()
    protected_changes: list[OptimizationChange] = []
    for change in plan.changes:
        original_value = _private_target_original_value(context, change)
        if original_value is None:
            protected_changes.append(change)
            continue
        protected_change_ids.add(change.change_id)
        protected_changes.append(
            _local_leave_unchanged_change(
                change,
                original_value=original_value,
                rationale="目标字段含个人信息，已保持原文不变。",
            )
        )
    protected_questions = []
    for question in plan.questions:
        remaining_change_ids = [
            change_id
            for change_id in question.affects_change_ids
            if change_id not in protected_change_ids
        ]
        if remaining_change_ids:
            protected_questions.append(
                question.model_copy(
                    deep=True,
                    update={"affects_change_ids": remaining_change_ids},
                )
            )
    return plan.model_copy(
        deep=True,
        update={
            "changes": protected_changes,
            "questions": protected_questions,
        },
    )


def _minimized_planner_model_payload(
    context: FrozenOptimizationContext,
) -> dict[str, Any]:
    """Remove profile PII while retaining non-profile resume truth sources."""

    payload = context.model_payload()
    current_resume = payload.get("currentResume")
    profile_values: tuple[tuple[str, str], ...] = ()
    if isinstance(current_resume, dict):
        profile_values = _collect_profile_values(current_resume)
        current_resume.pop("profile", None)
        for key in _DIRECT_IDENTIFIER_KEYS:
            current_resume.pop(key, None)

    raw_facts = payload.get("factMetadata")
    if isinstance(raw_facts, list):
        filtered_facts: list[Any] = []
        for fact in raw_facts:
            if not isinstance(fact, Mapping):
                continue
            profile_fact_kind = _profile_fact_kind(fact.get("source"))
            if profile_fact_kind is not None:
                content = fact.get("content")
                if isinstance(content, str) and content.strip():
                    profile_values = _sorted_profile_values(
                        {
                            *profile_values,
                            (profile_fact_kind, content.strip()),
                        }
                    )
                continue
            filtered_facts.append(fact)
        payload["factMetadata"] = filtered_facts

    if isinstance(current_resume, dict):
        _scrub_named_text_fields(
            current_resume,
            text_keys=_RESUME_TEXT_KEYS,
            profile_values=profile_values,
        )
        _scrub_skill_category_text(current_resume, profile_values)
    selected_sources = payload.get("selectedSourceExperiences")
    if isinstance(selected_sources, dict):
        _scrub_named_text_fields(
            selected_sources,
            text_keys=_RESUME_TEXT_KEYS,
            profile_values=profile_values,
        )
        _scrub_skill_category_text(selected_sources, profile_values)
    if isinstance(raw_facts, list):
        for fact in payload.get("factMetadata", []):
            if isinstance(fact, dict) and "content" in fact:
                fact["content"] = _scrub_human_text(
                    fact["content"],
                    profile_values,
                )
    if isinstance(payload.get("targetRole"), str):
        payload["targetRole"] = _scrub_human_text(
            payload["targetRole"],
            profile_values,
        )

    evaluation = payload.get("evaluation")
    if isinstance(evaluation, dict):
        filtered_facts = payload.get("factMetadata")
        allowed_evidence_ids = _project_allowed_evaluation_evidence(
            evaluation,
            filtered_facts if isinstance(filtered_facts, list) else [],
        )
        _retain_evidence_references(evaluation, allowed_evidence_ids)
        _minimize_untrusted_evaluation_text(evaluation)
        if "targetRole" in evaluation:
            evaluation["targetRole"] = payload.get("targetRole", "")
        _scrub_named_text_fields(
            evaluation,
            text_keys=_EVALUATION_TEXT_KEYS,
            profile_values=profile_values,
        )
        _alias_evaluation_graph_ids(evaluation)
    return payload


def _messages(*, system_prompt: str, payload: Mapping[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": _bounded_json_content(payload)},
    ]


@runtime_budget.ai_wall_clock_limited
async def _plan_resume_optimization_v3(
    context: FrozenOptimizationContext,
) -> OptimizationPlan:
    known_issue_dimensions = _known_issue_dimensions(context.evaluation)
    issue_alias_to_original = {
        alias: issue_id
        for issue_id, alias in _planner_issue_id_aliases(context.evaluation).items()
    }
    model_payload = _minimized_planner_model_payload(context)
    from .coverage import coverage_targets, reconcile_coverage, bind_cleanup_fallbacks
    raw = await _bounded_model_call(
        _messages(
            system_prompt=OPTIMIZATION_SYSTEM_PROMPT,
            payload={
                "context": model_payload,
                "fieldCoverageTargets": [
                    {**target, "issue_id": _planner_issue_id_aliases(context.evaluation).get(target['issue_id'], target['issue_id'])}
                    for target in coverage_targets(context)
                ],
                "allowedSourceRoots": list(_ALLOWED_SOURCE_ROOTS),
                "sourceGuidance": (
                    "Use only JSON pointers under the listed roots. A selected "
                    "source experience may support only that same experience."
                ),
            },
        ),
        json_mode=True,
        request_label="resume_optimization_plan",
        gemini_thinking_level="low",
        gemini_stream=True,
        gemini_response_json_schema=_PLAN_RESPONSE_SCHEMA,
    )
    raw = _restore_planner_issue_ids(raw, issue_alias_to_original)
    cleanup_raw = raw.pop("safeCleanupCandidates", []) if isinstance(raw, dict) else []
    _bind_identical_owned_sources(raw,context)
    if isinstance(raw, dict) and isinstance(raw.get("changes"), list):
        for change in raw["changes"]:
            if not isinstance(change, dict):
                continue
            ids = change.get("issueIds", change.get("issue_ids"))
            if (isinstance(ids, list) and ids
                    and all(isinstance(i, str) and i in known_issue_dimensions for i in ids)):
                dimensions = {known_issue_dimensions[i] for i in ids}
                if len(dimensions) == 1 and change.get("dimension") in RESUME_EVALUATION_DIMENSION_NAMES:
                    change["dimension"] = next(iter(dimensions))
    plan = normalize_optimization_plan(
        raw,
        known_issue_dimensions=known_issue_dimensions,
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
    # Choices are UI controls, not model-generated claims awaiting confirmation.
    # Free text remains available, but unsupported example achievements cannot be
    # accepted by clicking a suggested answer.
    for question in plan.questions:
        question.choices = [
            OptimizationQuestionChoice(value="no_data", label="暂无可确认的信息"),
        ]
    plan = reconcile_coverage(plan, context)
    bind_cleanup_fallbacks(plan, cleanup_raw, context)
    return _protect_private_target_changes(plan, context)


@runtime_budget.ai_wall_clock_limited
async def plan_resume_optimization(context: FrozenOptimizationContext) -> OptimizationPlan:
    from .planner_tasks import build_tasks, task_payload, task_schema, assemble_plan, TASK_PROMPT
    tasks, retained = build_tasks(context)
    if tasks:
        payload = _scrub_human_text(
            {"targetRole": context.target_role, "tasks": task_payload(tasks)},
            _collect_profile_values(context.current_resume),
        )
        schema = task_schema(tasks)
        raw = await _bounded_model_call(
            _messages(system_prompt=TASK_PROMPT + '\nOUTPUT_JSON_SCHEMA:\n' + json.dumps(schema, ensure_ascii=False), payload=payload), json_mode=True,
            request_label="resume_optimization_plan", gemini_thinking_level="low", gemini_stream=True,
            gemini_response_json_schema=schema,
        )
    else:
        raw = {}
    return _protect_private_target_changes(assemble_plan(raw, tasks, retained, context), context)


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
    source_documents = {
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
    profile_values = _collect_profile_values(current_resume)
    _scrub_named_text_fields(
        current_document,
        text_keys=_RESUME_TEXT_KEYS,
        profile_values=profile_values,
    )
    _scrub_skill_category_text(current_document, profile_values)
    _scrub_named_text_fields(
        selected_document,
        text_keys=_RESUME_TEXT_KEYS,
        profile_values=profile_values,
    )
    _scrub_skill_category_text(selected_document, profile_values)
    return source_documents


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
    locally_protected_changes: list[OptimizationChange] = []
    model_affected_changes: list[OptimizationChange] = []
    for change in affected_changes:
        frozen_before = _frozen_mutable_text_value(context, change)
        private_original = _private_target_original_value(context, change)
        has_answered_fact = any(
            answer.state.value == "answered"
            and change.change_id in questions_by_id[question_id].affects_change_ids
            for question_id, answer in answers_by_question.items()
        )
        if not has_answered_fact:
            states = {answer.state.value for question_id, answer in answers_by_question.items()
                      if change.change_id in questions_by_id[question_id].affects_change_ids}
            fallback = existing_plan.cleanup_fallbacks.get(change.change_id)
            if (states and states <= {"no_data", "unknown"} and fallback is not None
                    and change.safety_status != "blocked"
                    and private_original is None and frozen_before == fallback.before_value
                    and (fallback.module_id, fallback.field_path) == (change.module_id, change.field_path)):
                locally_protected_changes.append(fallback.model_copy(deep=True, update={
                    "safety_status": "pending", "safety_findings": [], "semantic_review": None,
                }))
                continue
            # Absence of new facts is a local state transition, not a generation
            # task. Preserve identity and never turn no_data into evidence.
            locally_protected_changes.append(change.model_copy(deep=True, update={
                "action_kind": OptimizationAction.LEAVE_UNCHANGED,
                "general_value": None, "targeted_value": None,
                "source_refs": [], "introduced_terms": [],
                "rationale": "未补充可确认的事实，保留原文。",
                "expected_score_gain": 0, "safety_status": "pending",
                "safety_findings": [], "semantic_review": None,
            }))
        elif private_original is not None:
            locally_protected_changes.append(
                _local_leave_unchanged_change(
                    change,
                    original_value=private_original,
                    rationale="目标字段含个人信息，已保持原文不变。",
                )
            )
        elif frozen_before is not None and change.before_value != frozen_before:
            locally_protected_changes.append(
                _local_leave_unchanged_change(
                    change,
                    original_value=frozen_before,
                    rationale="该变更与当前简历不一致，已保持原文不变。",
                )
            )
        else:
            model_affected_changes.append(change)
    if not model_affected_changes:
        protected_by_id = {
            change.change_id: change for change in locally_protected_changes
        }
        return [protected_by_id[change.change_id] for change in affected_changes]

    model_change_ids = {change.change_id for change in model_affected_changes}
    model_answers_by_question = {
        question_id: answer
        for question_id, answer in answers_by_question.items()
        if any(
            change_id in model_change_ids
            for change_id in questions_by_id[question_id].affects_change_ids
        )
    }
    affected_module_ids = {
        change.module_id for change in model_affected_changes
    }
    answer_question_modules = {
        question_id: questions_by_id[question_id].module_id
        for question_id in model_answers_by_question
    }
    answer_states = {
        question_id: answer.state.value
        for question_id, answer in model_answers_by_question.items()
    }
    answer_change_ids = {
        question_id: frozenset(
            change_id
            for change_id in questions_by_id[question_id].affects_change_ids
            if change_id in model_change_ids
        )
        for question_id in model_answers_by_question
    }
    source_documents = _answer_source_documents(
        context,
        affected_module_ids,
        model_answers_by_question,
    )
    question_aliases = {
        question_id: f"QUESTION_{index:03d}"
        for index, question_id in enumerate(model_answers_by_question, start=1)
    }
    question_alias_to_original = {
        alias: question_id for question_id, alias in question_aliases.items()
    }
    model_source_documents = deepcopy(source_documents)
    model_source_documents["userAnswers"] = {
        question_aliases[question_id]: value
        for question_id, value in source_documents["userAnswers"].items()
    }
    issue_aliases = _planner_issue_id_aliases(context.evaluation)
    issue_alias_to_original = {
        alias: issue_id for issue_id, alias in issue_aliases.items()
    }
    change_aliases = {
        change.change_id: f"CHANGE_{index:03d}"
        for index, change in enumerate(model_affected_changes, start=1)
    }
    change_alias_to_original = {
        alias: change_id for change_id, alias in change_aliases.items()
    }
    payload = {
        "affectedModuleIds": sorted(affected_module_ids),
        "affectedChangeIds": [
            change_aliases[change.change_id] for change in model_affected_changes
        ],
        "affectedChanges": _aliased_change_payloads(
            model_affected_changes,
            context,
            issue_aliases,
            change_aliases,
        ),
        "submittedAnswers": [
            {
                **answer.model_dump(mode="json"),
                "question_id": question_aliases[answer.question_id],
            }
            for answer in answers
            if answer.question_id in model_answers_by_question
        ],
        "sourceDocuments": model_source_documents,
        "allowedSourceRoots": list(_ALLOWED_SOURCE_ROOTS),
    }
    try:
        raw = await _bounded_model_call(
            _messages(
                system_prompt=ANSWER_REWRITE_SYSTEM_PROMPT,
                payload=payload,
            ),
            json_mode=True,
            request_label="resume_optimization_answer",
            gemini_thinking_level="low",
            gemini_stream=True,
            gemini_response_json_schema=_answer_patch_schema(model_source_documents,list(change_aliases.values())),
        )
        raw = _restore_user_answer_source_refs(raw, question_alias_to_original)
        raw = _restore_planner_change_ids(raw, change_alias_to_original)
        raw = _restore_planner_issue_ids(raw, issue_alias_to_original)
        normalized_changes = normalize_answered_optimization_changes(
            raw,
            expected_changes=model_affected_changes,
            selected_master_ids=set(context.selected_master_experience_ids),
            selected_skill_ids=_selected_skill_ids(context),
            current_section_order=_current_section_order(context),
            source_documents=source_documents,
            answer_question_modules=answer_question_modules,
            answer_states=answer_states,
            answer_change_ids=answer_change_ids,
            known_issue_dimensions=_known_issue_dimensions(context.evaluation),
        )
        protected_model_changes = _protect_private_target_changes(
            OptimizationPlan(changes=normalized_changes),
            context,
        ).changes
        combined_by_id = {
            change.change_id: change
            for change in [*locally_protected_changes, *protected_model_changes]
        }
        return [combined_by_id[change.change_id] for change in affected_changes]
    except (AiProviderPayloadError, OptimizationPlanNormalizationError) as exc:
        raise OptimizationAnswerRewriteNormalizationError() from exc
