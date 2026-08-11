import asyncio
import copy
import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import HTTPException
from starlette.status import HTTP_504_GATEWAY_TIMEOUT

from .llm_transport import LANE_DEFAULT, _call_llm, _emit_thought
from .prompts import RESUME_EVALUATION, RESUME_EVALUATION_ISSUE_REPAIR
from .resume_evaluation import (
    DIMENSION_NAMES,
    _DIMENSION_ALIASES,
    normalize_resume_evaluation,
)


logger = logging.getLogger(__name__)

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
_LEGACY_NON_FACT_KEYS = {
    "id",
    "user_id",
    "master_id",
    "source_id",
    "created_at",
    "updated_at",
}
_REPAIR_TIMEOUT_SECONDS = 75.0
_TOTAL_TIMEOUT_SECONDS = 150.0
_CROSS_PRIMARY_ISSUE_ERROR_PREFIX = (
    "the same issue description cannot use multiple primary dimensions:"
)
_COMPACT_REPAIR_MAX_ISSUES = 60
_COMPACT_REPAIR_MAX_PRIORITIES = 20
_COMPACT_REPAIR_MAX_REFS = 30
_COMPACT_REPAIR_MAX_ID_CHARS = 128
_COMPACT_REPAIR_MAX_TEXT_CHARS = 1200
def _parse_resume_object(resume_text: Optional[str]) -> Optional[Dict[str, Any]]:
    if not resume_text:
        return None
    try:
        value = json.loads(resume_text)
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _build_legacy_fact_metadata(resume: Any) -> List[Dict[str, Any]]:
    facts: List[Dict[str, Any]] = []

    def visit(value: Any, source: str, field_name: str = "") -> None:
        if field_name in _LEGACY_NON_FACT_KEYS:
            return
        if isinstance(value, dict):
            for key, item in value.items():
                visit(item, f"{source}.{key}", str(key))
            return
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{source}[{index}]", field_name)
            return
        if isinstance(value, bool) or value is None:
            return
        content = str(value).strip()
        if not content:
            return
        facts.append(
            {
                "fact_id": f"LEGACY_FACT_{len(facts) + 1:03d}",
                "content": content,
                "verification_status": "user_claimed",
                "source": source,
                "confidence": 1,
            }
        )

    visit(resume, "resume")
    return facts


def _build_full_resume_evaluation_input(
    jd_text: str,
    resume_text: Optional[str],
    canonical_jd_match: Optional[int] = None,
) -> Dict[str, Any]:
    parsed = _parse_resume_object(resume_text)
    if parsed and parsed.get("evaluation_scope") == "full_resume":
        evaluation_input = dict(parsed)
        evaluation_input["jd_text"] = jd_text
        if "fact_metadata" not in evaluation_input:
            evaluation_input["fact_metadata"] = _build_legacy_fact_metadata(
                evaluation_input.get("resume")
            )
    else:
        legacy_resume: Any = parsed if parsed is not None else {"raw_text": resume_text or ""}
        legacy_experiences = (
            legacy_resume.get("experiences", [])
            if isinstance(legacy_resume, dict)
            else []
        )
        legacy_certifications = (
            legacy_resume.get("certifications", [])
            if isinstance(legacy_resume, dict)
            else []
        )
        legacy_skills = (
            legacy_resume.get("skills", [])
            if isinstance(legacy_resume, dict)
            else []
        )
        evaluation_input = {
            "evaluation_scope": "full_resume",
            "target_role": "",
            "jd_text": jd_text,
            "resume": legacy_resume,
            "experience_atoms": legacy_experiences,
            "match_candidates": {
                "certifications": legacy_certifications,
                "skills": legacy_skills,
            },
            "fact_metadata": _build_legacy_fact_metadata(legacy_resume),
        }
    if canonical_jd_match is not None:
        evaluation_input["canonical_jd_match"] = canonical_jd_match
    else:
        evaluation_input.pop("canonical_jd_match", None)
    return evaluation_input


def _fact_metadata_for_input(evaluation_input: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = evaluation_input.get("fact_metadata")
    if not isinstance(raw, list):
        raise ValueError("full_resume fact_metadata must be an array")
    return raw


def _build_messages(evaluation_input: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {"role": "system", "content": RESUME_EVALUATION},
        {
            "role": "user",
            "content": (
                "Full Resume Evaluation Input (JSON):\n"
                f"{json.dumps(evaluation_input, ensure_ascii=False)}"
            ),
        },
    ]


def _normalize_response(
    result: Any,
    *,
    jd_available: bool,
    fact_metadata: List[Dict[str, Any]],
    canonical_jd_match: Optional[int],
) -> Dict[str, Any]:
    if (
        isinstance(result, list)
        and len(result) == 1
        and isinstance(result[0], dict)
    ):
        result = result[0]
    if not isinstance(result, dict):
        raise ValueError("resume evaluation result must be an object")
    raw_evaluation = result.get("resumeEvaluation")
    if raw_evaluation is None:
        raw_evaluation = result.get("resume_evaluation")
    if not isinstance(raw_evaluation, dict):
        raise ValueError("resume evaluation result is missing resumeEvaluation")
    normalized_raw = dict(raw_evaluation)
    if jd_available and canonical_jd_match is not None:
        normalized_raw["jdMatch"] = canonical_jd_match
        normalized_raw.pop("jd_match", None)
    evaluation = normalize_resume_evaluation(
        normalized_raw,
        jd_available=jd_available,
        fact_metadata=fact_metadata,
    )
    return {"resumeEvaluation": evaluation}


async def _repair_resume_evaluation(
    result: Any,
    *,
    validation_error: ValueError,
    fact_metadata: List[Dict[str, Any]],
    jd_available: bool,
    canonical_jd_match: Optional[int],
) -> Dict[str, Any]:
    if isinstance(result, dict):
        invalid_evaluation = result.get("resumeEvaluation")
        if invalid_evaluation is None:
            invalid_evaluation = result.get("resume_evaluation")
    else:
        invalid_evaluation = result
    repair_payload = {
        "validation_error": str(validation_error),
        "jd_available": jd_available,
        "canonical_jd_match": canonical_jd_match,
        "fact_metadata": fact_metadata,
        "invalid_resume_evaluation": invalid_evaluation,
    }
    messages = [
        {"role": "system", "content": RESUME_EVALUATION},
        {
            "role": "user",
            "content": (
                "Repair only the resumeEvaluation object in this compact payload. Return the normal wrapper "
                "with one top-level resumeEvaluation key and no explanation or Markdown.\n"
                f"{json.dumps(repair_payload, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        return await asyncio.wait_for(
            _call_llm(
                messages,
                json_mode=True,
                request_label="resume_evaluation_repair",
                lane=LANE_DEFAULT,
                gemini_thinking_level="minimal",
            ),
            timeout=_REPAIR_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail="Resume evaluation repair exceeded its 75-second safety limit. Please retry the deep report.",
        ) from exc


def _raw_resume_evaluation(result: Any) -> Optional[Dict[str, Any]]:
    if (
        isinstance(result, list)
        and len(result) == 1
        and isinstance(result[0], dict)
    ):
        result = result[0]
    if not isinstance(result, dict):
        return None
    evaluation = result.get("resumeEvaluation")
    if evaluation is None:
        evaluation = result.get("resume_evaluation")
    return evaluation if isinstance(evaluation, dict) else None


def _bounded_repair_string(value: Any, maximum: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    return value.strip()[:maximum]


def _bounded_repair_string_list(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    return [
        value
        for item in raw[:_COMPACT_REPAIR_MAX_REFS]
        if (value := _bounded_repair_string(item, _COMPACT_REPAIR_MAX_ID_CHARS))
    ]


def _bounded_repair_score(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        normalized = value
    elif isinstance(value, float) and value.is_integer():
        normalized = int(value)
    else:
        return None
    return max(0, min(100, normalized))


def _bounded_repair_integer(value: Any, *, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return max(-1000, min(1000, value))
    if isinstance(value, float) and value.is_integer():
        return max(-1000, min(1000, int(value)))
    return default


def _project_compact_issue(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_points = item.get("pointsNotEarned")
    points = max(0, min(100, _bounded_repair_integer(raw_points)))
    return {
        "issueId": _bounded_repair_string(item.get("issueId"), _COMPACT_REPAIR_MAX_ID_CHARS),
        "description": _bounded_repair_string(item.get("description"), _COMPACT_REPAIR_MAX_TEXT_CHARS),
        "primaryDimension": _bounded_repair_string(item.get("primaryDimension"), _COMPACT_REPAIR_MAX_ID_CHARS),
        "relatedDimensions": _bounded_repair_string_list(item.get("relatedDimensions")),
        "evidenceIds": _bounded_repair_string_list(item.get("evidenceIds")),
        "severity": _bounded_repair_string(item.get("severity"), 32),
        "pointsNotEarned": points,
    }


def _project_compact_priority(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_priority = item.get("priority")
    raw_gain = item.get("expectedScoreGain")
    return {
        "priority": _bounded_repair_integer(raw_priority),
        "action": _bounded_repair_string(item.get("action"), _COMPACT_REPAIR_MAX_TEXT_CHARS),
        "issueId": _bounded_repair_string(item.get("issueId"), _COMPACT_REPAIR_MAX_ID_CHARS),
        "expectedScoreGain": _bounded_repair_integer(raw_gain),
    }


def _compact_issue_repair_payload(
    result: Any,
    *,
    validation_error: ValueError,
) -> Dict[str, Any]:
    evaluation = _raw_resume_evaluation(result)
    if evaluation is None:
        raise ValueError("cross-primary issue repair requires a resumeEvaluation object")
    dimension_summaries: List[Dict[str, Any]] = []
    summarized_dimensions: set[str] = set()
    raw_dimensions = evaluation.get("dimensions")
    if isinstance(raw_dimensions, list):
        for raw_dimension in raw_dimensions[:24]:
            if not isinstance(raw_dimension, dict):
                continue
            raw_name = raw_dimension.get("dimension")
            if not isinstance(raw_name, str):
                continue
            name = _DIMENSION_ALIASES.get(raw_name, raw_name)
            if name not in DIMENSION_NAMES or name in summarized_dimensions:
                continue
            summarized_dimensions.add(name)
            subscore_summaries: List[Dict[str, Any]] = []
            raw_subscores = raw_dimension.get("subscores")
            if isinstance(raw_subscores, list):
                for raw_subscore in raw_subscores[:12]:
                    if not isinstance(raw_subscore, dict):
                        continue
                    subscore_summaries.append(
                        {
                            "name": _bounded_repair_string(
                                raw_subscore.get("name"),
                                _COMPACT_REPAIR_MAX_ID_CHARS,
                            ),
                            "maxScore": _bounded_repair_score(raw_subscore.get("maxScore")),
                            "score": _bounded_repair_score(raw_subscore.get("score")),
                        }
                    )
            raw_issue_ids = raw_dimension.get("issues")
            issue_ids = (
                _bounded_repair_string_list(raw_issue_ids)
                if isinstance(raw_issue_ids, list)
                else []
            )
            dimension_summaries.append(
                {
                    "dimension": name,
                    "score": _bounded_repair_score(raw_dimension.get("score")),
                    "subscores": subscore_summaries,
                    "issueIds": issue_ids,
                }
            )
    raw_evidence = evaluation.get("evidence")
    valid_evidence_ids = (
        [
            _bounded_repair_string(
                item.get("evidenceId"),
                _COMPACT_REPAIR_MAX_ID_CHARS,
            )
            for item in raw_evidence
            if isinstance(item, dict)
            and isinstance(item.get("evidenceId"), str)
            and item.get("evidenceId").strip()
        ]
        if isinstance(raw_evidence, list)
        else []
    )
    raw_issues = evaluation.get("issues")
    raw_priorities = evaluation.get("topPriorities")
    return {
        "validation_error": str(validation_error)[:_COMPACT_REPAIR_MAX_TEXT_CHARS],
        "dimensions": dimension_summaries,
        "issues": [
            _project_compact_issue(item)
            for item in (
                raw_issues[:_COMPACT_REPAIR_MAX_ISSUES]
                if isinstance(raw_issues, list)
                else []
            )
            if isinstance(item, dict)
        ],
        "topPriorities": [
            _project_compact_priority(item)
            for item in (
                raw_priorities[:_COMPACT_REPAIR_MAX_PRIORITIES]
                if isinstance(raw_priorities, list)
                else []
            )
            if isinstance(item, dict)
        ],
        "validEvidenceIds": list(dict.fromkeys(valid_evidence_ids))[
            :_COMPACT_REPAIR_MAX_REFS
        ],
    }


async def _repair_cross_primary_issues(
    result: Any,
    *,
    validation_error: ValueError,
) -> Any:
    repair_payload = _compact_issue_repair_payload(
        result,
        validation_error=validation_error,
    )
    messages = [
        {"role": "system", "content": RESUME_EVALUATION_ISSUE_REPAIR},
        {
            "role": "user",
            "content": (
                "Repair this compact issue taxonomy payload only.\n"
                f"{json.dumps(repair_payload, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        return await asyncio.wait_for(
            _call_llm(
                messages,
                json_mode=True,
                request_label="resume_evaluation_issue_repair",
                lane=LANE_DEFAULT,
                gemini_thinking_level="minimal",
            ),
            timeout=_REPAIR_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail="Resume evaluation repair exceeded its 75-second safety limit. Please retry the deep report.",
        ) from exc


def _apply_cross_primary_issue_repair(
    result: Any,
    repair_result: Any,
) -> Dict[str, Any]:
    evaluation = _raw_resume_evaluation(result)
    if evaluation is None:
        raise ValueError("cross-primary issue repair requires a resumeEvaluation object")
    if not isinstance(repair_result, dict) or set(repair_result) != {"issueRepair"}:
        raise ValueError("issue repair result must contain exactly one issueRepair object")
    issue_repair = repair_result.get("issueRepair")
    if not isinstance(issue_repair, dict) or set(issue_repair) != {
        "issues",
        "dimensionIssueIds",
        "topPriorities",
    }:
        raise ValueError("issueRepair must contain issues, dimensionIssueIds, and topPriorities")
    issues = issue_repair.get("issues")
    priorities = issue_repair.get("topPriorities")
    dimension_issue_ids = issue_repair.get("dimensionIssueIds")
    if not isinstance(issues, list) or not all(isinstance(item, dict) for item in issues):
        raise ValueError("issueRepair.issues must be an array of objects")
    if not isinstance(priorities, list) or not all(isinstance(item, dict) for item in priorities):
        raise ValueError("issueRepair.topPriorities must be an array of objects")
    if not isinstance(dimension_issue_ids, dict) or set(dimension_issue_ids) != set(DIMENSION_NAMES):
        raise ValueError("issueRepair.dimensionIssueIds must contain all six fixed dimensions")
    for dimension_name, issue_ids in dimension_issue_ids.items():
        if not isinstance(issue_ids, list) or not all(isinstance(item, str) for item in issue_ids):
            raise ValueError(f"issueRepair.dimensionIssueIds.{dimension_name} must be an array of strings")

    repaired_evaluation = copy.deepcopy(evaluation)
    raw_dimensions = repaired_evaluation.get("dimensions")
    if not isinstance(raw_dimensions, list):
        raise ValueError("resumeEvaluation.dimensions must be an array")
    updated_dimensions: set[str] = set()
    for raw_dimension in raw_dimensions:
        if not isinstance(raw_dimension, dict):
            raise ValueError("resumeEvaluation.dimensions entries must be objects")
        raw_name = raw_dimension.get("dimension")
        if not isinstance(raw_name, str):
            raise ValueError("resumeEvaluation dimension names must be strings")
        name = _DIMENSION_ALIASES.get(raw_name, raw_name)
        if name not in DIMENSION_NAMES or name in updated_dimensions:
            raise ValueError("resumeEvaluation.dimensions must contain six unique fixed dimensions")
        raw_dimension["issues"] = copy.deepcopy(dimension_issue_ids[name])
        updated_dimensions.add(name)
    if updated_dimensions != set(DIMENSION_NAMES):
        raise ValueError("resumeEvaluation.dimensions must contain all six fixed dimensions")
    repaired_evaluation["issues"] = copy.deepcopy(issues)
    repaired_evaluation["topPriorities"] = copy.deepcopy(priorities)
    return {"resumeEvaluation": repaired_evaluation}


async def _finalize_with_one_repair(
    result: Any,
    *,
    fact_metadata: List[Dict[str, Any]],
    jd_available: bool,
    canonical_jd_match: Optional[int],
) -> Dict[str, Any]:
    try:
        return _normalize_response(
            result,
            jd_available=jd_available,
            fact_metadata=fact_metadata,
            canonical_jd_match=canonical_jd_match,
        )
    except ValueError as first_error:
        logger.warning(
            "Resume evaluation validation failed; requesting one compact repair: %s",
            first_error,
        )
        if str(first_error).startswith(_CROSS_PRIMARY_ISSUE_ERROR_PREFIX):
            issue_repair = await _repair_cross_primary_issues(
                result,
                validation_error=first_error,
            )
            try:
                repaired = _apply_cross_primary_issue_repair(result, issue_repair)
            except ValueError as repair_error:
                raise ValueError(
                    f"Invalid resume evaluation structure after one repair attempt: {repair_error}"
                ) from repair_error
        else:
            repaired = await _repair_resume_evaluation(
                result,
                validation_error=first_error,
                fact_metadata=fact_metadata,
                jd_available=jd_available,
                canonical_jd_match=canonical_jd_match,
            )
        try:
            return _normalize_response(
                repaired,
                jd_available=jd_available,
                fact_metadata=fact_metadata,
                canonical_jd_match=canonical_jd_match,
            )
        except ValueError as repair_error:
            raise ValueError(
                f"Invalid resume evaluation structure after one repair attempt: {repair_error}"
            ) from repair_error


async def _run_with_total_timeout(
    operation: Awaitable[Dict[str, Any]],
) -> Dict[str, Any]:
    try:
        async with asyncio.timeout(_TOTAL_TIMEOUT_SECONDS):
            return await operation
    except TimeoutError as exc:
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail="Resume evaluation exceeded its 150-second safety limit. Please retry the deep report.",
        ) from exc


async def _analyze_resume_evaluation_once(
    text: str,
    resume_text: Optional[str],
    jd_match_percentage: Optional[int] = None,
) -> Dict[str, Any]:
    evaluation_input = _build_full_resume_evaluation_input(
        text,
        resume_text,
        jd_match_percentage,
    )
    fact_metadata = _fact_metadata_for_input(evaluation_input)
    result = await _call_llm(
        _build_messages(evaluation_input),
        json_mode=True,
        request_label="resume_evaluation",
        lane=LANE_DEFAULT,
        gemini_thinking_level="low",
    )
    return await _finalize_with_one_repair(
        result,
        fact_metadata=fact_metadata,
        jd_available=bool(text.strip()),
        canonical_jd_match=jd_match_percentage,
    )


async def analyze_resume_evaluation(
    text: str,
    resume_text: Optional[str],
    jd_match_percentage: Optional[int] = None,
) -> Dict[str, Any]:
    return await _run_with_total_timeout(
        _analyze_resume_evaluation_once(
            text,
            resume_text,
            jd_match_percentage,
        )
    )


async def _analyze_resume_evaluation_with_thoughts_once(
    text: str,
    resume_text: Optional[str],
    jd_match_percentage: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    await _emit_thought(
        thought_callback,
        {"type": "thought", "summary": "正在生成六维简历报告"},
    )
    return await _analyze_resume_evaluation_once(
        text,
        resume_text,
        jd_match_percentage,
    )


async def analyze_resume_evaluation_with_thoughts(
    text: str,
    resume_text: Optional[str],
    jd_match_percentage: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    return await _run_with_total_timeout(
        _analyze_resume_evaluation_with_thoughts_once(
            text,
            resume_text,
            jd_match_percentage,
            thought_callback,
        )
    )
