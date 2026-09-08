from __future__ import annotations

import html
import math
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


EVALUATION_VERSION = "resume_flow_v1"
SCORING_VERSION = "coverage_consensus_v4"
EVALUATION_SCOPE = "full_resume"

DIMENSION_SUBSCORES: Tuple[Tuple[str, Tuple[Tuple[str, int], ...]], ...] = (
    (
        "逻辑清晰",
        (("信息顺序", 25), ("因果关系", 30), ("信息层级", 20), ("一致性与聚焦", 25)),
    ),
    (
        "STAR应用",
        (("Situation情境", 15), ("Task任务", 15), ("Action行动", 35), ("Result结果", 35)),
    ),
    (
        "内容可读",
        (("扫读结构", 25), ("句子清晰度", 25), ("信息密度", 20), ("语法与自然度", 15), ("重复与冗余", 15)),
    ),
    (
        "内容完整",
        (("基础信息", 10), ("教育经历", 15), ("核心经历模块", 25), ("经历必要字段", 20), ("技能与资格", 15), ("求职方向", 10), ("补充信息", 5)),
    ),
    (
        "专业表达",
        (("行动动词", 20), ("岗位术语", 20), ("表达精确度", 20), ("贡献与责任边界", 20), ("客观与可信", 20)),
    ),
    (
        "成果量化",
        (("结果指标", 30), ("基线与前后对比", 25), ("覆盖规模", 15), ("时间窗口", 10), ("过程数量", 10), ("数据可信度", 10)),
    ),
)

DIMENSION_NAMES: Tuple[str, ...] = tuple(item[0] for item in DIMENSION_SUBSCORES)
_DIMENSION_ALIASES = {
    "logic_clarity": "逻辑清晰",
    "star_application": "STAR应用",
    "content_readability": "内容可读",
    "content_completeness": "内容完整",
    "professional_expression": "专业表达",
    "achievement_quantification": "成果量化",
}
_VERIFICATION_STATUSES = {"verified", "user_claimed", "unverified", "inferred"}
_SEVERITIES = {"high", "medium", "low"}
_RISK_TYPES = {
    "unverified_fact",
    "inferred_fact",
    "exaggerated_claim",
    "conflicting_date",
    "duplicated_content",
}
_POSITIVE_EVIDENCE_STATUSES = {"verified", "user_claimed"}
LOSSY_REPAIR_ISSUE_PREFIX = "SERVER_GAP_"
def has_lossy_resume_evaluation_artifact(raw: Any) -> bool:
    """Detect reports produced by the retired score-dropping repair path."""
    if not isinstance(raw, Mapping):
        return False

    def has_lossy_issue_id(value: Any) -> bool:
        return (
            isinstance(value, str)
            and value.upper().startswith(LOSSY_REPAIR_ISSUE_PREFIX)
        )

    issues = raw.get("issues")
    if isinstance(issues, list):
        for issue in issues:
            if not isinstance(issue, Mapping):
                continue
            issue_id = issue.get("issueId", issue.get("issue_id"))
            if has_lossy_issue_id(issue_id):
                return True
    dimensions = raw.get("dimensions")
    if isinstance(dimensions, list):
        for dimension in dimensions:
            if not isinstance(dimension, Mapping):
                continue
            issue_ids = dimension.get("issues")
            if isinstance(issue_ids, list) and any(
                has_lossy_issue_id(issue_id) for issue_id in issue_ids
            ):
                return True
            score = dimension.get("score")
            strengths = dimension.get("strengths")
            if (
                not isinstance(score, bool)
                and isinstance(score, (int, float))
                and score == 0
                and isinstance(strengths, list)
                and any(isinstance(item, str) and item.strip() for item in strengths)
            ):
                return True
    priorities = raw.get("topPriorities", raw.get("top_priorities"))
    if isinstance(priorities, list) and any(
        isinstance(priority, Mapping)
        and has_lossy_issue_id(
            priority.get("issueId", priority.get("issue_id"))
        )
        for priority in priorities
    ):
        return True
    return False


def _snake_to_camel_key(key: str) -> str:
    if "_" not in key:
        return key
    head, *tail = key.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _camelize(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {_snake_to_camel_key(str(key)): _camelize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camelize(item) for item in value]
    return value


def _require_dict(value: Any, path: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    return value


def _require_list(value: Any, path: str) -> List[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{path} must be an array")
    return value


def _require_string(value: Any, path: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{path} must be a string")
    normalized = value.strip()
    if not allow_empty and not normalized:
        raise ValueError(f"{path} must not be empty")
    return normalized


def _require_int(value: Any, path: str, minimum: int = 0, maximum: int = 100) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{path} must be an integer")
    if isinstance(value, float) and not value.is_integer():
        raise ValueError(f"{path} must be an integer")
    normalized = int(value)
    if normalized < minimum or normalized > maximum:
        raise ValueError(f"{path} must be between {minimum} and {maximum}")
    return normalized


def _require_confidence(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("resumeEvaluation.evaluationConfidence must be a number")
    try:
        normalized = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError(
            "resumeEvaluation.evaluationConfidence must be a finite number"
        ) from exc
    if not math.isfinite(normalized) or normalized < 0 or normalized > 1:
        raise ValueError("resumeEvaluation.evaluationConfidence must be between 0 and 1")
    return normalized


def _level(score: int) -> str:
    if score >= 93:
        return "卓越"
    if score >= 85:
        return "优秀"
    if score >= 75:
        return "良好"
    if score >= 60:
        return "合格"
    if score >= 40:
        return "较弱"
    return "不足"


def _round_half_up_average(total: int) -> int:
    # Six integer dimensions can only produce fractions in sixths. A remainder
    # of three is the exact .5 case and must round upward.
    return (total + 3) // 6


def _dimension_name(value: Any, path: str) -> str:
    name = _require_string(value, path)
    normalized = _DIMENSION_ALIASES.get(name, name)
    if normalized not in DIMENSION_NAMES:
        raise ValueError(f"{path} is not a supported resume dimension")
    return normalized


def _supported_dimension_names(raw: Any, path: str) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()
    for index, value in enumerate(_require_list(raw, path)):
        name = _require_string(value, f"{path}[{index}]")
        dimension = _DIMENSION_ALIASES.get(name, name)
        if dimension not in DIMENSION_NAMES or dimension in seen:
            continue
        seen.add(dimension)
        normalized.append(dimension)
    return normalized


def _optional_dimension_name(value: Any, path: str) -> str:
    if value == "":
        return ""
    return _dimension_name(value, path)


def _unique_strings(values: Any, path: str, *, allowed: Optional[Iterable[str]] = None) -> List[str]:
    items = _require_list(values, path)
    allowed_set = set(allowed) if allowed is not None else None
    result: List[str] = []
    seen = set()
    for index, item in enumerate(items):
        text = _require_string(item, f"{path}[{index}]")
        if allowed_set is not None and text not in allowed_set:
            raise ValueError(f"{path}[{index}] contains an unsupported value")
        if text not in seen:
            seen.add(text)
            result.append(text)
    return result


def _normalize_source_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", html.unescape(value))
    normalized = re.sub(r"<[^>]+>", " ", normalized)
    normalized = re.sub(r"[*_`#>]", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip().casefold()


def _build_fact_index(raw: Optional[Sequence[Mapping[str, Any]]]) -> Dict[str, Dict[str, str]]:
    facts: Dict[str, Dict[str, str]] = {}
    if raw is None:
        return facts
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        raise ValueError("fact_metadata must be an array")
    for index, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise ValueError(f"fact_metadata[{index}] must be an object")
        fact_id = item.get("fact_id", item.get("factId"))
        content = item.get("content")
        status = item.get("verification_status", item.get("verificationStatus"))
        fact_id = _require_string(fact_id, f"fact_metadata[{index}].fact_id")
        content = _require_string(content, f"fact_metadata[{index}].content")
        status = _require_string(status, f"fact_metadata[{index}].verification_status")
        if status not in _VERIFICATION_STATUSES:
            raise ValueError(f"fact_metadata[{index}] has an invalid verification_status")
        if fact_id in facts:
            raise ValueError(f"duplicate fact_metadata id: {fact_id}")
        facts[fact_id] = {
            "content": content,
            "normalizedContent": _normalize_source_text(content),
            "verificationStatus": status,
            "source": str(item.get("source") or "").strip(),
        }
    return facts


def _validate_content_completeness_integrity(
    evaluation: Mapping[str, Any],
    fact_metadata: Optional[Sequence[Mapping[str, Any]]],
) -> None:
    if fact_metadata is None:
        return
    sources = {
        str(item.get("source") or "").strip()
        for item in fact_metadata
        if isinstance(item, Mapping)
    }

    def has_source(*prefixes: str) -> bool:
        return any(
            source.startswith(prefix)
            for source in sources
            for prefix in prefixes
        )

    has_profile = has_source("resume.profile.", "/currentResume/profile/")
    has_education = has_source(
        "resume.educations[",
        "/currentResume/educations/",
    )
    has_experience = has_source(
        "resume.experiences[",
        "/currentResume/experiences/",
    )
    if not (has_profile and has_education and has_experience):
        return
    completeness = next(
        (
            item
            for item in evaluation.get("dimensions", [])
            if isinstance(item, Mapping) and item.get("dimension") == "内容完整"
        ),
        None,
    )
    if isinstance(completeness, Mapping) and completeness.get("score") == 0:
        raise ValueError(
            "内容完整 cannot be zero when profile, education, and experience facts exist"
        )


def _source_text_binds_fact(source_text: str, fact_content: str) -> bool:
    source = _normalize_source_text(source_text)
    fact = _normalize_source_text(fact_content)
    if not source or not fact:
        return False
    if source == fact:
        return True
    # A quoted excerpt is allowed, but short generic tokens must match the
    # complete fact so they cannot be used to justify unrelated claims.
    minimum_excerpt_length = 4
    return len(source) >= minimum_excerpt_length and source in fact


def _resolve_evidence_fact_id(
    raw_fact_id: Any,
    *,
    evidence_id: str,
    source_text: str,
    verification_status: str,
    fact_index: Dict[str, Dict[str, str]],
    path: str,
) -> str:
    if raw_fact_id is not None and not (
        isinstance(raw_fact_id, str) and not raw_fact_id.strip()
    ):
        return _require_string(raw_fact_id, path)

    candidates = [
        fact_id
        for fact_id, fact in fact_index.items()
        if fact["verificationStatus"] == verification_status
        and _source_text_binds_fact(source_text, fact["content"])
    ]
    if len(candidates) != 1:
        raise ValueError(
            f"evidence {evidence_id} missing factId cannot be uniquely inferred"
        )
    return candidates[0]


def _issue_text_identity(description: str) -> str:
    # Only textual identity is deterministic. Paraphrases and shared issue
    # categories must be assessed by the model in their evidence context.
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", description)).strip()


def _normalize_evidence(
    raw: Any,
    fact_index: Dict[str, Dict[str, str]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    evidence: List[Dict[str, Any]] = []
    evidence_by_id: Dict[str, Dict[str, Any]] = {}
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.evidence")):
        entry = _require_dict(item, f"resumeEvaluation.evidence[{index}]")
        evidence_id = _require_string(entry.get("evidenceId"), f"resumeEvaluation.evidence[{index}].evidenceId")
        if evidence_id in evidence_by_id:
            raise ValueError(f"duplicate evidence id: {evidence_id}")
        raw_fact_id = entry.get("factId")
        fact_id_missing = raw_fact_id is None or (
            isinstance(raw_fact_id, str) and not raw_fact_id.strip()
        )
        if fact_id_missing:
            source_text = _require_string(entry.get("sourceText"), f"resumeEvaluation.evidence[{index}].sourceText")
            status = _require_string(entry.get("verificationStatus"), f"resumeEvaluation.evidence[{index}].verificationStatus")
            if status not in _VERIFICATION_STATUSES:
                raise ValueError(f"invalid verification status for evidence {evidence_id}")
            fact_id = _resolve_evidence_fact_id(
                raw_fact_id,
                evidence_id=evidence_id,
                source_text=source_text,
                verification_status=status,
                fact_index=fact_index,
                path=f"resumeEvaluation.evidence[{index}].factId",
            )
            fact = fact_index[fact_id]
        else:
            fact_id = _require_string(raw_fact_id, f"resumeEvaluation.evidence[{index}].factId")
            fact = fact_index.get(fact_id)
            if fact is None:
                raw_source_text = entry.get("sourceText")
                raw_status = entry.get("verificationStatus")
                if not isinstance(raw_source_text, str) or not raw_source_text.strip():
                    raise ValueError(f"evidence {evidence_id} references unknown factId {fact_id}")
                if not isinstance(raw_status, str) or not raw_status.strip():
                    raise ValueError(f"evidence {evidence_id} references unknown factId {fact_id}")
                source_text = _require_string(
                    raw_source_text,
                    f"resumeEvaluation.evidence[{index}].sourceText",
                )
                status = _require_string(
                    raw_status,
                    f"resumeEvaluation.evidence[{index}].verificationStatus",
                )
                if status not in _VERIFICATION_STATUSES:
                    raise ValueError(f"invalid verification status for evidence {evidence_id}")
                remap_candidates = [
                    candidate_id
                    for candidate_id, candidate in fact_index.items()
                    if candidate["verificationStatus"] == status
                    and _source_text_binds_fact(source_text, candidate["content"])
                ]
                if len(remap_candidates) == 1:
                    fact_id = remap_candidates[0]
                    fact = fact_index[fact_id]
                elif len(remap_candidates) > 1:
                    raise ValueError(
                        f"evidence {evidence_id} sourceText ambiguously matches multiple facts"
                    )
                else:
                    raise ValueError(f"evidence {evidence_id} references unknown factId {fact_id}")
            raw_source_text = entry.get("sourceText")
            if raw_source_text is None or (
                isinstance(raw_source_text, str) and not raw_source_text.strip()
            ):
                source_text = fact["content"]
            else:
                source_text = _require_string(raw_source_text, f"resumeEvaluation.evidence[{index}].sourceText")
            raw_status = entry.get("verificationStatus")
            if raw_status is None or (
                isinstance(raw_status, str) and not raw_status.strip()
            ):
                status = fact["verificationStatus"]
            else:
                status = _require_string(raw_status, f"resumeEvaluation.evidence[{index}].verificationStatus")
            if status not in _VERIFICATION_STATUSES:
                raise ValueError(f"invalid verification status for evidence {evidence_id}")
            if status != fact["verificationStatus"]:
                raise ValueError(f"evidence {evidence_id} verificationStatus does not match fact {fact_id}")
            if (
                isinstance(raw_source_text, str)
                and raw_source_text.strip()
                and not _source_text_binds_fact(source_text, fact["content"])
            ):
                remap_candidates = [
                    candidate_id
                    for candidate_id, candidate in fact_index.items()
                    if candidate["verificationStatus"] == status
                    and _source_text_binds_fact(source_text, candidate["content"])
                ]
                if len(remap_candidates) == 1:
                    fact_id = remap_candidates[0]
                    fact = fact_index[fact_id]
                elif not remap_candidates:
                    source_text = fact["content"]
                else:
                    raise ValueError(
                        f"evidence {evidence_id} sourceText ambiguously matches multiple facts"
                    )
        if status != fact["verificationStatus"]:
            raise ValueError(f"evidence {evidence_id} verificationStatus does not match fact {fact_id}")
        if not _source_text_binds_fact(source_text, fact["content"]):
            raise ValueError(f"evidence {evidence_id} sourceText is not grounded in fact {fact_id}")
        supported = _supported_dimension_names(
            entry.get("supportedDimensions"),
            f"resumeEvaluation.evidence[{index}].supportedDimensions",
        )
        normalized_entry = {
            "evidenceId": evidence_id,
            "sourceText": source_text,
            "location": _require_string(entry.get("location", ""), f"resumeEvaluation.evidence[{index}].location", allow_empty=True),
            "factId": fact_id,
            "verificationStatus": status,
            "supportedDimensions": supported,
        }
        evidence.append(normalized_entry)
        evidence_by_id[evidence_id] = normalized_entry
    return evidence, evidence_by_id


def _unique_fact_evidence_aliases(
    evidence: Sequence[Mapping[str, Any]],
) -> Dict[str, str]:
    candidates: Dict[str, List[str]] = {}
    for item in evidence:
        fact_id = item.get("factId")
        evidence_id = item.get("evidenceId")
        if isinstance(fact_id, str) and isinstance(evidence_id, str):
            candidates.setdefault(fact_id, []).append(evidence_id)
    return {
        fact_id: evidence_ids[0]
        for fact_id, evidence_ids in candidates.items()
        if len(evidence_ids) == 1
    }


def _evidence_refs(
    raw: Any,
    path: str,
    evidence_ids: set[str],
    fact_evidence_aliases: Mapping[str, str],
) -> List[str]:
    refs = _unique_strings(raw, path)
    normalized = list(
        dict.fromkeys(
            item
            if item in evidence_ids
            else fact_evidence_aliases.get(item, item)
            for item in refs
        )
    )
    unknown = [item for item in normalized if item not in evidence_ids]
    if unknown:
        raise ValueError(f"{path} contains unknown evidence ids: {', '.join(unknown)}")
    return normalized


def _normalize_issues(
    raw: Any,
    evidence_ids: set[str],
    fact_evidence_aliases: Mapping[str, str],
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    normalized: List[Dict[str, Any]] = []
    issue_ids: set[str] = set()
    semantic_ids: dict[tuple[Any, ...], str] = {}
    semantic_primaries: dict[tuple[Any, ...], str] = {}
    remapped: Dict[str, str] = {}
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.issues")):
        entry = _require_dict(item, f"resumeEvaluation.issues[{index}]")
        issue_id = _require_string(entry.get("issueId"), f"resumeEvaluation.issues[{index}].issueId")
        if issue_id in issue_ids or issue_id in remapped:
            raise ValueError(f"duplicate issue id: {issue_id}")
        description = _require_string(entry.get("description"), f"resumeEvaluation.issues[{index}].description")
        primary = _dimension_name(entry.get("primaryDimension"), f"resumeEvaluation.issues[{index}].primaryDimension")
        raw_related_dimensions = entry.get("relatedDimensions")
        if raw_related_dimensions is None:
            raw_related_dimensions = []
        related = [
            _dimension_name(value, f"resumeEvaluation.issues[{index}].relatedDimensions")
            for value in _require_list(raw_related_dimensions, f"resumeEvaluation.issues[{index}].relatedDimensions")
        ]
        related = [value for value in dict.fromkeys(related) if value != primary]
        severity = _require_string(entry.get("severity"), f"resumeEvaluation.issues[{index}].severity")
        if severity not in _SEVERITIES:
            raise ValueError(f"invalid severity for issue {issue_id}")
        semantic_description = _issue_text_identity(description)
        evidence_refs = _evidence_refs(
            entry.get("evidenceIds"), f"resumeEvaluation.issues[{index}].evidenceIds",
            evidence_ids, fact_evidence_aliases,
        )
        identity = (semantic_description, tuple(sorted(evidence_refs)))
        existing_primary = semantic_primaries.get(identity)
        if existing_primary is not None and existing_primary != primary:
            raise ValueError(
                f"the same issue description cannot use multiple primary dimensions: {description}"
            )
        semantic_primaries[identity] = primary
        semantic_key = (primary, identity, severity, tuple(sorted(related)),
                        _require_int(entry.get("pointsNotEarned"), "issue.pointsNotEarned", 0, 100))
        if semantic_key in semantic_ids:
            remapped[issue_id] = semantic_ids[semantic_key]
            continue
        semantic_ids[semantic_key] = issue_id
        issue_ids.add(issue_id)
        normalized.append(
            {
                "issueId": issue_id,
                "description": description,
                "primaryDimension": primary,
                "relatedDimensions": related,
                "evidenceIds": _evidence_refs(
                    entry.get("evidenceIds"),
                    f"resumeEvaluation.issues[{index}].evidenceIds",
                    evidence_ids,
                    fact_evidence_aliases,
                ),
                "severity": severity,
                "pointsNotEarned": _require_int(
                    entry.get("pointsNotEarned"),
                    f"resumeEvaluation.issues[{index}].pointsNotEarned",
                    0,
                    100,
                ),
            }
        )
    return normalized, remapped


def _issue_refs(raw: Any, path: str, issue_ids: set[str], remapped: Dict[str, str]) -> List[str]:
    refs = _unique_strings(raw, path)
    normalized = list(dict.fromkeys(remapped.get(ref, ref) for ref in refs))
    unknown = [item for item in normalized if item not in issue_ids]
    if unknown:
        raise ValueError(f"{path} contains unknown issue ids: {', '.join(unknown)}")
    return normalized


def _reconcile_issue_points(
    dimension_name: str,
    dimension_issue_ids: Sequence[str],
    issues_by_id: Dict[str, Dict[str, Any]],
    gap: int,
) -> None:
    if not dimension_issue_ids:
        if gap > 0:
            raise ValueError(
                f"{dimension_name} has {gap} pointsNotEarned without any referenced issue"
            )
        return
    if gap == 0:
        for issue_id in dimension_issue_ids:
            issues_by_id[issue_id]["pointsNotEarned"] = 0
        return

    weights = [issues_by_id[issue_id]["pointsNotEarned"] for issue_id in dimension_issue_ids]
    weight_total = sum(weights)
    if weight_total == 0:
        weights = [1] * len(dimension_issue_ids)
        weight_total = len(dimension_issue_ids)

    allocations = [(gap * weight) // weight_total for weight in weights]
    remainders = [(gap * weight) % weight_total for weight in weights]
    remaining = gap - sum(allocations)
    remainder_order = sorted(
        range(len(dimension_issue_ids)),
        key=lambda index: (-remainders[index], index),
    )
    for index in remainder_order[:remaining]:
        allocations[index] += 1
    for issue_id, allocation in zip(dimension_issue_ids, allocations):
        issues_by_id[issue_id]["pointsNotEarned"] = allocation


def _normalize_dimensions(
    raw: Any,
    evidence_by_id: Dict[str, Dict[str, Any]],
    fact_index: Dict[str, Dict[str, str]],
    issues_by_id: Dict[str, Dict[str, Any]],
    issue_remapped: Dict[str, str],
    fact_evidence_aliases: Mapping[str, str],
) -> Tuple[List[Dict[str, Any]], int]:
    evidence_ids = set(evidence_by_id)
    issue_ids = set(issues_by_id)
    issue_reference_counts = {issue_id: 0 for issue_id in issue_ids}
    provided: Dict[str, Dict[str, Any]] = {}
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.dimensions")):
        entry = _require_dict(item, f"resumeEvaluation.dimensions[{index}]")
        name = _dimension_name(entry.get("dimension"), f"resumeEvaluation.dimensions[{index}].dimension")
        if name in provided:
            raise ValueError(f"duplicate resume dimension: {name}")
        provided[name] = entry
    missing = [name for name in DIMENSION_NAMES if name not in provided]
    extra_count = len(provided) - len(DIMENSION_NAMES)
    if missing or extra_count:
        raise ValueError(f"resumeEvaluation.dimensions must contain exactly six fixed dimensions; missing={missing}")

    dimensions: List[Dict[str, Any]] = []
    total = 0
    for dimension_name, expected_subscores in DIMENSION_SUBSCORES:
        entry = provided[dimension_name]
        subscore_items = _require_list(entry.get("subscores"), f"resumeEvaluation.dimensions[{dimension_name}].subscores")
        by_name: Dict[str, Dict[str, Any]] = {}
        for index, item in enumerate(subscore_items):
            subscore = _require_dict(item, f"resumeEvaluation.dimensions[{dimension_name}].subscores[{index}]")
            name = _require_string(subscore.get("name"), f"resumeEvaluation.dimensions[{dimension_name}].subscores[{index}].name")
            if name in by_name:
                raise ValueError(f"duplicate subscore {name} in {dimension_name}")
            by_name[name] = subscore
        expected_names = [item[0] for item in expected_subscores]
        if set(by_name) != set(expected_names):
            raise ValueError(f"{dimension_name} must contain its complete fixed subscore set")
        normalized_subscores: List[Dict[str, Any]] = []
        dimension_score = 0
        for subscore_name, max_score in expected_subscores:
            subscore = by_name[subscore_name]
            model_max = _require_int(subscore.get("maxScore"), f"{dimension_name}.{subscore_name}.maxScore", 0, 100)
            if model_max != max_score:
                raise ValueError(f"{dimension_name}.{subscore_name}.maxScore must be {max_score}")
            score = _require_int(subscore.get("score"), f"{dimension_name}.{subscore_name}.score", 0, max_score)
            subscore_evidence_ids = _evidence_refs(
                subscore.get("evidenceIds"),
                f"{dimension_name}.{subscore_name}.evidenceIds",
                evidence_ids,
                fact_evidence_aliases,
            )
            if score > 0 and not subscore_evidence_ids:
                raise ValueError(f"{dimension_name}.{subscore_name} has a positive score without evidence")
            if score > 0:
                for evidence_id in subscore_evidence_ids:
                    referenced = evidence_by_id[evidence_id]
                    if referenced["verificationStatus"] not in _POSITIVE_EVIDENCE_STATUSES:
                        raise ValueError(
                            f"{dimension_name}.{subscore_name} uses {referenced['verificationStatus']} evidence positively"
                        )
                    if dimension_name not in referenced["supportedDimensions"]:
                        referenced["supportedDimensions"].append(dimension_name)
            dimension_score += score
            normalized_subscores.append(
                {
                    "name": subscore_name,
                    "maxScore": max_score,
                    "score": score,
                    "evidenceIds": subscore_evidence_ids,
                }
            )
        # Quantification rubric interpretation belongs to the evidence-aware
        # evaluator. Keyword windows cannot establish whether a number is a
        # business outcome; retain schema, evidence and arithmetic checks here.
        total += dimension_score
        dimension_issue_ids = _issue_refs(
            entry.get("issues"),
            f"resumeEvaluation.dimensions[{dimension_name}].issues",
            issue_ids,
            issue_remapped,
        )
        for issue_id in dimension_issue_ids:
            issue = issues_by_id[issue_id]
            if issue["primaryDimension"] != dimension_name:
                raise ValueError(
                    f"issue {issue_id} may only be referenced by its primaryDimension {issue['primaryDimension']}"
                )
            issue_reference_counts[issue_id] += 1
        expected_points_not_earned = 100 - dimension_score
        _reconcile_issue_points(
            dimension_name,
            dimension_issue_ids,
            issues_by_id,
            expected_points_not_earned,
        )
        strengths = _unique_strings(
            entry.get("strengths"),
            f"resumeEvaluation.dimensions[{dimension_name}].strengths",
        )
        if dimension_score == 0 and strengths:
            raise ValueError(
                f"{dimension_name} zero score cannot contain strengths"
            )
        dimensions.append(
            {
                "dimension": dimension_name,
                "score": dimension_score,
                "level": _level(dimension_score),
                "subscores": normalized_subscores,
                "strengths": strengths,
                "issues": dimension_issue_ids,
                "improvementQuestions": _unique_strings(entry.get("improvementQuestions"), f"resumeEvaluation.dimensions[{dimension_name}].improvementQuestions"),
            }
        )
    incorrectly_referenced = [
        issue_id for issue_id, count in issue_reference_counts.items() if count != 1
    ]
    if incorrectly_referenced:
        raise ValueError(
            "every global issue must be referenced by exactly one dimension: "
            + ", ".join(sorted(incorrectly_referenced))
        )
    return dimensions, total


def _normalize_missing_information(raw: Any) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    seen = set()
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.missingInformation")):
        entry = _require_dict(item, f"resumeEvaluation.missingInformation[{index}]")
        normalized = {
            "field": _require_string(entry.get("field"), f"resumeEvaluation.missingInformation[{index}].field"),
            "reason": _require_string(entry.get("reason"), f"resumeEvaluation.missingInformation[{index}].reason"),
            "question": _require_string(entry.get("question"), f"resumeEvaluation.missingInformation[{index}].question"),
            "potentialDimension": _optional_dimension_name(entry.get("potentialDimension", ""), f"resumeEvaluation.missingInformation[{index}].potentialDimension"),
            "potentialScoreGain": _require_int(entry.get("potentialScoreGain"), f"resumeEvaluation.missingInformation[{index}].potentialScoreGain"),
        }
        key = (normalized["field"].casefold(), normalized["question"].casefold())
        if key not in seen:
            seen.add(key)
            result.append(normalized)
    return result


def _normalize_risk_flags(
    raw: Any,
    evidence_ids: set[str],
    fact_evidence_aliases: Mapping[str, str],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    seen = set()
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.riskFlags")):
        entry = _require_dict(item, f"resumeEvaluation.riskFlags[{index}]")
        risk_type = _require_string(entry.get("type"), f"resumeEvaluation.riskFlags[{index}].type")
        if risk_type not in _RISK_TYPES:
            raise ValueError(f"invalid risk flag type: {risk_type}")
        description = _require_string(entry.get("description"), f"resumeEvaluation.riskFlags[{index}].description")
        key = (risk_type, re.sub(r"\s+", "", description).casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append(
            {
                "type": risk_type,
                "description": description,
                "evidenceIds": _evidence_refs(
                    entry.get("evidenceIds"),
                    f"resumeEvaluation.riskFlags[{index}].evidenceIds",
                    evidence_ids,
                    fact_evidence_aliases,
                ),
            }
        )
    return result


def _normalize_priorities(raw: Any, issue_ids: set[str], remapped: Dict[str, str]) -> List[Dict[str, Any]]:
    priorities: List[Dict[str, Any]] = []
    seen = set()
    for index, item in enumerate(_require_list(raw, "resumeEvaluation.topPriorities")):
        entry = _require_dict(item, f"resumeEvaluation.topPriorities[{index}]")
        issue_id = _require_string(entry.get("issueId"), f"resumeEvaluation.topPriorities[{index}].issueId")
        issue_id = remapped.get(issue_id, issue_id)
        if issue_id not in issue_ids:
            raise ValueError(f"resumeEvaluation.topPriorities[{index}] references unknown issue {issue_id}")
        if issue_id in seen:
            continue
        seen.add(issue_id)
        priorities.append(
            {
                "priority": _require_int(entry.get("priority"), f"resumeEvaluation.topPriorities[{index}].priority", 1, 100),
                "issueId": issue_id,
                "action": _require_string(entry.get("action"), f"resumeEvaluation.topPriorities[{index}].action"),
                "expectedScoreGain": _require_int(entry.get("expectedScoreGain"), f"resumeEvaluation.topPriorities[{index}].expectedScoreGain"),
            }
        )
    priorities.sort(key=lambda item: item["priority"])
    for index, item in enumerate(priorities, start=1):
        item["priority"] = index
    return priorities


def normalize_resume_evaluation(
    raw: Any,
    *,
    jd_available: bool,
    fact_metadata: Optional[Sequence[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    if isinstance(raw, dict) and raw.get("evaluationVersion") == "resume_score_v2":
        from .resume_score import normalize_score
        return normalize_score(raw)
    if isinstance(raw, dict) and raw.get("evaluationVersion") == "guidance_audit_v1":
        from .guidance_evaluation import normalize_guidance_report
        return normalize_guidance_report(raw)
    evaluation = _require_dict(_camelize(raw), "resumeEvaluation")
    if has_lossy_resume_evaluation_artifact(evaluation):
        raise ValueError("resumeEvaluation contains a lossy repair artifact")
    scope = _require_string(evaluation.get("evaluationScope"), "resumeEvaluation.evaluationScope")
    if scope != EVALUATION_SCOPE:
        raise ValueError("resumeEvaluation.evaluationScope must be full_resume")
    version = _require_string(evaluation.get("evaluationVersion"), "resumeEvaluation.evaluationVersion")
    if version != EVALUATION_VERSION:
        raise ValueError(f"resumeEvaluation.evaluationVersion must be {EVALUATION_VERSION}")

    fact_index = _build_fact_index(fact_metadata)
    evidence, evidence_by_id = _normalize_evidence(evaluation.get("evidence"), fact_index)
    evidence_ids = set(evidence_by_id)
    fact_evidence_aliases = _unique_fact_evidence_aliases(evidence)
    issues, issue_remapped = _normalize_issues(
        evaluation.get("issues"),
        evidence_ids,
        fact_evidence_aliases,
    )
    issue_ids = {item["issueId"] for item in issues}
    issues_by_id = {item["issueId"]: item for item in issues}
    dimensions, dimension_sum = _normalize_dimensions(
        evaluation.get("dimensions"),
        evidence_by_id,
        fact_index,
        issues_by_id,
        issue_remapped,
        fact_evidence_aliases,
    )
    for evidence_item in evidence:
        supported = set(evidence_item["supportedDimensions"])
        evidence_item["supportedDimensions"] = [
            dimension_name
            for dimension_name in DIMENSION_NAMES
            if dimension_name in supported
        ]
    final_score = _round_half_up_average(dimension_sum)

    evaluation_confidence = _require_confidence(evaluation.get("evaluationConfidence"))
    positive_evidence_ids = {
        evidence_id
        for dimension in dimensions
        for subscore in dimension["subscores"]
        if subscore["score"] > 0
        for evidence_id in subscore["evidenceIds"]
    }
    has_user_claimed_positive_evidence = any(
        evidence_by_id[evidence_id]["verificationStatus"] == "user_claimed"
        for evidence_id in positive_evidence_ids
    )
    if has_user_claimed_positive_evidence and evaluation_confidence > 0.89:
        raise ValueError(
            "resumeEvaluation.evaluationConfidence must not exceed 0.89 when positive evidence is user_claimed"
        )

    jd_match_raw = evaluation.get("jdMatch")
    if jd_available:
        if jd_match_raw is None:
            raise ValueError("resumeEvaluation.jdMatch must be a number when JD is provided")
        jd_match: Optional[int] = _require_int(jd_match_raw, "resumeEvaluation.jdMatch")
    else:
        jd_match = None

    normalized = {
        "evaluationVersion": EVALUATION_VERSION,
        "evaluationScope": EVALUATION_SCOPE,
        "targetRole": _require_string(evaluation.get("targetRole", ""), "resumeEvaluation.targetRole", allow_empty=True),
        "overallScore": final_score,
        "overallLevel": _level(final_score),
        "evaluationConfidence": evaluation_confidence,
        "scoreCalculation": {
            "dimensionSum": dimension_sum,
            "rawAverage": dimension_sum / 6,
            "roundingRule": "round_half_up",
            "finalScore": final_score,
        },
        "dimensions": dimensions,
        "evidence": evidence,
        "issues": issues,
        "missingInformation": _normalize_missing_information(evaluation.get("missingInformation")),
        "riskFlags": _normalize_risk_flags(
            evaluation.get("riskFlags"),
            evidence_ids,
            fact_evidence_aliases,
        ),
        "topPriorities": _normalize_priorities(evaluation.get("topPriorities"), issue_ids, issue_remapped),
        "jdMatch": jd_match,
    }
    if "scoringVersion" in evaluation:
        normalized["scoringVersion"] = _require_string(
            evaluation["scoringVersion"], "resumeEvaluation.scoringVersion"
        )
    _validate_content_completeness_integrity(normalized, fact_metadata)
    return normalized


def normalize_jd_analysis_evaluation(
    result: Dict[str, Any],
    *,
    jd_available: bool,
    fact_metadata: Optional[Sequence[Mapping[str, Any]]] = None,
) -> Dict[str, Any]:
    if not isinstance(result, dict):
        raise ValueError("JD analysis result must be an object")
    normalized = dict(result)
    raw_evaluation = normalized.get("resumeEvaluation")
    if raw_evaluation is None:
        raw_evaluation = normalized.get("resume_evaluation")
    if raw_evaluation is None:
        raise ValueError("JD analysis result is missing resumeEvaluation")
    evaluation = normalize_resume_evaluation(
        raw_evaluation,
        jd_available=jd_available,
        fact_metadata=fact_metadata,
    )
    normalized["resumeEvaluation"] = evaluation
    normalized.pop("resume_evaluation", None)
    return normalized
