import asyncio
import copy
import json
import logging
import re
import httpx
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import HTTPException
from starlette.status import HTTP_504_GATEWAY_TIMEOUT

from .llm_transport import LANE_DEFAULT, _call_llm, _emit_thought
from .public_errors import (
    AiProviderPayloadError,
    AiProviderUnavailableError,
    ResumeEvaluationIntegrityError,
)
from .response_diagnostics import safe_body_log_summary
from .prompts import (
    RESUME_EVALUATION,
    RESUME_EVALUATION_EVIDENCE_REPAIR,
    RESUME_EVALUATION_ISSUE_REPAIR,
)
from .resume_evaluation import (
    DIMENSION_NAMES,
    DIMENSION_SUBSCORES,
    _DIMENSION_ALIASES,
    normalize_resume_evaluation,
)
from .resume_evaluation_calibration import calibrate_evaluation
from .resume_evaluation import SCORING_VERSION
from .resume_evaluation_consensus import select_central_evaluation, evaluation_dispersion, diagnostic_sink
from .runtime_budget import AiRuntimeTimeoutError


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
_CONSENSUS_SAMPLE_COUNT = 3
_CONSENSUS_MAX_ATTEMPTS = 5
_CONSENSUS_GENERATION_TIMEOUT_SECONDS = 40.0
_CROSS_PRIMARY_ISSUE_ERROR_PREFIX = (
    "the same issue description cannot use multiple primary dimensions:"
)
_COMPACT_REPAIR_MAX_ISSUES = 60
_COMPACT_REPAIR_MAX_PRIORITIES = 20
_COMPACT_REPAIR_MAX_REFS = 30
_COMPACT_REPAIR_MAX_ID_CHARS = 128
_COMPACT_REPAIR_MAX_TEXT_CHARS = 1200


def _strict_object_schema(
    properties: Dict[str, Any],
    *,
    required: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required if required is not None else list(properties),
        "additionalProperties": False,
    }


def _string_array_schema() -> Dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}}


_ALL_SUBSCORE_NAMES = [
    name
    for _dimension_name, subscores in DIMENSION_SUBSCORES
    for name, _maximum in subscores
]
_EVIDENCE_SCHEMA = _strict_object_schema(
    {
        "evidenceId": {"type": "string"},
        "sourceText": {"type": "string"},
        "location": {"type": "string"},
        "factId": {"type": "string"},
        "verificationStatus": {
            "type": "string",
            "enum": ["verified", "user_claimed", "unverified", "inferred"],
        },
        "supportedDimensions": {
            "type": "array",
            "items": {"type": "string", "enum": list(DIMENSION_NAMES)},
        },
    }
)
_ISSUE_SCHEMA = _strict_object_schema(
    {
        "issueId": {"type": "string"},
        "description": {"type": "string"},
        "primaryDimension": {"type": "string", "enum": list(DIMENSION_NAMES)},
        "relatedDimensions": {
            "type": "array",
            "items": {"type": "string", "enum": list(DIMENSION_NAMES)},
        },
        "evidenceIds": _string_array_schema(),
        "severity": {"type": "string", "enum": ["high", "medium", "low"]},
        "pointsNotEarned": {"type": "integer", "minimum": 0, "maximum": 100},
    }
)
_PRIORITY_SCHEMA = _strict_object_schema(
    {
        "priority": {"type": "integer", "minimum": 1},
        "issueId": {"type": "string"},
        "action": {"type": "string"},
        "expectedScoreGain": {"type": "integer"},
    }
)
_RESUME_EVALUATION_RESPONSE_SCHEMA = _strict_object_schema(
    {
        "resumeEvaluation": _strict_object_schema(
            {
                "evaluationVersion": {
                    "type": "string",
                    "enum": ["resume_flow_v1"],
                },
                "evaluationScope": {"type": "string", "enum": ["full_resume"]},
                "targetRole": {"type": "string"},
                "overallScore": {"type": "integer", "minimum": 0, "maximum": 100},
                "overallLevel": {"type": "string"},
                "evaluationConfidence": {"type": "number", "minimum": 0, "maximum": 1},
                "scoreCalculation": _strict_object_schema(
                    {
                        "dimensionSum": {"type": "integer", "minimum": 0, "maximum": 600},
                        "rawAverage": {"type": "number", "minimum": 0, "maximum": 100},
                        "roundingRule": {"type": "string", "enum": ["round_half_up"]},
                        "finalScore": {"type": "integer", "minimum": 0, "maximum": 100},
                    }
                ),
                "dimensions": {
                    "type": "array",
                    "minItems": 6,
                    "maxItems": 6,
                    "items": _strict_object_schema(
                        {
                            "dimension": {"type": "string", "enum": list(DIMENSION_NAMES)},
                            "score": {"type": "integer", "minimum": 0, "maximum": 100},
                            "level": {"type": "string"},
                            "subscores": {
                                "type": "array",
                                "items": {"anyOf": [
                                    _strict_object_schema({
                                        "name": {"type": "string", "enum": [name]},
                                        "maxScore": {"type": "integer", "enum": [maximum]},
                                        "score": {"type": "integer", "minimum": 0, "maximum": maximum},
                                        "evidenceIds": _string_array_schema(),
                                    })
                                    for _, specs in DIMENSION_SUBSCORES
                                    for name, maximum in specs
                                ]},
                            },
                            "strengths": _string_array_schema(),
                            "issues": _string_array_schema(),
                            "improvementQuestions": _string_array_schema(),
                        }
                    ),
                },
                "evidence": {"type": "array", "items": _EVIDENCE_SCHEMA},
                "issues": {"type": "array", "items": _ISSUE_SCHEMA},
                "missingInformation": {
                    "type": "array",
                    "items": _strict_object_schema(
                        {
                            "field": {"type": "string"},
                            "reason": {"type": "string"},
                            "question": {"type": "string"},
                            "potentialDimension": {
                                "type": "string",
                                "enum": ["", *DIMENSION_NAMES],
                            },
                            "potentialScoreGain": {"type": "integer"},
                        }
                    ),
                },
                "riskFlags": {
                    "type": "array",
                    "items": _strict_object_schema(
                        {
                            "type": {
                                "type": "string",
                                "enum": [
                                    "unverified_fact",
                                    "inferred_fact",
                                    "exaggerated_claim",
                                    "conflicting_date",
                                    "duplicated_content",
                                ],
                            },
                            "description": {"type": "string"},
                            "evidenceIds": _string_array_schema(),
                        }
                    ),
                },
                "topPriorities": {"type": "array", "items": _PRIORITY_SCHEMA},
                "jdMatch": {"type": ["integer", "null"], "minimum": 0, "maximum": 100},
            }
        )
    }
)
# Only new generation uses deduction bindings; stored/public reports keep their schema.
_GENERATION_RESPONSE_SCHEMA = copy.deepcopy(_RESUME_EVALUATION_RESPONSE_SCHEMA)
for _sub_schema in _GENERATION_RESPONSE_SCHEMA["properties"]["resumeEvaluation"]["properties"]["dimensions"]["items"]["properties"]["subscores"]["items"]["anyOf"]:
    _sub_schema["properties"]["deductionIssueId"] = {"type": "string"}
    _sub_schema["required"].append("deductionIssueId")


def _materialize_generation_deductions(result, *, require_bindings=False):
    output = copy.deepcopy(result)
    evaluation = output.get("resumeEvaluation", {}) if isinstance(output, dict) else {}
    dimensions = evaluation.get("dimensions", [])
    subs = [sub for d in dimensions for sub in d.get("subscores", [])]
    # Legacy mocked/stored reports have no binding; never reinterpret their deductions.
    if not any("deductionIssueId" in sub for sub in subs):
        if require_bindings:
            raise ValueError("resumeEvaluation.dimensions.subscores missing deduction bindings")
        return output
    issues = evaluation.get("issues", [])
    issue_map = {issue["issueId"]: issue for issue in issues}
    if len(issue_map) != len(issues):
        raise ValueError("resumeEvaluation.issues duplicate issue ID")
    points = {key: 0 for key in issue_map}
    for dimension in dimensions:
        name = dimension.get("dimension")
        specifications = dict(dict(DIMENSION_SUBSCORES).get(name, ()))
        for sub in dimension.get("subscores", []):
            maximum = specifications.get(sub.get("name"))
            score = sub.get("score")
            if maximum is None or type(score) is not int or not 0 <= score <= maximum:
                raise ValueError("resumeEvaluation.dimensions.subscores invalid score")
            binding = sub.pop("deductionIssueId", None)
            gap = maximum - score
            if not gap:
                if binding != "":
                    raise ValueError("resumeEvaluation.dimensions.subscores full score has deduction")
                continue
            issue = issue_map.get(binding)
            if issue is None or issue.get("primaryDimension") != name:
                raise ValueError("resumeEvaluation.dimensions.subscores unknown deduction reference")
            if name == "专业表达" and not issue.get("evidenceIds"):
                raise ValueError("resumeEvaluation.issues professional deduction lacks evidence")
            points[binding] += gap
    for identity, issue in issue_map.items():
        if points[identity] == 0:
            raise ValueError("resumeEvaluation.issues unbound deduction")
        issue["pointsNotEarned"] = points[identity]
    return output


def _record_evaluation_diagnostic(stage, category, field=None, **counts):
    record = {"stage": stage, "category": category, **counts}
    if field:
        record["field"] = field
    sink = diagnostic_sink.get()
    if sink is not None:
        sink.append(record)
    logger.info("Evaluation diagnostic: %s", record)


def _validation_diagnostic(exc):
    # Never log the exception text: it may embed provider text or resume PII.
    basis_code = getattr(exc, 'basis_diagnostic_code', None)
    if isinstance(basis_code, str) and re.fullmatch(r'basis_[a-z_]{1,80}', basis_code):
        return basis_code, 'resumeEvaluation.evidenceBasis'
    message = str(exc)
    contract_codes = {
        'resumeEvaluation.dimensions.subscores full score has deduction': 'deduction_full_score_has_issue',
        'resumeEvaluation.dimensions.subscores unknown deduction reference': 'deduction_unknown_reference',
        'resumeEvaluation.issues professional deduction lacks evidence': 'deduction_missing_evidence',
        'resumeEvaluation.issues unbound deduction': 'deduction_orphan_issue',
        'resumeEvaluation.dimensions.subscores missing deduction bindings': 'deduction_missing_binding',
    }
    if message in contract_codes:
        return contract_codes[message], 'resumeEvaluation.dimensions.subscores'
    category = "reference" if any(x in message.lower() for x in ("reference", "evidence", "factid")) else "score_contract"
    match = re.search(r"resumeEvaluation\.(dimensions|issues|evidence|riskFlags|topPriorities|evaluationConfidence)(?:\[\d+\])?", message)
    return category, match[0] if match else "resumeEvaluation"


_ISSUE_REPAIR_RESPONSE_SCHEMA = _strict_object_schema(
    {
        "issueRepair": _strict_object_schema(
            {
                "issues": {"type": "array", "items": _ISSUE_SCHEMA},
                "dimensionIssueIds": _strict_object_schema(
                    {name: _string_array_schema() for name in DIMENSION_NAMES}
                ),
                "topPriorities": {"type": "array", "items": _PRIORITY_SCHEMA},
            }
        )
    }
)
_EVIDENCE_REPAIR_RESPONSE_SCHEMA = _strict_object_schema(
    {
        "evidenceRepair": _strict_object_schema(
            {
                "evidence": {"type": "array", "items": _EVIDENCE_SCHEMA},
                "subscoreBindings": {
                    "type": "array",
                    "items": _strict_object_schema(
                        {
                            "dimension": {"type": "string", "enum": list(DIMENSION_NAMES)},
                            "subscore": {"type": "string", "enum": _ALL_SUBSCORE_NAMES},
                            "evidenceIds": _string_array_schema(),
                        }
                    ),
                },
                "issueBindings": {
                    "type": "array",
                    "items": _strict_object_schema(
                        {
                            "issueId": {"type": "string"},
                            "evidenceIds": _string_array_schema(),
                        }
                    ),
                },
                "riskFlagBindings": {
                    "type": "array",
                    "items": _strict_object_schema(
                        {
                            "index": {"type": "integer", "minimum": 0},
                            "evidenceIds": _string_array_schema(),
                        }
                    ),
                },
            }
        )
    }
)


def _safe_validation_reason(error: ValueError) -> str:
    message = str(error)
    if "positive score without evidence" in message:
        return "positive_score_without_evidence"
    if "unknown evidence ids" in message:
        return "unknown_evidence_reference"
    if "verificationStatus" in message or "sourceText" in message or "unknown factId" in message:
        return "ungrounded_evidence"
    if "multiple primary dimensions" in message:
        return "cross_primary_issue"
    if (
        "primaryDimension" in message
        or "global issue" in message
        or "unknown issue" in message
        or "pointsNotEarned without any referenced issue" in message
    ):
        return "invalid_issue_reference"
    if "complete fixed subscore set" in message or ".maxScore must be" in message:
        return "invalid_subscore_schema"
    if "six fixed dimensions" in message or "supported resume dimension" in message:
        return "invalid_dimension_schema"
    if "exceeds cap" in message:
        return "quantification_cap"
    if "evaluationConfidence" in message:
        return "invalid_confidence"
    if "must be" in message or "missing resumeEvaluation" in message:
        return "malformed_field"
    return "other_validation"


def _requires_issue_graph_repair(error: ValueError) -> bool:
    message = str(error)
    return any(
        marker in message
        for marker in (
            _CROSS_PRIMARY_ISSUE_ERROR_PREFIX,
            "resumeEvaluation.issues must be an array",
            "pointsNotEarned without any referenced issue",
            "every global issue must be referenced by exactly one dimension",
            "may only be referenced by its primaryDimension",
            "references unknown issue",
        )
    )


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
        raise AiProviderPayloadError("full_resume fact_metadata must be an array")
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
        raise AiProviderPayloadError("resume evaluation result must be an object")
    raw_evaluation = result.get("resumeEvaluation")
    if raw_evaluation is None:
        raw_evaluation = result.get("resume_evaluation")
    if not isinstance(raw_evaluation, dict):
        raise AiProviderPayloadError(
            "resume evaluation result is missing resumeEvaluation"
        )
    normalized_raw = dict(raw_evaluation)
    # Scoring provenance is assigned by this service, never by a model reply.
    normalized_raw.pop("scoringVersion", None)
    normalized_raw.pop("scoring_version", None)
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
                gemini_thinking_level="low",
                gemini_stream=True,
                gemini_response_json_schema=_RESUME_EVALUATION_RESPONSE_SCHEMA,
            ),
            timeout=_REPAIR_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail="Resume evaluation repair exceeded its 75-second safety limit. Please retry the deep report.",
        ) from exc


def _requires_evidence_repair(error: ValueError) -> bool:
    message = str(error)
    return any(
        marker in message
        for marker in (
            "positive score without evidence",
            "unknown evidence ids",
            "verificationStatus",
            "sourceText",
            "unknown factId",
            "uses unverified evidence positively",
            "uses inferred evidence positively",
        )
    )


def _raw_subscore_max_score(raw_subscore: Dict[str, Any]) -> Any:
    """Mirror the normalizer's snake-to-camel conversion for maxScore."""
    maximum = None
    for key, value in raw_subscore.items():
        if key in {"maxScore", "max_score"}:
            maximum = value
    return maximum


def _raw_valid_score_vector(result: Any) -> Dict[tuple[str, str], tuple[int, int]]:
    """Collect unambiguous scores that remain valid if maxScore needs repair."""
    evaluation = _raw_resume_evaluation(result)
    if evaluation is None:
        return {}
    raw_dimensions = evaluation.get("dimensions")
    if not isinstance(raw_dimensions, list):
        return {}
    expected_by_dimension = dict(DIMENSION_SUBSCORES)
    vector: Dict[tuple[str, str], tuple[int, int]] = {}
    for raw_dimension in raw_dimensions:
        if not isinstance(raw_dimension, dict):
            continue
        raw_name = raw_dimension.get("dimension")
        if not isinstance(raw_name, str):
            continue
        dimension = _DIMENSION_ALIASES.get(raw_name, raw_name)
        expected_subscores = expected_by_dimension.get(dimension)
        if expected_subscores is None:
            continue
        expected_maxima = dict(expected_subscores)
        raw_subscores = raw_dimension.get("subscores")
        if not isinstance(raw_subscores, list):
            continue
        for raw_subscore in raw_subscores:
            if not isinstance(raw_subscore, dict):
                continue
            name = raw_subscore.get("name")
            score = raw_subscore.get("score")
            if (
                not isinstance(name, str)
                or name not in expected_maxima
                or isinstance(score, bool)
                or not isinstance(score, (int, float))
            ):
                continue
            if isinstance(score, float):
                if not score.is_integer():
                    continue
                normalized_score = int(score)
            else:
                normalized_score = score
            if normalized_score < 0 or normalized_score > expected_maxima[name]:
                continue
            key = (dimension, name)
            if key in vector:
                # The response contract has a single score per fixed coordinate.
                # Keeping either duplicate would make a repair lossy, even when
                # both duplicate entries happen to carry the same score.
                raise ResumeEvaluationIntegrityError(
                    "duplicate valid subscore coordinate"
                )
            vector[key] = (expected_maxima[name], normalized_score)
    return vector


def _assert_valid_scores_preserved(result: Any, repaired: Any) -> None:
    original = _raw_valid_score_vector(result)
    repaired_vector = _raw_valid_score_vector(repaired)
    changed = [
        key
        for key, value in original.items()
        if repaired_vector.get(key) != value
    ]
    if changed:
        raise ResumeEvaluationIntegrityError(
            "repair changed an existing valid subscore"
        )


def _repair_alias_values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return (
            left.keys() == right.keys()
            and all(
                _repair_alias_values_equal(left[key], right[key])
                for key in left
            )
        )
    if isinstance(left, list):
        return (
            len(left) == len(right)
            and all(
                _repair_alias_values_equal(left_item, right_item)
                for left_item, right_item in zip(left, right)
            )
        )
    return left == right


def _canonicalize_evaluation_for_repair(value: Any, *, path: str) -> Any:
    if isinstance(value, dict):
        canonical: Dict[str, Any] = {}
        source_keys: Dict[str, str] = {}
        for raw_key, raw_item in value.items():
            raw_key_text = str(raw_key)
            if "_" in raw_key_text:
                head, *tail = raw_key_text.split("_")
                key = head + "".join(part[:1].upper() + part[1:] for part in tail)
            else:
                key = raw_key_text
            item = _canonicalize_evaluation_for_repair(
                raw_item,
                path=f"{path}.{key}",
            )
            if key in canonical:
                if not _repair_alias_values_equal(canonical[key], item):
                    raise ResumeEvaluationIntegrityError(
                        f"conflicting field aliases at {path}.{key}: "
                        f"{source_keys[key]} and {raw_key_text}"
                    )
                continue
            canonical[key] = item
            source_keys[key] = raw_key_text
        return canonical
    if isinstance(value, list):
        return [
            _canonicalize_evaluation_for_repair(
                item,
                path=f"{path}[{index}]",
            )
            for index, item in enumerate(value)
        ]
    return value


def _compact_evidence_repair_payload(
    result: Any,
    *,
    validation_error: ValueError,
    fact_metadata: List[Dict[str, Any]],
) -> Dict[str, Any]:
    raw_evaluation = _raw_resume_evaluation(result)
    if raw_evaluation is None:
        raise ResumeEvaluationIntegrityError("evidence repair requires an evaluation")
    evaluation = _canonicalize_evaluation_for_repair(
        raw_evaluation,
        path="resumeEvaluation",
    )
    dimensions: List[Dict[str, Any]] = []
    raw_dimensions = evaluation.get("dimensions")
    if isinstance(raw_dimensions, list):
        for raw_dimension in raw_dimensions:
            if not isinstance(raw_dimension, dict):
                continue
            dimensions.append(
                {
                    "dimension": raw_dimension.get("dimension"),
                    "subscores": [
                        {
                            "name": raw_subscore.get("name"),
                            "maxScore": _raw_subscore_max_score(raw_subscore),
                            "score": raw_subscore.get("score"),
                            "evidenceIds": raw_subscore.get("evidenceIds"),
                        }
                        for raw_subscore in raw_dimension.get("subscores", [])
                        if isinstance(raw_subscore, dict)
                    ],
                }
            )
    issues = evaluation.get("issues")
    risk_flags = evaluation.get("riskFlags")
    return {
        "validation_error": _safe_validation_reason(validation_error),
        "fact_metadata": fact_metadata,
        "dimensions": dimensions,
        "issues": [
            {
                "issueId": item.get("issueId"),
                "description": item.get("description"),
                "evidenceIds": item.get("evidenceIds"),
            }
            for item in issues
            if isinstance(item, dict)
        ] if isinstance(issues, list) else [],
        "riskFlags": [
            {
                "index": index,
                "type": item.get("type"),
                "description": item.get("description"),
                "evidenceIds": item.get("evidenceIds"),
            }
            for index, item in enumerate(risk_flags)
            if isinstance(item, dict)
        ] if isinstance(risk_flags, list) else [],
    }


async def _repair_resume_evaluation_evidence(
    result: Any,
    *,
    validation_error: ValueError,
    fact_metadata: List[Dict[str, Any]],
) -> Dict[str, Any]:
    payload = _compact_evidence_repair_payload(
        result,
        validation_error=validation_error,
        fact_metadata=fact_metadata,
    )
    messages = [
        {"role": "system", "content": RESUME_EVALUATION_EVIDENCE_REPAIR},
        {
            "role": "user",
            "content": (
                "Repair only the evidence bindings in this compact payload.\n"
                f"{json.dumps(payload, ensure_ascii=False)}"
            ),
        },
    ]
    try:
        return await asyncio.wait_for(
            _call_llm(
                messages,
                json_mode=True,
                request_label="resume_evaluation_evidence_repair",
                lane=LANE_DEFAULT,
                gemini_thinking_level="low",
                gemini_stream=True,
                gemini_response_json_schema=_EVIDENCE_REPAIR_RESPONSE_SCHEMA,
            ),
            timeout=_REPAIR_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail="Resume evaluation repair exceeded its 75-second safety limit. Please retry the deep report.",
        ) from exc


def _apply_evidence_repair(
    result: Any,
    repair_result: Any,
    *,
    fact_metadata: List[Dict[str, Any]],
) -> Dict[str, Any]:
    raw_evaluation = _raw_resume_evaluation(result)
    if raw_evaluation is None:
        raise ResumeEvaluationIntegrityError("evidence repair requires an evaluation")
    evaluation = _canonicalize_evaluation_for_repair(
        raw_evaluation,
        path="resumeEvaluation",
    )
    if not isinstance(repair_result, dict) or set(repair_result) != {"evidenceRepair"}:
        raise ResumeEvaluationIntegrityError("invalid evidence repair wrapper")
    patch = repair_result.get("evidenceRepair")
    if not isinstance(patch, dict) or set(patch) != {
        "evidence",
        "subscoreBindings",
        "issueBindings",
        "riskFlagBindings",
    }:
        raise ResumeEvaluationIntegrityError("invalid evidence repair fields")

    facts = {
        str(item.get("fact_id") or "").strip(): item
        for item in fact_metadata
        if isinstance(item, dict) and str(item.get("fact_id") or "").strip()
    }
    raw_evidence = patch.get("evidence")
    if not isinstance(raw_evidence, list):
        raise ResumeEvaluationIntegrityError("evidence repair evidence must be an array")
    evidence: List[Dict[str, Any]] = []
    evidence_ids: set[str] = set()
    for item in raw_evidence:
        if not isinstance(item, dict) or set(item) != {
            "evidenceId",
            "sourceText",
            "location",
            "factId",
            "verificationStatus",
            "supportedDimensions",
        }:
            raise ResumeEvaluationIntegrityError("invalid repaired evidence item")
        evidence_id = str(item.get("evidenceId") or "").strip()
        fact_id = str(item.get("factId") or "").strip()
        fact = facts.get(fact_id)
        supported = item.get("supportedDimensions")
        if (
            not evidence_id
            or evidence_id in evidence_ids
            or fact is None
            or not isinstance(supported, list)
        ):
            raise ResumeEvaluationIntegrityError("invalid repaired evidence binding")
        evidence_ids.add(evidence_id)
        evidence.append(
            {
                "evidenceId": evidence_id,
                "sourceText": str(fact.get("content") or ""),
                "location": str(fact.get("source") or ""),
                "factId": fact_id,
                "verificationStatus": str(fact.get("verification_status") or ""),
                "supportedDimensions": supported,
            }
        )

    repaired = copy.deepcopy(evaluation)
    raw_dimensions = repaired.get("dimensions")
    if not isinstance(raw_dimensions, list):
        raise ResumeEvaluationIntegrityError("invalid evaluation dimensions")
    expected_subscores: set[tuple[str, str]] = set()
    dimension_items: Dict[tuple[str, str], Dict[str, Any]] = {}
    for raw_dimension in raw_dimensions:
        if not isinstance(raw_dimension, dict):
            raise ResumeEvaluationIntegrityError("invalid evaluation dimension")
        raw_name = raw_dimension.get("dimension")
        if not isinstance(raw_name, str):
            raise ResumeEvaluationIntegrityError("invalid evaluation dimension name")
        dimension = _DIMENSION_ALIASES.get(raw_name, raw_name)
        subscores = raw_dimension.get("subscores")
        if not isinstance(subscores, list):
            raise ResumeEvaluationIntegrityError("invalid evaluation subscores")
        for subscore in subscores:
            if not isinstance(subscore, dict) or not isinstance(subscore.get("name"), str):
                raise ResumeEvaluationIntegrityError("invalid evaluation subscore")
            key = (dimension, subscore["name"])
            if key in expected_subscores:
                raise ResumeEvaluationIntegrityError("duplicate evaluation subscore")
            expected_subscores.add(key)
            dimension_items[key] = subscore

    raw_subscore_bindings = patch.get("subscoreBindings")
    if not isinstance(raw_subscore_bindings, list):
        raise ResumeEvaluationIntegrityError("subscore bindings must be an array")
    subscore_bindings: Dict[tuple[str, str], List[str]] = {}
    for item in raw_subscore_bindings:
        if not isinstance(item, dict) or set(item) != {
            "dimension",
            "subscore",
            "evidenceIds",
        }:
            raise ResumeEvaluationIntegrityError("invalid subscore binding")
        key = (str(item.get("dimension") or ""), str(item.get("subscore") or ""))
        refs = item.get("evidenceIds")
        if key in subscore_bindings or not isinstance(refs, list):
            raise ResumeEvaluationIntegrityError("invalid subscore binding")
        subscore_bindings[key] = refs
    if set(subscore_bindings) != expected_subscores:
        raise ResumeEvaluationIntegrityError("incomplete subscore bindings")
    for key, subscore in dimension_items.items():
        subscore["evidenceIds"] = copy.deepcopy(subscore_bindings[key])

    raw_issues = repaired.get("issues")
    expected_issue_ids = {
        item.get("issueId")
        for item in raw_issues
        if isinstance(item, dict) and isinstance(item.get("issueId"), str)
    } if isinstance(raw_issues, list) else set()
    raw_issue_bindings = patch.get("issueBindings")
    if not isinstance(raw_issue_bindings, list):
        raise ResumeEvaluationIntegrityError("issue bindings must be an array")
    issue_bindings: Dict[str, List[str]] = {}
    for item in raw_issue_bindings:
        if not isinstance(item, dict) or set(item) != {
            "issueId",
            "evidenceIds",
        }:
            raise ResumeEvaluationIntegrityError("invalid issue binding")
        issue_id = str(item.get("issueId") or "")
        refs = item.get("evidenceIds")
        if not issue_id or issue_id in issue_bindings or not isinstance(refs, list):
            raise ResumeEvaluationIntegrityError("invalid issue binding")
        issue_bindings[issue_id] = refs
    if set(issue_bindings) != expected_issue_ids:
        raise ResumeEvaluationIntegrityError("incomplete issue bindings")
    if isinstance(raw_issues, list):
        for item in raw_issues:
            if isinstance(item, dict):
                item["evidenceIds"] = copy.deepcopy(issue_bindings[item["issueId"]])

    raw_risk_flags = repaired.get("riskFlags")
    risk_flags = raw_risk_flags if isinstance(raw_risk_flags, list) else []
    raw_risk_bindings = patch.get("riskFlagBindings")
    if not isinstance(raw_risk_bindings, list):
        raise ResumeEvaluationIntegrityError("risk flag bindings must be an array")
    risk_bindings: Dict[int, List[str]] = {}
    for item in raw_risk_bindings:
        if not isinstance(item, dict) or set(item) != {
            "index",
            "evidenceIds",
        }:
            raise ResumeEvaluationIntegrityError("invalid risk flag binding")
        index = item.get("index")
        refs = item.get("evidenceIds")
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or index in risk_bindings
            or not isinstance(refs, list)
        ):
            raise ResumeEvaluationIntegrityError("invalid risk flag binding")
        risk_bindings[index] = refs
    if set(risk_bindings) != set(range(len(risk_flags))):
        raise ResumeEvaluationIntegrityError("incomplete risk flag bindings")
    for index, item in enumerate(risk_flags):
        if not isinstance(item, dict):
            raise ResumeEvaluationIntegrityError("invalid evaluation risk flag")
        item["evidenceIds"] = copy.deepcopy(risk_bindings[index])

    repaired["evidence"] = evidence
    wrapped = {"resumeEvaluation": repaired}
    _assert_valid_scores_preserved(result, wrapped)
    return wrapped


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
        raise AiProviderPayloadError(
            "cross-primary issue repair requires a resumeEvaluation object"
        )
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
                            "maxScore": _bounded_repair_score(
                                _raw_subscore_max_score(raw_subscore)
                            ),
                            "score": _bounded_repair_score(raw_subscore.get("score")),
                        }
                    )
            raw_issue_ids = raw_dimension.get("issues")
            issue_ids: List[str] = []
            if isinstance(raw_issue_ids, list):
                seen_issue_ids: set[str] = set()
                for raw_issue_id in raw_issue_ids:
                    issue_id = _bounded_repair_string(
                        raw_issue_id,
                        _COMPACT_REPAIR_MAX_ID_CHARS,
                    )
                    if issue_id is None or issue_id in seen_issue_ids:
                        continue
                    if len(issue_ids) >= _COMPACT_REPAIR_MAX_REFS:
                        raise ResumeEvaluationIntegrityError(
                            "issue repair input exceeds the safe dimension issue count"
                        )
                    seen_issue_ids.add(issue_id)
                    issue_ids.append(issue_id)
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
    unique_valid_evidence_ids = list(dict.fromkeys(valid_evidence_ids))
    raw_issues = evaluation.get("issues")
    raw_priorities = evaluation.get("topPriorities")
    if (
        isinstance(raw_issues, list)
        and len(raw_issues) > _COMPACT_REPAIR_MAX_ISSUES
    ):
        raise ResumeEvaluationIntegrityError(
            "issue repair input exceeds the safe issue count"
        )
    if (
        isinstance(raw_priorities, list)
        and len(raw_priorities) > _COMPACT_REPAIR_MAX_PRIORITIES
    ):
        raise ResumeEvaluationIntegrityError(
            "issue repair input exceeds the safe priority count"
        )
    if len(unique_valid_evidence_ids) > _COMPACT_REPAIR_MAX_REFS:
        raise ResumeEvaluationIntegrityError(
            "issue repair input exceeds the safe evidence id count"
        )
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
        "validEvidenceIds": unique_valid_evidence_ids,
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
                gemini_thinking_level="low",
                gemini_stream=True,
                gemini_response_json_schema=_ISSUE_REPAIR_RESPONSE_SCHEMA,
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
        raise AiProviderPayloadError(
            "cross-primary issue repair requires a resumeEvaluation object"
        )
    if not isinstance(repair_result, dict) or set(repair_result) != {"issueRepair"}:
        raise AiProviderPayloadError(
            "issue repair result must contain exactly one issueRepair object"
        )
    issue_repair = repair_result.get("issueRepair")
    if not isinstance(issue_repair, dict) or set(issue_repair) != {
        "issues",
        "dimensionIssueIds",
        "topPriorities",
    }:
        raise AiProviderPayloadError(
            "issueRepair must contain issues, dimensionIssueIds, and topPriorities"
        )
    issues = issue_repair.get("issues")
    priorities = issue_repair.get("topPriorities")
    dimension_issue_ids = issue_repair.get("dimensionIssueIds")
    if not isinstance(issues, list) or not all(isinstance(item, dict) for item in issues):
        raise AiProviderPayloadError(
            "issueRepair.issues must be an array of objects"
        )
    if not isinstance(priorities, list) or not all(isinstance(item, dict) for item in priorities):
        raise AiProviderPayloadError(
            "issueRepair.topPriorities must be an array of objects"
        )
    if not isinstance(dimension_issue_ids, dict) or set(dimension_issue_ids) != set(DIMENSION_NAMES):
        raise AiProviderPayloadError(
            "issueRepair.dimensionIssueIds must contain all six fixed dimensions"
        )
    for dimension_name, issue_ids in dimension_issue_ids.items():
        if not isinstance(issue_ids, list) or not all(isinstance(item, str) for item in issue_ids):
            raise AiProviderPayloadError(
                f"issueRepair.dimensionIssueIds.{dimension_name} must be an array of strings"
            )

    repaired_evaluation = copy.deepcopy(evaluation)
    raw_dimensions = repaired_evaluation.get("dimensions")
    if not isinstance(raw_dimensions, list):
        raise AiProviderPayloadError("resumeEvaluation.dimensions must be an array")
    updated_dimensions: set[str] = set()
    for raw_dimension in raw_dimensions:
        if not isinstance(raw_dimension, dict):
            raise AiProviderPayloadError(
                "resumeEvaluation.dimensions entries must be objects"
            )
        raw_name = raw_dimension.get("dimension")
        if not isinstance(raw_name, str):
            raise AiProviderPayloadError(
                "resumeEvaluation dimension names must be strings"
            )
        name = _DIMENSION_ALIASES.get(raw_name, raw_name)
        if name not in DIMENSION_NAMES or name in updated_dimensions:
            raise AiProviderPayloadError(
                "resumeEvaluation.dimensions must contain six unique fixed dimensions"
            )
        raw_dimension["issues"] = copy.deepcopy(dimension_issue_ids[name])
        updated_dimensions.add(name)
    if updated_dimensions != set(DIMENSION_NAMES):
        raise AiProviderPayloadError(
            "resumeEvaluation.dimensions must contain all six fixed dimensions"
        )
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
        try:
            # Refuse ambiguous valid scores before sending malformed content to a
            # repair model.  A repair cannot safely prove which duplicate value
            # is authoritative, so preserving only the last one is unsafe.
            _raw_valid_score_vector(result)
            logger.warning(
                "Resume evaluation validation failed; requesting one compact repair: error_type=%s reason=%s error_meta=%s",
                type(first_error).__name__,
                _safe_validation_reason(first_error),
                safe_body_log_summary(str(first_error)),
            )
            if _requires_issue_graph_repair(first_error):
                issue_repair = await _repair_cross_primary_issues(
                    result,
                    validation_error=first_error,
                )
                repaired = _apply_cross_primary_issue_repair(result, issue_repair)
            elif _requires_evidence_repair(first_error):
                evidence_repair = await _repair_resume_evaluation_evidence(
                    result,
                    validation_error=first_error,
                    fact_metadata=fact_metadata,
                )
                repaired = _apply_evidence_repair(
                    result,
                    evidence_repair,
                    fact_metadata=fact_metadata,
                )
            else:
                repaired = await _repair_resume_evaluation(
                    result,
                    validation_error=first_error,
                    fact_metadata=fact_metadata,
                    jd_available=jd_available,
                    canonical_jd_match=canonical_jd_match,
                )
            _assert_valid_scores_preserved(result, repaired)
        except (ResumeEvaluationIntegrityError, AiProviderUnavailableError):
            raise
        except (TypeError, ValueError) as repair_error:
            raise ResumeEvaluationIntegrityError(
                "repair patch could not be applied safely"
            ) from repair_error
        try:
            return _normalize_response(
                repaired,
                jd_available=jd_available,
                fact_metadata=fact_metadata,
                canonical_jd_match=canonical_jd_match,
            )
        except ValueError as repair_error:
            logger.warning(
                "Resume evaluation repair validation failed: error_type=%s reason=%s error_meta=%s",
                type(repair_error).__name__,
                _safe_validation_reason(repair_error),
                safe_body_log_summary(str(repair_error)),
            )
            raise ResumeEvaluationIntegrityError(
                "repaired response still violates the evaluation contract"
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
    *, _repair: bool = True, _evidence_basis: bool = False,
) -> Dict[str, Any]:
    evaluation_input = _build_full_resume_evaluation_input(
        text,
        resume_text,
        jd_match_percentage,
    )
    fact_metadata = _fact_metadata_for_input(evaluation_input)
    messages = _build_messages(evaluation_input)
    response_schema = _GENERATION_RESPONSE_SCHEMA
    if _evidence_basis:
        from .resume_evaluation_basis import build_basis_contract, BASIS_PROMPT
        basis_schema, basis_targets = build_basis_contract(evaluation_input)
        response_schema = copy.deepcopy(_GENERATION_RESPONSE_SCHEMA)
        response_schema['properties'] = {'evidenceBasis':basis_schema, **response_schema['properties']}
        response_schema['required'] = ['evidenceBasis', *response_schema['required']]
        messages[0]['content'] = messages[0]['content'].replace(
            "a single top-level key 'resumeEvaluation'", "exactly two top-level keys 'evidenceBasis' and 'resumeEvaluation'")
        messages[0]['content'] += '\n' + BASIS_PROMPT + '\nOUTPUT_JSON_SCHEMA:\n' + json.dumps(response_schema, ensure_ascii=False)
        messages[1]['content'] += '\nSERVER EVIDENCE TARGETS:\n' + json.dumps(basis_targets, ensure_ascii=False)
    result = await _call_llm(
        messages,
        json_mode=True,
        request_label="resume_evaluation",
        lane=LANE_DEFAULT,
        gemini_thinking_level="low",
        gemini_stream=True,
        gemini_response_json_schema=response_schema,
    )
    try:
        if _evidence_basis:
            from .resume_evaluation_basis import materialize_basis
            result = materialize_basis(result, evaluation_input)
        result = _materialize_generation_deductions(result, require_bindings=not _repair)
    except (ValueError, KeyError, TypeError) as exc:
        category, field = _validation_diagnostic(exc)
        _record_evaluation_diagnostic("deductions", category, field)
        raise ResumeEvaluationIntegrityError("Independent sample violates deduction contract") from exc
    if _repair:
        validated = await _finalize_with_one_repair(
            result, fact_metadata=fact_metadata, jd_available=bool(text.strip()),
            canonical_jd_match=jd_match_percentage,
        )
    else:
        try:
            validated = _normalize_response(
                result, fact_metadata=fact_metadata, jd_available=bool(text.strip()),
                canonical_jd_match=jd_match_percentage,
            )
        except ValueError as exc:
            category, field = _validation_diagnostic(exc)
            _record_evaluation_diagnostic("normalization", category, field)
            raise ResumeEvaluationIntegrityError("Independent sample violates evaluation contract") from exc
    calibrated = calibrate_evaluation(validated, evaluation_input)
    calibrated["resumeEvaluation"]["scoringVersion"] = SCORING_VERSION
    return calibrated


async def _analyze_resume_evaluation_consensus_v3(text, resume_text, jd_match_percentage=None):
    if _CONSENSUS_SAMPLE_COUNT == 1:
        return await _analyze_resume_evaluation_once(text,resume_text,jd_match_percentage)
    samples=[]
    failures=[]
    deadline=asyncio.get_running_loop().time()+_TOTAL_TIMEOUT_SECONDS-1
    for _ in range(_CONSENSUS_MAX_ATTEMPTS):
        remaining=deadline-asyncio.get_running_loop().time()
        if remaining <= 1:
            break
        if len(samples) >= _CONSENSUS_SAMPLE_COUNT:
            if evaluation_dispersion(samples)["status"] == "stable":
                break
        elif len(samples) >= 2 and remaining < _CONSENSUS_GENERATION_TIMEOUT_SECONDS:
            break
        try:
            samples.append(await asyncio.wait_for(
                _analyze_resume_evaluation_once(text,resume_text,jd_match_percentage,_repair=False),
                timeout=min(remaining,_CONSENSUS_GENERATION_TIMEOUT_SECONDS),
            ))
        except (TimeoutError, AiRuntimeTimeoutError, httpx.TimeoutException):
            _record_evaluation_diagnostic("sampling", "timeout")
            failures.append(HTTPException(status_code=504,detail="Independent evaluation sample timed out"))
        except httpx.TransportError as exc:
            _record_evaluation_diagnostic("sampling", "connection")
            failures.append(AiProviderUnavailableError("Evaluation connection failed"))
        except (AiProviderPayloadError, AiProviderUnavailableError, ResumeEvaluationIntegrityError) as exc:
            status=getattr(getattr(exc.__cause__,"response",None),"status_code",None)
            if status in {400,401,403,404}:
                raise
            failures.append(exc)
            logger.warning("Evaluation consensus sample failed: %s",type(exc).__name__)
        except HTTPException as exc:
            if exc.status_code != HTTP_504_GATEWAY_TIMEOUT:
                raise
            # A bounded repair timeout invalidates one sample, not previously
            # validated reports. The outer 150-second deadline still applies.
            failures.append(exc)
            logger.warning("Evaluation consensus sample repair timed out")
    if len(samples)<2:
        if failures:raise failures[0]
        raise ResumeEvaluationIntegrityError("Insufficient validated evaluation samples")
    dispersion = evaluation_dispersion(samples)
    _record_evaluation_diagnostic("consensus", dispersion.pop("status"), **dispersion)
    return select_central_evaluation(samples)


async def _analyze_resume_evaluation_consensus(text, resume_text, jd_match_percentage=None):
    from .guidance_evaluation import generate_guidance
    return await generate_guidance(text, resume_text, jd_match_percentage)


async def analyze_resume_evaluation(
    text: str,
    resume_text: Optional[str],
    jd_match_percentage: Optional[int] = None,
) -> Dict[str, Any]:
    return await _run_with_total_timeout(
        _analyze_resume_evaluation_consensus(
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
        {"type": "thought", "summary": "正在生成简历改进指导并独立审核依据"},
    )
    return await _analyze_resume_evaluation_consensus(
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
