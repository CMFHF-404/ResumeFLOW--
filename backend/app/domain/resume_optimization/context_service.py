from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
from typing import Any, Mapping
import uuid

from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import ExperienceCategory
from ..agent.agent_resume_helpers import (
    _load_agent_bank,
    _load_resume_item_categories,
)
from ..agent.agent_service import build_resume_analysis_text
from ..experience.experience_service import (
    NotFoundError as ExperienceNotFoundError,
    get_version_for_user,
)
from ..resume.resume_service import (
    NotFoundError as ResumeNotFoundError,
    get_resume_detail,
)
from .run_service import hash_canonical_json
from .schemas import ResumeOptimizationStartRequest


EVALUATION_VERSION = "resume_flow_v1"
_SOURCE_DOCUMENT_ROOTS = frozenset(
    {"currentResume", "selectedSourceExperiences", "userAnswers"}
)
_EXPERIENCE_CATEGORIES = frozenset({"work", "project"})


class OptimizationContextError(ValueError):
    code = "resume_optimization_context_error"
    status_code = 422


class OptimizationContextRequestError(OptimizationContextError):
    code = "resume_optimization_context_request_invalid"
    status_code = 400


class OptimizationContextNotFoundError(OptimizationContextError, LookupError):
    code = "resume_optimization_context_not_found"
    status_code = 404


class OptimizationContextStaleError(OptimizationContextError):
    code = "resume_optimization_context_stale"
    status_code = 409


class OptimizationEvaluationInvalidError(OptimizationContextError):
    code = "resume_optimization_evaluation_invalid"
    status_code = 422


class OptimizationSelectionInvalidError(OptimizationContextError):
    code = "resume_optimization_selection_invalid"
    status_code = 422


class FrozenOptimizationContext:
    __slots__ = ("_snapshot", "_snapshot_hash")

    def __init__(
        self,
        *,
        resume_id: str,
        resume_updated_at: str,
        evaluation_signature: str,
        jd_signature: str,
        target_role: str,
        evaluation: Mapping[str, Any],
        current_resume: Mapping[str, Any],
        selected_source_experiences: Mapping[str, Any],
        selected_master_experience_ids: list[str],
        selected_experience_links: Mapping[str, Any],
        bank_suggestion_candidates: list[dict[str, Any]],
        fact_metadata: list[dict[str, Any]],
    ) -> None:
        self._snapshot = deepcopy(
            {
                "resume_id": resume_id,
                "resume_updated_at": resume_updated_at,
                "evaluation_signature": evaluation_signature,
                "jd_signature": jd_signature,
                "target_role": target_role,
                "evaluation": dict(evaluation),
                "current_resume": dict(current_resume),
                "selected_source_experiences": dict(selected_source_experiences),
                "selected_master_experience_ids": list(
                    selected_master_experience_ids
                ),
                "selected_experience_links": dict(selected_experience_links),
                "bank_suggestion_candidates": list(bank_suggestion_candidates),
                "fact_metadata": list(fact_metadata),
            }
        )
        self._snapshot_hash = hash_canonical_json(self._snapshot)

    @property
    def resume_id(self) -> str:
        return self._snapshot["resume_id"]

    @property
    def resume_updated_at(self) -> str:
        return self._snapshot["resume_updated_at"]

    @property
    def evaluation_signature(self) -> str:
        return self._snapshot["evaluation_signature"]

    @property
    def jd_signature(self) -> str:
        return self._snapshot["jd_signature"]

    @property
    def target_role(self) -> str:
        return self._snapshot["target_role"]

    @property
    def evaluation(self) -> dict[str, Any]:
        return deepcopy(self._snapshot["evaluation"])

    @property
    def current_resume(self) -> dict[str, Any]:
        return deepcopy(self._snapshot["current_resume"])

    @property
    def selected_source_experiences(self) -> dict[str, dict[str, Any]]:
        return deepcopy(self._snapshot["selected_source_experiences"])

    @property
    def selected_master_experience_ids(self) -> list[str]:
        return list(self._snapshot["selected_master_experience_ids"])

    @property
    def selected_experience_links(self) -> dict[str, dict[str, str]]:
        return deepcopy(self._snapshot["selected_experience_links"])

    @property
    def bank_suggestion_candidates(self) -> list[dict[str, Any]]:
        return deepcopy(self._snapshot["bank_suggestion_candidates"])

    @property
    def fact_metadata(self) -> list[dict[str, Any]]:
        return deepcopy(self._snapshot["fact_metadata"])

    @property
    def source_documents(self) -> dict[str, Any]:
        return {
            "currentResume": deepcopy(self._snapshot["current_resume"]),
            "selectedSourceExperiences": deepcopy(
                self._snapshot["selected_source_experiences"]
            ),
            "userAnswers": {},
        }

    @property
    def snapshot_hash(self) -> str:
        return self._snapshot_hash

    def snapshot_payload(self) -> dict[str, Any]:
        """Return the complete persistence snapshot, including apply identities."""
        return deepcopy(self._snapshot)

    def model_payload(self) -> dict[str, Any]:
        """Return only the context that may be sent to the optimization planner."""
        return deepcopy(
            {
                "resumeId": self.resume_id,
                "resumeUpdatedAt": self.resume_updated_at,
                "evaluationSignature": self.evaluation_signature,
                "jdSignature": self.jd_signature,
                "targetRole": self.target_role,
                "evaluation": self.evaluation,
                "currentResume": self.current_resume,
                "selectedSourceExperiences": self.selected_source_experiences,
                "selectedMasterExperienceIds": self.selected_master_experience_ids,
                "factMetadata": self.fact_metadata,
                "snapshotHash": self.snapshot_hash,
            }
        )


def _normalized_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_aware_expected_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise OptimizationContextRequestError(
            "expected_resume_updated_at must include a timezone"
        )
    return value.astimezone(timezone.utc)


def _string(value: Any) -> str:
    return str(value or "")


def _date_string(value: Any, *, current: bool = False) -> str:
    if current:
        return "至今"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return _string(value)


def _star(value: Any) -> dict[str, str]:
    source = value if isinstance(value, Mapping) else {}
    return {key: _string(source.get(key)) for key in ("s", "t", "a", "r")}


def _allowlist_current_experience(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    category = _string(value.get("category"))
    if category not in _EXPERIENCE_CATEGORIES:
        return None
    return {
        "id": _string(value.get("id")),
        "category": category,
        "title": _string(value.get("title")),
        "org": _string(value.get("org")),
        "start_date": _string(value.get("start_date")),
        "end_date": _string(value.get("end_date")),
        "star": _star(value.get("star")),
    }


def _allowlist_current_resume(
    value: Any,
    *,
    target_role: str,
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OptimizationEvaluationInvalidError(
            "The persisted resume analysis snapshot is invalid"
        )

    raw_profile = value.get("profile")
    profile = raw_profile if isinstance(raw_profile, Mapping) else {}
    raw_experiences = value.get("experiences")
    experiences: dict[str, dict[str, Any]] = {}
    if isinstance(raw_experiences, list):
        for raw_item in raw_experiences:
            item = _allowlist_current_experience(raw_item)
            if item is None:
                continue
            master_id = item["id"]
            if not master_id or master_id in experiences:
                raise OptimizationSelectionInvalidError(
                    "The current resume snapshot contains invalid experience IDs"
                )
            experiences[master_id] = item

    def allowlist_rows(key: str, fields: tuple[str, ...]) -> list[dict[str, str]]:
        raw_rows = value.get(key)
        if not isinstance(raw_rows, list):
            return []
        return [
            {field: _string(row.get(field)) for field in fields}
            for row in raw_rows
            if isinstance(row, Mapping)
        ]

    raw_section_order = value.get("section_order")
    section_order = (
        [_string(item) for item in raw_section_order if _string(item)]
        if isinstance(raw_section_order, list)
        else []
    )
    return {
        "section_order": section_order,
        "profile": {
            key: _string(profile.get(key))
            for key in ("name", "email", "phone", "location", "linkedin")
        },
        "target_role": target_role,
        "personal_summary": _string(value.get("personal_summary")),
        "experiences": experiences,
        "educations": allowlist_rows(
            "educations",
            (
                "id",
                "school",
                "major",
                "degree",
                "start_date",
                "end_date",
                "gpa",
                "courses",
            ),
        ),
        "certifications": allowlist_rows(
            "certifications", ("id", "name", "issuer", "issue_date")
        ),
        "skills": allowlist_rows("skills", ("id", "name", "category")),
    }


def _json_pointer_token(value: str) -> str:
    return value.replace("~", "~0").replace("/", "~1")


def _builder_source_tokens(source: str) -> list[str]:
    if source == "target_role":
        return ["currentResume", "target_role"]
    if not source.startswith("resume."):
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata contains an unsupported source"
        )

    tokens = ["currentResume"]
    cursor = len("resume.")
    while cursor < len(source):
        field_end = cursor
        while field_end < len(source) and source[field_end] not in ".[":
            field_end += 1
        if field_end == cursor:
            raise OptimizationEvaluationInvalidError(
                "Resume fact metadata contains an invalid source"
            )
        tokens.append(source[cursor:field_end])
        cursor = field_end
        while cursor < len(source) and source[cursor] == "[":
            close = source.find("]", cursor + 1)
            if close < 0:
                raise OptimizationEvaluationInvalidError(
                    "Resume fact metadata contains an invalid list source"
                )
            index = source[cursor + 1 : close]
            if not index.isdigit():
                raise OptimizationEvaluationInvalidError(
                    "Resume fact metadata contains an invalid list index"
                )
            tokens.append(index)
            cursor = close + 1
        if cursor == len(source):
            break
        if source[cursor] != ".":
            raise OptimizationEvaluationInvalidError(
                "Resume fact metadata contains an invalid source"
            )
        cursor += 1
    return tokens


def _fact_source_pointer(
    source: str,
    *,
    current_resume: Mapping[str, Any],
) -> str:
    tokens = _builder_source_tokens(source)
    if len(tokens) >= 3 and tokens[1] == "experiences":
        try:
            experience_index = int(tokens[2])
            master_id = list(current_resume["experiences"])[experience_index]
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise OptimizationEvaluationInvalidError(
                "Resume fact metadata references an unknown experience"
            ) from exc
        tokens[2] = master_id
    return "/" + "/".join(_json_pointer_token(token) for token in tokens)


def _allowlist_fact_metadata(
    value: Any,
    *,
    current_resume: Mapping[str, Any],
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    allowed: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            continue
        entry = {
            "fact_id": _string(item.get("fact_id")),
            "content": _string(item.get("content")),
            "verification_status": _string(item.get("verification_status")),
            "source": _fact_source_pointer(
                _string(item.get("source")),
                current_resume=current_resume,
            ),
            "confidence": deepcopy(item.get("confidence")),
        }
        if entry["fact_id"] and entry["content"]:
            allowed.append(entry)
    return allowed


def _decode_json_pointer_token(token: str) -> str:
    decoded: list[str] = []
    cursor = 0
    while cursor < len(token):
        if token[cursor] != "~":
            decoded.append(token[cursor])
            cursor += 1
            continue
        if cursor + 1 >= len(token) or token[cursor + 1] not in {"0", "1"}:
            raise OptimizationEvaluationInvalidError(
                "Resume fact metadata contains a malformed JSON Pointer"
            )
        decoded.append("~" if token[cursor + 1] == "0" else "/")
        cursor += 2
    return "".join(decoded)


def _resolve_fact_pointer(documents: Mapping[str, Any], pointer: Any) -> Any:
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source must be an absolute JSON Pointer"
        )
    raw_tokens = pointer[1:].split("/")
    if not raw_tokens or not raw_tokens[0]:
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source has no allowed root"
        )
    tokens = [_decode_json_pointer_token(token) for token in raw_tokens]
    if tokens[0] not in _SOURCE_DOCUMENT_ROOTS:
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source has an unsupported root"
        )

    current: Any = documents
    for token in tokens:
        if isinstance(current, Mapping):
            if token not in current:
                raise OptimizationEvaluationInvalidError(
                    "Resume fact metadata source does not exist"
                )
            current = current[token]
            continue
        if isinstance(current, list):
            if not token.isdigit() or (len(token) > 1 and token.startswith("0")):
                raise OptimizationEvaluationInvalidError(
                    "Resume fact metadata contains an invalid array index"
                )
            index = int(token)
            if index >= len(current):
                raise OptimizationEvaluationInvalidError(
                    "Resume fact metadata array index is out of range"
                )
            current = current[index]
            continue
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source traverses a scalar"
        )
    return current


def _normalized_fact_text(value: Any) -> str:
    if (
        value is None
        or isinstance(value, (Mapping, list, tuple, set, bool))
        or not isinstance(value, (str, int, float))
    ):
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source must resolve to a scalar"
        )
    if isinstance(value, float) and not math.isfinite(value):
        raise OptimizationEvaluationInvalidError(
            "Resume fact metadata source must resolve to a finite scalar"
        )
    return str(value).strip()


def _validate_fact_metadata_sources(
    fact_metadata: list[dict[str, Any]],
    source_documents: Mapping[str, Any],
) -> None:
    for fact in fact_metadata:
        resolved = _resolve_fact_pointer(source_documents, fact.get("source"))
        if _normalized_fact_text(resolved) != _string(fact.get("content")).strip():
            raise OptimizationEvaluationInvalidError(
                "Resume fact metadata content does not match its source"
            )


def _category_value(value: Any) -> str:
    if isinstance(value, ExperienceCategory):
        return value.value
    return _string(value)


def _linked_items_by_master(resume_items: list[Any]) -> dict[str, Any]:
    by_master: dict[str, Any] = {}
    link_ids: set[str] = set()
    for item in resume_items:
        link_id = _string(getattr(item, "id", ""))
        experience = getattr(item, "experience", None)
        master_id = _string(getattr(experience, "master_experience_id", ""))
        version_id = _string(getattr(item, "experience_version_id", ""))
        if not link_id or not master_id or not version_id:
            raise OptimizationSelectionInvalidError(
                "Resume experience links contain an incomplete entry"
            )
        if link_id in link_ids or master_id in by_master:
            raise OptimizationSelectionInvalidError(
                "Resume experience links contain a duplicate entry"
            )
        link_ids.add(link_id)
        by_master[master_id] = item
    return by_master


def _explicit_selected_ids(config: Any) -> list[str] | None:
    if not isinstance(config, Mapping):
        raise OptimizationEvaluationInvalidError("Resume config is invalid")
    selection = config.get("selection")
    if not isinstance(selection, Mapping) or "experienceIds" not in selection:
        return None
    raw_ids = selection.get("experienceIds")
    if not isinstance(raw_ids, list):
        raise OptimizationSelectionInvalidError(
            "selection.experienceIds must be an array"
        )
    selected: list[str] = []
    seen: set[str] = set()
    for raw_id in raw_ids:
        selected_id = _string(raw_id)
        if not selected_id or selected_id in seen:
            raise OptimizationSelectionInvalidError(
                "selection.experienceIds contains an invalid or duplicate ID"
            )
        seen.add(selected_id)
        selected.append(selected_id)
    return selected


def _validate_report(
    resume: Any,
    request: ResumeOptimizationStartRequest,
) -> tuple[dict[str, Any], str, str]:
    expected_timestamp = _require_aware_expected_timestamp(
        request.expected_resume_updated_at
    )
    actual_timestamp = getattr(resume, "updated_at", None)
    if not isinstance(actual_timestamp, datetime):
        raise OptimizationEvaluationInvalidError("Resume updated_at is invalid")
    if _normalized_timestamp(actual_timestamp) != expected_timestamp:
        raise OptimizationContextStaleError(
            "Resume changed since the evaluation snapshot was requested"
        )

    config = getattr(resume, "config", None)
    if not isinstance(config, Mapping):
        raise OptimizationEvaluationInvalidError("Resume config is invalid")
    analysis = config.get("jdAnalysis")
    if not isinstance(analysis, Mapping):
        raise OptimizationEvaluationInvalidError(
            "A persisted six-dimensional evaluation is required"
        )
    if analysis.get("evaluationIsOutdated") is True:
        raise OptimizationContextStaleError(
            "The persisted six-dimensional evaluation is outdated"
        )
    persisted_signature = analysis.get("evaluationSignature")
    if not isinstance(persisted_signature, str) or not persisted_signature:
        raise OptimizationEvaluationInvalidError(
            "The persisted evaluation signature is missing"
        )
    if persisted_signature != request.evaluation_signature:
        raise OptimizationContextStaleError(
            "The evaluation signature no longer matches this request"
        )
    result = analysis.get("result")
    evaluation = (
        result.get("resumeEvaluation") if isinstance(result, Mapping) else None
    )
    if not isinstance(evaluation, Mapping):
        raise OptimizationEvaluationInvalidError(
            "A persisted six-dimensional evaluation is required"
        )
    if evaluation.get("evaluationVersion") != EVALUATION_VERSION:
        raise OptimizationEvaluationInvalidError(
            f"resumeEvaluation.evaluationVersion must be {EVALUATION_VERSION}"
        )
    jd_signature = analysis.get("jdInputSignature")
    if not isinstance(jd_signature, str):
        raise OptimizationEvaluationInvalidError(
            "The persisted JD input signature is invalid"
        )
    return deepcopy(dict(evaluation)), persisted_signature, jd_signature


def _parse_analysis_text(value: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError) as exc:
        raise OptimizationEvaluationInvalidError(
            "The current resume analysis snapshot is invalid"
        ) from exc
    if not isinstance(parsed, Mapping):
        raise OptimizationEvaluationInvalidError(
            "The current resume analysis snapshot must be an object"
        )
    return parsed


def _match_metadata(result: Any) -> dict[str, dict[str, Any]]:
    raw_matches = result.get("experienceMatches") if isinstance(result, Mapping) else None
    if not isinstance(raw_matches, list):
        return {}
    metadata: dict[str, dict[str, Any]] = {}
    for item in raw_matches:
        if not isinstance(item, Mapping):
            continue
        master_id = _string(item.get("id"))
        if not master_id or master_id in metadata:
            continue
        raw_score = item.get("score")
        score = 0
        if (
            not isinstance(raw_score, bool)
            and isinstance(raw_score, (int, float))
            and math.isfinite(float(raw_score))
        ):
            score = max(0, min(100, int(round(float(raw_score)))))
        metadata[master_id] = {
            "match_score": score,
            "reason": _string(item.get("reason")),
        }
    return metadata


def _bank_candidates(
    parsed: Mapping[str, Any],
    *,
    selected_ids: set[str],
    analysis_result: Any,
    enabled: bool,
) -> list[dict[str, Any]]:
    if not enabled:
        return []
    raw_atoms = parsed.get("experience_atoms")
    if not isinstance(raw_atoms, list):
        return []
    matches = _match_metadata(analysis_result)
    candidates: dict[str, dict[str, Any]] = {}
    for atom in raw_atoms:
        if not isinstance(atom, Mapping):
            continue
        master_id = _string(atom.get("id"))
        category = _string(atom.get("category"))
        if (
            not master_id
            or master_id in selected_ids
            or master_id in candidates
            or category not in _EXPERIENCE_CATEGORIES
        ):
            continue
        match = matches.get(master_id, {"match_score": 0, "reason": ""})
        candidates[master_id] = {
            "master_experience_id": master_id,
            "category": category,
            "title": _string(atom.get("title")),
            "org": _string(atom.get("org")),
            "match_score": match["match_score"],
            "reason": match["reason"],
        }
    return sorted(
        candidates.values(),
        key=lambda item: (-item["match_score"], item["master_experience_id"]),
    )


def _source_experience(version: Any, category: str) -> dict[str, Any]:
    return {
        "id": _string(getattr(version, "master_experience_id", "")),
        "category": category,
        "title": _string(getattr(version, "title", "")),
        "org": _string(getattr(version, "org", "")),
        "start_date": _date_string(getattr(version, "start_date", None)),
        "end_date": _date_string(
            getattr(version, "end_date", None),
            current=bool(getattr(version, "is_current", False)),
        ),
        "summary": _string(getattr(version, "summary", "")),
        "star": _star(getattr(version, "star", None)),
        "source_version_id": _string(getattr(version, "id", "")),
    }


async def build_frozen_optimization_context(
    session: AsyncSession,
    user_id: str,
    request: ResumeOptimizationStartRequest,
) -> FrozenOptimizationContext:
    try:
        uuid.UUID(request.resume_id)
    except (AttributeError, TypeError, ValueError) as exc:
        raise OptimizationContextRequestError("resume_id must be a valid UUID") from exc

    try:
        resume, resume_items = await get_resume_detail(
            session, user_id, request.resume_id
        )
    except ResumeNotFoundError as exc:
        raise OptimizationContextNotFoundError("Resume not found") from exc

    evaluation, evaluation_signature, jd_signature = _validate_report(
        resume, request
    )
    linked_by_master = _linked_items_by_master(list(resume_items))
    explicit_selected_ids = _explicit_selected_ids(getattr(resume, "config", None))
    if explicit_selected_ids is not None:
        unlinked = [
            master_id
            for master_id in explicit_selected_ids
            if master_id not in linked_by_master
        ]
        if unlinked:
            raise OptimizationSelectionInvalidError(
                "The resume selects an experience without a persisted resume link"
            )

    bank = await _load_agent_bank(session, user_id)
    category_by_master_id = await _load_resume_item_categories(
        session, user_id, list(resume_items)
    )
    analysis_text = await build_resume_analysis_text(
        session,
        user_id,
        resume,
        resume_items=list(resume_items),
        bank=bank,
        category_by_master_id=category_by_master_id,
        target_role=resume.target_role,
    )
    parsed = _parse_analysis_text(analysis_text)
    target_role = _string(getattr(resume, "target_role", ""))
    current_resume = _allowlist_current_resume(
        parsed.get("resume"),
        target_role=target_role,
    )
    selected_master_ids = list(current_resume["experiences"])
    if (
        not all(selected_master_ids)
        or len(set(selected_master_ids)) != len(selected_master_ids)
    ):
        raise OptimizationSelectionInvalidError(
            "The current resume snapshot contains invalid experience IDs"
        )
    if explicit_selected_ids is not None and (
        len(selected_master_ids) != len(explicit_selected_ids)
        or set(selected_master_ids) != set(explicit_selected_ids)
    ):
        raise OptimizationSelectionInvalidError(
            "The current resume snapshot does not match the persisted selection"
        )
    if any(master_id not in linked_by_master for master_id in selected_master_ids):
        raise OptimizationSelectionInvalidError(
            "The current resume snapshot contains an unlinked experience"
        )

    selected_sources: dict[str, dict[str, Any]] = {}
    selected_links: dict[str, dict[str, str]] = {}
    for master_id in selected_master_ids:
        item = linked_by_master[master_id]
        source_version_id = _string(getattr(item, "experience_version_id", ""))
        try:
            source_version = await get_version_for_user(
                session, user_id, source_version_id
            )
        except ExperienceNotFoundError as exc:
            raise OptimizationSelectionInvalidError(
                "A selected source experience version is unavailable"
            ) from exc
        if (
            _string(getattr(source_version, "id", "")) != source_version_id
            or _string(getattr(source_version, "master_experience_id", ""))
            != master_id
        ):
            raise OptimizationSelectionInvalidError(
                "A resume link does not match its selected source version"
            )
        category = _category_value(category_by_master_id.get(master_id))
        if category not in _EXPERIENCE_CATEGORIES:
            raise OptimizationSelectionInvalidError(
                "A selected source experience has an unsupported category"
            )
        selected_sources[master_id] = _source_experience(source_version, category)
        selected_links[master_id] = {
            "resume_link_id": _string(getattr(item, "id", "")),
            "source_version_id": source_version_id,
        }

    config = getattr(resume, "config", None)
    analysis = config.get("jdAnalysis") if isinstance(config, Mapping) else None
    analysis_result = analysis.get("result") if isinstance(analysis, Mapping) else None
    bank_candidates = _bank_candidates(
        parsed,
        selected_ids=set(selected_master_ids),
        analysis_result=analysis_result,
        enabled=request.include_bank_suggestions,
    )
    fact_metadata = _allowlist_fact_metadata(
        parsed.get("fact_metadata"),
        current_resume=current_resume,
    )
    resume_updated_at = _normalized_timestamp(resume.updated_at).isoformat()

    source_documents = {
        "currentResume": deepcopy(current_resume),
        "selectedSourceExperiences": deepcopy(selected_sources),
        "userAnswers": {},
    }
    if set(source_documents) != _SOURCE_DOCUMENT_ROOTS:
        raise AssertionError("Unexpected optimization source document root")
    _validate_fact_metadata_sources(fact_metadata, source_documents)

    return FrozenOptimizationContext(
        resume_id=_string(resume.id),
        resume_updated_at=resume_updated_at,
        evaluation_signature=evaluation_signature,
        jd_signature=jd_signature,
        target_role=target_role,
        evaluation=deepcopy(evaluation),
        current_resume=deepcopy(current_resume),
        selected_source_experiences=deepcopy(selected_sources),
        selected_master_experience_ids=list(selected_master_ids),
        selected_experience_links=deepcopy(selected_links),
        bank_suggestion_candidates=deepcopy(bank_candidates),
        fact_metadata=deepcopy(fact_metadata),
    )
