from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import json
import math
from typing import Any, Mapping
import uuid

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import ExperienceCategory, MasterExperience
from ..agent.agent_resume_helpers import (
    _load_agent_bank,
    _load_resume_item_categories,
)
from ..agent.agent_service import build_resume_analysis_text
from ..experience.experience_service import (
    NotFoundError as ExperienceNotFoundError,
    get_version_for_user,
)
from ..ai.guidance_receipts import (
    GuidanceReceiptError,
    canonical_json_hash as guidance_binding_hash,
    load_guidance_receipt,
    validate_public_receipt_binding,
)
from ..ai.resume_evaluation import SCORING_VERSION, normalize_resume_evaluation
from ..resume.resume_service import (
    NotFoundError as ResumeNotFoundError,
    get_resume_detail,
)
from .run_service import hash_canonical_json
from .schemas import ResumeOptimizationStartRequest


_SOURCE_DOCUMENT_ROOTS = frozenset(
    {"currentResume", "selectedSourceExperiences", "userAnswers"}
)
_EXPERIENCE_CATEGORIES = frozenset({"work", "project"})
_FRONTEND_EVALUATION_SECTION_ORDER = (
    "summary",
    "education",
    "work",
    "project",
    "certifications",
    "skills",
)
FRONTEND_EVALUATION_SIGNATURE_SCHEMA = "frontend_evaluation_v2"
_JD_ATTACHMENT_SUPPLEMENT_PREFIX = "\n\n补充 JD 说明：\n"
GUIDANCE_VERSION = "guidance_audit_v1"


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
        evaluation_signature_schema: str = FRONTEND_EVALUATION_SIGNATURE_SCHEMA,
    ) -> None:
        if evaluation_signature_schema != FRONTEND_EVALUATION_SIGNATURE_SCHEMA:
            raise OptimizationEvaluationInvalidError(
                "The evaluation signature schema is invalid"
            )
        self._snapshot = deepcopy(
            {
                "resume_id": resume_id,
                "resume_updated_at": resume_updated_at,
                "evaluation_signature_schema": FRONTEND_EVALUATION_SIGNATURE_SCHEMA,
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
    def evaluation_signature_schema(self) -> str:
        return self._snapshot["evaluation_signature_schema"]

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
        public_planner_evaluation = self.evaluation
        for private_key in (
            "_guidanceReceiptBinding",
            "_guidanceTasks",
            "_guidanceSources",
        ):
            public_planner_evaluation.pop(private_key, None)
        return deepcopy(
            {
                "resumeId": self.resume_id,
                "resumeUpdatedAt": self.resume_updated_at,
                # Both frontend signatures may embed the full resume/JD input.
                # The planner needs stable identities, not those raw envelopes.
                "evaluationSignature": (
                    f"sha256:{hash_canonical_json(self.evaluation_signature)}"
                ),
                "jdSignature": f"sha256:{hash_canonical_json(self.jd_signature)}",
                "targetRole": self.target_role,
                "evaluation": public_planner_evaluation,
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


async def _archived_master_ids_for_user(
    session: AsyncSession,
    user_id: str,
    master_ids: list[str],
) -> set[str]:
    if not master_ids:
        return set()
    try:
        parsed_ids = [uuid.UUID(master_id) for master_id in master_ids]
    except (AttributeError, TypeError, ValueError) as exc:
        raise OptimizationSelectionInvalidError(
            "selection.experienceIds contains an invalid ID"
        ) from exc
    result = await session.execute(
        select(MasterExperience.id).where(
            MasterExperience.user_id == user_id,
            MasterExperience.id.in_(parsed_ids),
            MasterExperience.is_archived.is_(True),
        )
    )
    return {str(master_id) for master_id in result.scalars().all()}


def _canonical_persisted_jd(
    analysis: Mapping[str, Any],
) -> tuple[str, str, str]:
    raw_mode = analysis.get("inputMode") if "inputMode" in analysis else "text"
    if raw_mode not in {"text", "attachment"}:
        raise OptimizationEvaluationInvalidError(
            "The persisted JD input mode is invalid"
        )
    raw_jd_text = analysis.get("jdText")
    if not isinstance(raw_jd_text, str):
        raise OptimizationEvaluationInvalidError(
            "The persisted JD text is invalid"
        )
    jd_text = raw_jd_text.strip()
    raw_attachment_text = analysis.get("attachmentExtractedText")
    attachment_text = (
        raw_attachment_text.strip()
        if isinstance(raw_attachment_text, str)
        else ""
    )
    if raw_mode == "text":
        # Modern attachment analysis is promoted to text mode after extraction,
        # while retaining the extracted body for provenance checks.
        return jd_text, attachment_text, jd_text

    if not attachment_text:
        # A filename proves only that a file once existed.  The text-only
        # evaluation route cannot reproduce or verify that JD after reload.
        raise OptimizationEvaluationInvalidError(
            "The persisted JD attachment text is unavailable"
        )
    if raw_jd_text == attachment_text:
        supplemental_text = ""
    else:
        prefix = f"{attachment_text}{_JD_ATTACHMENT_SUPPLEMENT_PREFIX}"
        supplemental_text = (
            raw_jd_text[len(prefix) :].strip()
            if raw_jd_text.startswith(prefix)
            else jd_text
        )
    canonical_text = (
        f"{attachment_text}{_JD_ATTACHMENT_SUPPLEMENT_PREFIX}{supplemental_text}"
        if supplemental_text
        else attachment_text
    )
    return canonical_text, attachment_text, jd_text


def _validate_persisted_jd_provenance(
    analysis: Mapping[str, Any],
    analysis_result: Mapping[str, Any],
    *,
    jd_signature: str,
) -> bool:
    persisted_input_mode = (
        analysis.get("inputMode") if "inputMode" in analysis else "text"
    )
    canonical_text, attachment_text, signed_input_text = _canonical_persisted_jd(
        analysis
    )
    jd_available = bool(canonical_text)
    if not jd_available:
        # Old no-JD analyses may retain opaque identities, but they cannot be
        # used to derive JD matches or bank candidates.
        return False

    signature_binds_input = False
    try:
        parsed_signature = json.loads(jd_signature)
    except (TypeError, ValueError):
        parsed_signature = None
    if parsed_signature is not None:
        from . import apply_service

        try:
            parsed_signature = apply_service._load_frontend_canonical_json(
                jd_signature,
                field_name="persisted JD input signature",
            )
        except apply_service.OptimizationRunDataInvalidError as exc:
            raise OptimizationEvaluationInvalidError(
                "The persisted JD input signature does not match its text"
            ) from exc
        if (
            not isinstance(parsed_signature, Mapping)
            or set(parsed_signature)
            != {"inputMode", "textSignature", "attachmentSignature"}
            or parsed_signature.get("inputMode") != persisted_input_mode
            or parsed_signature.get("textSignature") != signed_input_text
            or (
                persisted_input_mode == "text"
                and parsed_signature.get("attachmentSignature") is not None
            )
            or (
                persisted_input_mode == "attachment"
                and parsed_signature.get("attachmentSignature") is None
            )
        ):
            raise OptimizationEvaluationInvalidError(
                "The persisted JD input signature does not match its text"
            )
        signature_binds_input = True

    raw_result_text = analysis_result.get("extractedJdText")
    result_text = raw_result_text.strip() if isinstance(raw_result_text, str) else ""
    result_binds_canonical = result_text == canonical_text
    result_binds_attachment = bool(attachment_text) and result_text == attachment_text
    if result_text and not (result_binds_canonical or result_binds_attachment):
        raise OptimizationEvaluationInvalidError(
            "The persisted JD input does not match its analysis provenance"
        )

    if persisted_input_mode == "text":
        fully_bound = signature_binds_input or result_binds_canonical
    else:
        input_contains_body = signed_input_text == canonical_text
        fully_bound = result_binds_canonical or (
            signature_binds_input
            and (input_contains_body or result_binds_attachment)
        )
    if not fully_bound:
        raise OptimizationEvaluationInvalidError(
            "The persisted JD input does not match its analysis provenance"
        )
    return True


def _validate_report(
    resume: Any,
    request: ResumeOptimizationStartRequest,
) -> tuple[
    dict[str, Any],
    str,
    str,
    bool,
    dict[str, Any],
    dict[str, Any],
]:
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
    if analysis.get("isOutdated") is True:
        raise OptimizationContextStaleError(
            "The persisted JD analysis is outdated"
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
    jd_signature = analysis.get("jdInputSignature")
    if not isinstance(jd_signature, str):
        raise OptimizationEvaluationInvalidError(
            "The persisted JD input signature is invalid"
        )
    jd_available = _validate_persisted_jd_provenance(
        analysis,
        result,
        jd_signature=jd_signature,
    )
    if jd_available:
        outer_jd_match = result.get("matchPercentage")
        if (
            isinstance(outer_jd_match, bool)
            or not isinstance(outer_jd_match, int)
            or not 0 <= outer_jd_match <= 100
        ):
            raise OptimizationEvaluationInvalidError(
                "The persisted JD match is invalid"
            )
        evaluation_jd_match = evaluation.get("jdMatch")
        if (
            isinstance(evaluation_jd_match, bool)
            or not isinstance(evaluation_jd_match, int)
            or not 0 <= evaluation_jd_match <= 100
            or outer_jd_match != evaluation_jd_match
        ):
            raise OptimizationEvaluationInvalidError(
                "The persisted JD match does not match the six-dimensional evaluation"
            )
    elif evaluation.get("jdMatch") is not None:
        raise OptimizationEvaluationInvalidError(
            "The persisted guidance JD match must be null without a JD"
        )
    signed_resume_snapshot = _parse_persisted_frontend_evaluation_signature(
        persisted_signature,
        jd_signature=jd_signature,
    )
    return (
        deepcopy(dict(evaluation)),
        persisted_signature,
        jd_signature,
        jd_available,
        signed_resume_snapshot,
        deepcopy(dict(result)),
    )


async def _resolve_guidance_evaluation(
    evaluation: Mapping[str, Any],
    *,
    user_id: str,
    evaluation_input: Mapping[str, Any],
    jd_available: bool,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], Any]:
    raw_binding = evaluation.get("auditReceipt")
    receipt_id = raw_binding.get("receiptId") if isinstance(raw_binding, Mapping) else None
    if not isinstance(receipt_id, str) or not receipt_id.strip():
        raise OptimizationEvaluationInvalidError(
            "The persisted guidance audit receipt is missing"
        )
    try:
        receipt = await load_guidance_receipt(receipt_id=receipt_id, user_id=user_id)
        receipt = validate_public_receipt_binding(evaluation, receipt)
    except GuidanceReceiptError as exc:
        raise OptimizationEvaluationInvalidError(
            "The persisted guidance audit receipt failed integrity checks"
        ) from exc

    current_input = {
        "resume": evaluation_input.get("resume"),
        "fact_metadata": evaluation_input.get("fact_metadata"),
    }
    if guidance_binding_hash(current_input) != receipt["input_hash"]:
        raise OptimizationContextStaleError(
            "The guidance receipt no longer matches the current resume"
        )
    receipt_input = receipt["input"]
    if evaluation.get("targetRole", "") != evaluation_input.get("target_role", ""):
        raise OptimizationContextStaleError(
            "The guidance receipt no longer matches the current target role"
        )
    try:
        from ..ai.guidance_evaluation import rebuild_guidance_receipt

        internal = rebuild_guidance_receipt(evaluation, receipt)
    except (GuidanceReceiptError, KeyError, TypeError, ValueError) as exc:
        raise OptimizationEvaluationInvalidError(
            "The private guidance report failed integrity checks"
        ) from exc
    if internal.get("scoringVersion") != GUIDANCE_VERSION:
        raise OptimizationEvaluationInvalidError(
            "The private guidance report has an invalid scoring version"
        )
    if (
        internal.get("targetRole") != evaluation.get("targetRole")
        or internal.get("jdMatch") != evaluation.get("jdMatch")
    ):
        raise OptimizationEvaluationInvalidError(
            "The public and private guidance reports disagree"
        )
    return (
        internal,
        deepcopy(dict(raw_binding)),
        deepcopy(receipt["tasks"]),
        deepcopy(receipt["sources"]),
    )


def _normalize_persisted_evaluation(
    evaluation: Mapping[str, Any],
    *,
    jd_available: bool,
    fact_metadata: list[dict[str, Any]],
) -> dict[str, Any]:
    if evaluation.get("evaluationVersion") == GUIDANCE_VERSION:
        raise OptimizationEvaluationInvalidError(
            "Guidance evaluation requires its private audit receipt"
        )
    try:
        normalized = normalize_resume_evaluation(
            dict(evaluation),
            jd_available=jd_available,
            fact_metadata=fact_metadata,
        )
        confidence = normalized.get("evaluationConfidence")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
        ):
            raise ValueError("normalized evaluation confidence is not finite")
    except (TypeError, ValueError) as exc:
        raise OptimizationEvaluationInvalidError(
            "The persisted six-dimensional evaluation failed integrity checks"
        ) from exc
    # Numeric coverage reports remain readable elsewhere, but no longer have
    # authority to start a new optimization or comparison.
    raise OptimizationContextStaleError("评估规则已更新，请重新生成指导报告后再优化。")


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


def _parse_persisted_frontend_evaluation_signature(
    raw_signature: str,
    *,
    jd_signature: str,
    evaluation: Mapping[str, Any] | None = None,
    analysis_result: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate the editor-owned five-field signature, never a legacy digest.

    The canonical parser is shared with apply/finalize so a run cannot be
    started under weaker signature semantics than the later mutation paths.
    """

    from . import apply_service

    kwargs: dict[str, Any] = {}
    if evaluation is not None:
        kwargs["expected_evaluation"] = evaluation
    if analysis_result is not None:
        kwargs["expected_jd_result"] = analysis_result
    try:
        return apply_service._parse_frontend_evaluation_signature(
            raw_signature,
            jd_input_signature=jd_signature,
            field_name="persisted evaluation signature",
            **kwargs,
        )
    except apply_service.OptimizationRunDataInvalidError as exc:
        raise OptimizationEvaluationInvalidError(
            "The persisted evaluation signature is invalid"
        ) from exc


def _frontend_plain_text(value: Any) -> str:
    from . import apply_service

    return apply_service._frontend_plain_text(value)


def _frontend_star_text(value: Any) -> str:
    return _frontend_plain_text(_frontend_star_value(value))


def _frontend_star_value(value: Any) -> str:
    from . import apply_service

    if isinstance(value, list):
        def js_string(item: Any) -> str:
            if item is None:
                return ""
            if isinstance(item, bool):
                return "true" if item else "false"
            if isinstance(item, list):
                return ",".join(js_string(nested) for nested in item)
            if isinstance(item, Mapping):
                return "[object Object]"
            return str(item)

        value = "、".join(js_string(item) for item in value)
    normalized = apply_service._frontend_decode_rich_text_entities_deep(value)
    if (
        apply_service._FRONTEND_RICH_TEXT_HTML_TAG_RE.search(normalized)
        is not None
        or apply_service._FRONTEND_MARKDOWN_TRIGGER_RE.search(normalized)
        is not None
    ):
        normalized = apply_service._frontend_sanitized_html(normalized)
    return normalized


def _frontend_api_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _frontend_year_month(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return f"{value.year:04d}.{value.month:02d}"
    text = str(value).strip()
    if not text:
        return ""
    normalized = text.replace("/", "-").replace(".", "-")
    parts = normalized.split("-")
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        return f"{int(parts[0]):04d}.{int(parts[1]):02d}"
    return text.replace("-", ".")


def _ordered_by_ids(
    items: list[dict[str, Any]],
    raw_ids: Any,
) -> list[dict[str, Any]]:
    if not isinstance(raw_ids, list) or not raw_ids or len(items) <= 1:
        return items
    by_id = {_string(item.get("id")): item for item in items}
    used: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for raw_id in raw_ids:
        item_id = _string(raw_id)
        if item_id in used or item_id not in by_id:
            continue
        used.add(item_id)
        ordered.append(by_id[item_id])
    ordered.extend(item for item in items if _string(item.get("id")) not in used)
    return ordered


def _frontend_date_sort_value(value: Any) -> int:
    if isinstance(value, (date, datetime)):
        return value.year * 12 + value.month
    text = _string(value).strip().replace("/", "-").replace(".", "-")
    parts = text.split("-")
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        month = int(parts[1])
        if 1 <= month <= 12:
            return int(parts[0]) * 12 + month
    return -1


def _row_pair(value: Any, *, field_name: str) -> tuple[Any, Any]:
    try:
        return value[0], value[1]
    except (IndexError, KeyError, TypeError) as exc:
        mapping = getattr(value, "_mapping", None)
        if isinstance(mapping, Mapping):
            values = list(mapping.values())
            if len(values) >= 2:
                return values[0], values[1]
        raise OptimizationEvaluationInvalidError(
            f"The {field_name} snapshot is invalid"
        ) from exc


def _selection_ids(
    config: Mapping[str, Any],
    key: str,
    available_ids: list[str],
) -> list[str]:
    selection = config.get("selection")
    if not isinstance(selection, Mapping) or key not in selection:
        return list(available_ids)
    raw_ids = selection.get(key)
    if not isinstance(raw_ids, list):
        return []
    available = set(available_ids)
    selected: list[str] = []
    for raw_id in raw_ids:
        item_id = _string(raw_id)
        if item_id and item_id in available and item_id not in selected:
            selected.append(item_id)
    return selected


def _actual_frontend_profile(
    *,
    resume: Any,
    bank: Mapping[str, Any],
) -> tuple[dict[str, str], str] | None:
    config_value = getattr(resume, "config", None)
    config = config_value if isinstance(config_value, Mapping) else {}
    service = bank.get("profile")
    if (
        service is None
        and "profile" not in config
        and "personalSummary" not in config
    ):
        return None

    defaults = {
        "name": "",
        "email": "",
        "phone": "",
        "location": "",
        "linkedin": "",
        "summary": "",
        "avatarDataUrl": "",
    }
    service_profile: dict[str, Any] | None = None
    if service is not None:
        social_links_value = getattr(service, "social_links", None)
        social_links = (
            social_links_value if isinstance(social_links_value, Mapping) else {}
        )
        linkedin_value = social_links.get("linkedin")
        if isinstance(linkedin_value, Mapping):
            linkedin_value = linkedin_value.get("url")
        extra_value = getattr(service, "extra_json", None)
        extra = extra_value if isinstance(extra_value, Mapping) else {}
        service_profile = {
            "name": _string(getattr(service, "full_name", "")),
            "email": _string(getattr(service, "email", "")),
            "phone": _string(getattr(service, "phone", "")),
            "location": _string(getattr(service, "location", "")),
            "linkedin": _string(linkedin_value),
            "summary": _string(getattr(service, "summary", "")),
            "avatarDataUrl": (
                extra.get("avatar_data_url")
                if isinstance(extra.get("avatar_data_url"), str)
                else ""
            ),
        }

    config_profile_value = config.get("profile")
    config_profile = (
        config_profile_value
        if isinstance(config_profile_value, Mapping)
        else None
    )
    raw_mode = config.get("profileSyncMode")
    if raw_mode in {"global", "local"}:
        mode = raw_mode
    elif config_profile is None:
        mode = "global"
    elif service_profile is not None and all(
        config_profile.get(key) == service_profile.get(key)
        for key in defaults
    ):
        mode = "global"
    else:
        mode = "local"

    if mode == "local":
        if config_profile is not None:
            resolved: dict[str, Any] = {**defaults, **dict(config_profile)}
        else:
            resolved = dict(service_profile or defaults)
    elif service_profile is not None:
        resolved = dict(service_profile)
    elif config_profile is not None:
        resolved = {**defaults, **dict(config_profile)}
    else:
        resolved = dict(defaults)

    layout_value = config.get("layout")
    layout = layout_value if isinstance(layout_value, Mapping) else {}
    has_summary_override = isinstance(config.get("personalSummary"), str)
    summary_source = (
        config.get("personalSummary")
        if has_summary_override
        else resolved.get("summary")
    )
    stored_visibility = layout.get("isSummaryVisible")
    if stored_visibility is None:
        summary_visible = bool(_string(summary_source).strip())
    else:
        summary_visible = bool(stored_visibility)
    personal_summary = (
        _frontend_plain_text(summary_source) if summary_visible else ""
    )
    return (
        {
            key: _frontend_plain_text(resolved.get(key))
            for key in ("name", "email", "phone", "location", "linkedin")
        },
        personal_summary,
    )


def _actual_frontend_collections(
    *,
    resume: Any,
    resume_items: list[Any],
    bank: Mapping[str, Any],
    category_by_master_id: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Rebuild editor collections from DB-backed rows and linked overrides.

    Empty mocked banks intentionally return ``None`` so isolated context tests
    can continue supplying their server-built analysis payload directly. In a
    real request the same loader feeds both this projection and the analysis
    builder.
    """

    raw_experience_rows = bank.get("experiences")
    raw_certifications = bank.get("certifications")
    raw_skill_rows = bank.get("skills")
    if not any(
        isinstance(value, list) and value
        for value in (raw_experience_rows, raw_certifications, raw_skill_rows)
    ):
        return None

    config_value = getattr(resume, "config", None)
    config = config_value if isinstance(config_value, Mapping) else {}
    layout_value = config.get("layout")
    layout = layout_value if isinstance(layout_value, Mapping) else {}
    orders_value = layout.get("orders")
    orders = orders_value if isinstance(orders_value, Mapping) else {}

    linked = _linked_items_by_master(resume_items)
    work_views: list[dict[str, Any]] = []
    project_views: list[dict[str, Any]] = []
    education_views: list[dict[str, Any]] = []
    for raw_row in raw_experience_rows if isinstance(raw_experience_rows, list) else []:
        master, latest = _row_pair(raw_row, field_name="experience bank")
        if latest is None:
            continue
        master_id = _string(getattr(master, "id", ""))
        category = _category_value(getattr(master, "category", None))
        if not master_id:
            raise OptimizationEvaluationInvalidError(
                "The experience bank snapshot contains an invalid ID"
            )
        if category in _EXPERIENCE_CATEGORIES:
            linked_item = linked.get(master_id)
            linked_source = (
                getattr(linked_item, "experience", None)
                if linked_item is not None
                else None
            )
            def frontend_link_value(field: str) -> Any:
                linked_value = (
                    getattr(linked_source, field, None)
                    if linked_source is not None
                    else None
                )
                return (
                    linked_value
                    if linked_value is not None
                    else getattr(latest, field, None)
                )

            raw_star = frontend_link_value("star")
            star = raw_star if isinstance(raw_star, Mapping) else {}
            linked_item = linked.get(master_id)
            overrides = (
                getattr(linked_item, "overrides_json", None)
                if linked_item is not None
                else None
            )
            if (
                linked_item is not None
                and isinstance(overrides, Mapping)
                and "star" not in overrides
            ):
                latest_star_value = getattr(latest, "star", None)
                latest_star = (
                    latest_star_value
                    if isinstance(latest_star_value, Mapping)
                    else {}
                )
                from . import apply_service

                def decorated(value: str) -> bool:
                    return (
                        apply_service._FRONTEND_RICH_TEXT_HTML_TAG_RE.search(value)
                        is not None
                        or apply_service._FRONTEND_MARKDOWN_TRIGGER_RE.search(value)
                        is not None
                    )

                resolved_star: dict[str, Any] = {}
                for key in ("s", "t", "a", "r"):
                    base_value = _frontend_star_value(star.get(key))
                    latest_value = _frontend_star_value(latest_star.get(key))
                    if (
                        base_value
                        and latest_value
                        and _frontend_plain_text(base_value)
                        == _frontend_plain_text(latest_value)
                        and not decorated(base_value)
                        and decorated(latest_value)
                    ):
                        resolved_star[key] = latest_value
                    else:
                        resolved_star[key] = base_value
                star = resolved_star
            view = {
                "id": master_id,
                "title": _string(frontend_link_value("title")),
                "org": _string(frontend_link_value("org")),
                "star": {
                    key: _frontend_star_value(star.get(key))
                    for key in ("s", "t", "a", "r")
                },
                "category": category,
            }
            for key in ("start_date", "end_date"):
                normalized_date = _frontend_api_date(frontend_link_value(key))
                if normalized_date is not None:
                    view[key] = normalized_date
            (work_views if category == "work" else project_views).append(view)
            continue
        if category == "education":
            raw_star = getattr(latest, "star", None)
            star = raw_star if isinstance(raw_star, Mapping) else {}
            education = {
                "id": master_id,
                "school": _frontend_plain_text(getattr(latest, "org", "")),
                "major": _frontend_plain_text(getattr(latest, "title", "")),
                "degree": _frontend_plain_text(_frontend_star_value(star.get("degree"))),
            }
            for key, value in (
                ("start_date", _frontend_year_month(getattr(latest, "start_date", None))),
                ("end_date", _frontend_year_month(getattr(latest, "end_date", None))),
                ("gpa", _frontend_plain_text(_frontend_star_value(star.get("gpa")))),
                ("courses", _frontend_plain_text(_frontend_star_value(star.get("courses")))),
            ):
                if value:
                    education[key] = value
            education_views.append(education)

    work_views.sort(
        key=lambda item: _frontend_date_sort_value(item.get("start_date")),
        reverse=True,
    )
    project_views.sort(
        key=lambda item: _frontend_date_sort_value(item.get("start_date")),
        reverse=True,
    )
    work_views = _ordered_by_ids(work_views, orders.get("workExperienceIds"))
    project_views = _ordered_by_ids(
        project_views,
        orders.get("projectExperienceIds"),
    )
    experience_views = [*work_views, *project_views]
    education_views = _ordered_by_ids(
        education_views,
        orders.get("educationIds"),
    )

    certifications: list[dict[str, str]] = []
    for item in raw_certifications if isinstance(raw_certifications, list) else []:
        certifications.append(
            {
                "id": _string(getattr(item, "id", "")),
                "name": _string(getattr(item, "name", "")),
                "issuer": _string(getattr(item, "issuer", "")),
                "issue_date": _frontend_year_month(
                    getattr(item, "issue_date", None)
                ),
            }
        )
    certifications = _ordered_by_ids(
        certifications,
        orders.get("certificationIds"),
    )

    grouped_skills: dict[str, list[dict[str, str]]] = {}
    raw_skill_ids: list[str] = []
    for raw_row in raw_skill_rows if isinstance(raw_skill_rows, list) else []:
        user_skill, skill = _row_pair(raw_row, field_name="skill bank")
        category = _string(getattr(skill, "category", "")).strip() or "未分类"
        user_skill_id = _string(getattr(user_skill, "id", ""))
        raw_skill_ids.append(user_skill_id)
        grouped_skills.setdefault(category, []).append(
            {
                "id": user_skill_id,
                "name": _string(getattr(skill, "name", "")),
                "category": category,
            }
        )
    raw_group_order = orders.get("skillGroupNames")
    group_names = list(grouped_skills)
    if isinstance(raw_group_order, list) and raw_group_order:
        preferred = [
            _string(item)
            for item in raw_group_order
            if _string(item) in grouped_skills
        ]
        group_names = list(dict.fromkeys([*preferred, *group_names]))
    skills = [item for name in group_names for item in grouped_skills[name]]

    selection_value = config.get("selection")
    selection = selection_value if isinstance(selection_value, Mapping) else {}
    experience_ids = [_string(item.get("id")) for item in experience_views]
    raw_selected_experiences = selection.get("experienceIds")
    requested_experience_ids = (
        [_string(item) for item in raw_selected_experiences if _string(item)]
        if isinstance(raw_selected_experiences, list)
        else []
    )
    if "experienceIds" in selection:
        selected_experience_ids = set(requested_experience_ids)
    elif linked:
        selected_experience_ids = set(linked)
    else:
        selected_experience_ids = set(experience_ids)

    education_ids = [_string(item.get("id")) for item in education_views]
    requested_education_ids = _selection_ids(
        config,
        "educationIds",
        education_ids,
    )
    raw_selected_educations = selection.get("educationIds")
    if "educationIds" not in selection:
        selected_education_ids = set(education_ids)
    elif isinstance(raw_selected_educations, list) and not raw_selected_educations:
        selected_education_ids = set()
    else:
        selected_education_ids = set(requested_education_ids or education_ids)

    certification_ids = [_string(item.get("id")) for item in certifications]
    raw_selected_certifications = selection.get("certificationIds")
    requested_certification_ids = _selection_ids(
        config,
        "certificationIds",
        certification_ids,
    )
    selected_certification_ids = set(
        requested_certification_ids
        if isinstance(raw_selected_certifications, list)
        and not raw_selected_certifications
        else (requested_certification_ids or certification_ids)
    )

    skill_ids = [_string(item.get("id")) for item in skills]
    raw_selected_skills = selection.get("skillIds")
    requested_skill_ids = _selection_ids(config, "skillIds", skill_ids)
    if "skillIds" not in selection:
        valid_skill_ids = set(skill_ids)
        selected_skill_ids = [
            item_id for item_id in raw_skill_ids if item_id in valid_skill_ids
        ]
    elif isinstance(raw_selected_skills, list) and not raw_selected_skills:
        selected_skill_ids = []
    elif requested_skill_ids:
        selected_skill_ids = requested_skill_ids
    else:
        selected_skill_ids = [item_id for item_id in raw_skill_ids if item_id in set(skill_ids)]
    skills_by_id = {_string(item.get("id")): item for item in skills}

    return {
        "experiences": experience_views,
        "selected_experiences": [
            {
                **{key: deepcopy(value) for key, value in item.items() if key != "star"},
                "star": {
                    key: _frontend_plain_text(value)
                    for key, value in item["star"].items()
                },
            }
            for item in experience_views
            if _string(item.get("id")) in selected_experience_ids
        ],
        "educations": education_views,
        "selected_educations": [
            item
            for item in education_views
            if _string(item.get("id")) in selected_education_ids
        ],
        "certifications": certifications,
        "selected_certifications": [
            item
            for item in certifications
            if _string(item.get("id")) in selected_certification_ids
        ],
        "skills": skills,
        "selected_skills": [
            skills_by_id[item_id]
            for item_id in selected_skill_ids
            if item_id in skills_by_id
        ],
    }


def _trusted_frontend_evaluation_snapshot(
    parsed: Mapping[str, Any],
    *,
    resume: Any,
    resume_items: list[Any],
    bank: Mapping[str, Any],
    category_by_master_id: Mapping[str, Any],
) -> dict[str, Any]:
    """Project a server-built analysis payload through the editor's snapshot rules."""

    from . import apply_service

    raw_resume = parsed.get("resume")
    if not isinstance(raw_resume, Mapping):
        raise OptimizationEvaluationInvalidError(
            "The current resume analysis snapshot is invalid"
        )
    raw_profile = raw_resume.get("profile")
    profile = raw_profile if isinstance(raw_profile, Mapping) else {}

    personal_summary = _frontend_plain_text(raw_resume.get("personal_summary"))
    resolved_profile = {
        key: _frontend_plain_text(profile.get(key))
        for key in ("name", "email", "phone", "location", "linkedin")
    }
    actual_profile = _actual_frontend_profile(resume=resume, bank=bank)
    if actual_profile is not None:
        resolved_profile, personal_summary = actual_profile
    config_value = getattr(resume, "config", None)
    config = config_value if isinstance(config_value, Mapping) else {}
    layout_value = config.get("layout")
    layout = layout_value if isinstance(layout_value, Mapping) else {}
    raw_config_order = layout.get("sectionOrder")
    raw_order = (
        raw_config_order
        if isinstance(raw_config_order, list)
        else raw_resume.get("section_order")
    )
    section_order: list[str] = []
    for raw_section_id in raw_order if isinstance(raw_order, list) else []:
        section_id = _string(raw_section_id)
        if (
            section_id in _FRONTEND_EVALUATION_SECTION_ORDER
            and section_id not in section_order
        ):
            section_order.append(section_id)
    if "summary" not in section_order:
        section_order.insert(0, "summary")
    for section_id in _FRONTEND_EVALUATION_SECTION_ORDER:
        if section_id not in section_order:
            section_order.append(section_id)
    if not personal_summary:
        section_order = [item for item in section_order if item != "summary"]

    def raw_rows(container: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
        value = container.get(key)
        if not isinstance(value, list):
            return []
        if any(not isinstance(item, Mapping) for item in value):
            raise OptimizationEvaluationInvalidError(
                f"The current resume analysis snapshot has invalid {key}"
            )
        return list(value)

    def dates(item: Mapping[str, Any]) -> dict[str, Any]:
        return {
            key: deepcopy(item.get(key))
            for key in ("start_date", "end_date")
            if key in item
        }

    def star(item: Mapping[str, Any], *, plain: bool) -> dict[str, str]:
        raw_star = item.get("star")
        source = raw_star if isinstance(raw_star, Mapping) else {}
        normalize = _frontend_star_text if plain else _string
        return {key: normalize(source.get(key)) for key in ("s", "t", "a", "r")}

    experiences = [
        {
            "id": _string(item.get("id")),
            "title": _string(item.get("title")),
            "org": _string(item.get("org")),
            **dates(item),
            "star": star(item, plain=True),
            "category": _string(item.get("category")),
        }
        for item in raw_rows(raw_resume, "experiences")
    ]

    educations: list[dict[str, str]] = []
    for item in raw_rows(raw_resume, "educations"):
        education = {
            "id": _string(item.get("id")),
            "school": _frontend_plain_text(item.get("school")),
            "major": _frontend_plain_text(item.get("major")),
            "degree": _frontend_plain_text(item.get("degree")),
        }
        for key in ("start_date", "end_date", "gpa", "courses"):
            normalized = _frontend_plain_text(item.get(key))
            if normalized:
                education[key] = normalized
        educations.append(education)

    def certifications(container: Mapping[str, Any], key: str) -> list[dict[str, str]]:
        return [
            {
                "id": _string(item.get("id")),
                "name": _string(item.get("name")),
                "issuer": _string(item.get("issuer")),
                "issue_date": _string(item.get("issue_date")),
            }
            for item in raw_rows(container, key)
        ]

    def skills(container: Mapping[str, Any], key: str) -> list[dict[str, str]]:
        return [
            {
                "id": _string(item.get("id")),
                "name": _string(item.get("name")),
                "category": _string(item.get("category")),
            }
            for item in raw_rows(container, key)
        ]

    experience_atoms = [
        {
            "id": _string(item.get("id")),
            "title": _string(item.get("title")),
            "org": _string(item.get("org")),
            **dates(item),
            "star": star(item, plain=False),
        }
        for item in raw_rows(parsed, "experience_atoms")
    ]
    raw_candidates = parsed.get("match_candidates")
    candidates = raw_candidates if isinstance(raw_candidates, Mapping) else {}
    snapshot: dict[str, Any] = {
        "evaluation_scope": "full_resume",
        "target_role": _frontend_plain_text(parsed.get("target_role")),
        "resume": {
            "section_order": section_order,
            "profile": resolved_profile,
            "personal_summary": personal_summary,
            "experiences": experiences,
            "educations": educations,
            "certifications": certifications(raw_resume, "certifications"),
            "skills": skills(raw_resume, "skills"),
        },
        "experience_atoms": experience_atoms,
        "match_candidates": {
            "certifications": certifications(candidates, "certifications"),
            "skills": skills(candidates, "skills"),
        },
        "fact_metadata": [],
    }
    actual_collections = _actual_frontend_collections(
        resume=resume,
        resume_items=resume_items,
        bank=bank,
        category_by_master_id=category_by_master_id,
    )
    if actual_collections is not None:
        snapshot["resume"]["experiences"] = actual_collections[
            "selected_experiences"
        ]
        snapshot["resume"]["educations"] = actual_collections[
            "selected_educations"
        ]
        snapshot["resume"]["certifications"] = actual_collections[
            "selected_certifications"
        ]
        snapshot["resume"]["skills"] = actual_collections["selected_skills"]
        snapshot["experience_atoms"] = [
            {
                key: deepcopy(value)
                for key, value in item.items()
                if key != "category"
            }
            for item in actual_collections["experiences"]
        ]
        snapshot["match_candidates"] = {
            "certifications": actual_collections["certifications"],
            "skills": actual_collections["skills"],
        }
    try:
        snapshot["fact_metadata"] = apply_service._rebuild_frontend_fact_metadata(
            snapshot
        )
        return apply_service._validate_exact_frontend_evaluation_snapshot(snapshot)
    except apply_service.OptimizationRunDataInvalidError as exc:
        raise OptimizationEvaluationInvalidError(
            "The current resume analysis snapshot is invalid"
        ) from exc


def _first_snapshot_mismatch(
    trusted: Any,
    signed: Any,
    *,
    path: str = "",
) -> str | None:
    if isinstance(trusted, Mapping) or isinstance(signed, Mapping):
        if not isinstance(trusted, Mapping) or not isinstance(signed, Mapping):
            return path or "resume"
        # API experience dates may be null, while the server projection omits
        # unset dates. Both represent the same empty optional field. Keep this
        # equivalence scoped to experience rows; real date changes still fail.
        if path.endswith(']') and path.rsplit('[', 1)[0] in (
            'resume.experiences', 'experience_atoms',
        ):
            trusted = {key: value for key, value in trusted.items()
                       if key not in ('start_date', 'end_date') or value is not None}
            signed = {key: value for key, value in signed.items()
                      if key not in ('start_date', 'end_date') or value is not None}
        trusted_keys = set(trusted)
        signed_keys = set(signed)
        if trusted_keys != signed_keys:
            differing_key = sorted(trusted_keys ^ signed_keys)[0]
            return f"{path}.{differing_key}" if path else differing_key
        for key in trusted:
            mismatch = _first_snapshot_mismatch(
                trusted[key],
                signed[key],
                path=f"{path}.{key}" if path else key,
            )
            if mismatch is not None:
                return mismatch
        return None
    if isinstance(trusted, list) or isinstance(signed, list):
        if not isinstance(trusted, list) or not isinstance(signed, list):
            return path or "resume"
        if len(trusted) != len(signed):
            return f"{path}.length" if path else "length"
        for index, (trusted_item, signed_item) in enumerate(zip(trusted, signed)):
            mismatch = _first_snapshot_mismatch(
                trusted_item,
                signed_item,
                path=f"{path}[{index}]",
            )
            if mismatch is not None:
                return mismatch
        return None
    if type(trusted) is not type(signed) or trusted != signed:
        return path or "resume"
    return None


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

    (
        evaluation,
        evaluation_signature,
        jd_signature,
        jd_available,
        signed_resume_snapshot,
        analysis_result,
    ) = _validate_report(resume, request)
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
    trusted_resume_snapshot = _trusted_frontend_evaluation_snapshot(
        parsed,
        resume=resume,
        resume_items=list(resume_items),
        bank=bank,
        category_by_master_id=category_by_master_id,
    )
    mismatch_path = _first_snapshot_mismatch(
        # Single-pass scoring reads the displayed resume, not the experience
        # bank or legacy evidence metadata. Bind the same input here. Selected
        # source versions are independently loaded and checked below.
        {key: trusted_resume_snapshot.get(key) for key in ('resume', 'target_role')},
        {key: signed_resume_snapshot.get(key) for key in ('resume', 'target_role')},
    )
    if mismatch_path is not None:
        raise OptimizationContextStaleError(
            "The persisted evaluation resume snapshot no longer matches "
            f"the server resume at {mismatch_path}"
        )
    current_resume = _allowlist_current_resume(
        trusted_resume_snapshot.get("resume"),
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
    if explicit_selected_ids is not None:
        hidden_selected_ids = [
            master_id
            for master_id in explicit_selected_ids
            if master_id not in selected_master_ids
        ]
        archived_hidden_ids = await _archived_master_ids_for_user(
            session,
            user_id,
            hidden_selected_ids,
        )
        if set(hidden_selected_ids) != archived_hidden_ids:
            raise OptimizationSelectionInvalidError(
                "The current resume snapshot does not match the persisted selection"
            )
        effective_selected_ids = [
            master_id
            for master_id in explicit_selected_ids
            if master_id not in archived_hidden_ids
        ]
        if (
            len(selected_master_ids) != len(effective_selected_ids)
            or set(selected_master_ids) != set(effective_selected_ids)
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
    bank_candidates = _bank_candidates(
        parsed,
        selected_ids=set(selected_master_ids),
        analysis_result=analysis_result,
        enabled=request.include_bank_suggestions and jd_available,
    )
    fact_metadata = _allowlist_fact_metadata(
        trusted_resume_snapshot.get("fact_metadata"),
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
    from ..ai.resume_score import VERSION, normalize_score, module_catalog
    if evaluation.get("evaluationVersion") != VERSION:
        raise OptimizationContextStaleError("评估规则已更新，请重新进行六维评分后再优化。")
    try:
        evaluation = normalize_score(dict(evaluation), catalog=module_catalog(current_resume))
        ids = request.selected_suggestion_ids
        available = {row['suggestionId']: row for row in evaluation['suggestions']}
        if not ids or len(ids) != len(set(ids)) or any(identity not in available or not available[identity]['editable'] for identity in ids):
            raise ValueError("Select valid editable suggestions")
    except (ValueError, TypeError) as exc:
        raise OptimizationSelectionInvalidError("请选择有效的优化模块。") from exc
    evaluation['selectedSuggestionIds'] = list(ids)
    _parse_persisted_frontend_evaluation_signature(
        evaluation_signature,
        jd_signature=jd_signature,
        evaluation=evaluation,
        analysis_result=analysis_result,
    )

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


# Historical context reader retained for compatibility tests; never used by new requests.
async def build_legacy_frozen_optimization_context(
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

    (
        evaluation,
        evaluation_signature,
        jd_signature,
        jd_available,
        signed_resume_snapshot,
        analysis_result,
    ) = _validate_report(resume, request)
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
    trusted_resume_snapshot = _trusted_frontend_evaluation_snapshot(
        parsed,
        resume=resume,
        resume_items=list(resume_items),
        bank=bank,
        category_by_master_id=category_by_master_id,
    )
    mismatch_path = _first_snapshot_mismatch(
        trusted_resume_snapshot,
        signed_resume_snapshot,
    )
    if mismatch_path is not None:
        raise OptimizationContextStaleError(
            "The persisted evaluation resume snapshot no longer matches "
            f"the server resume at {mismatch_path}"
        )
    current_resume = _allowlist_current_resume(
        trusted_resume_snapshot.get("resume"),
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
    if explicit_selected_ids is not None:
        hidden_selected_ids = [
            master_id
            for master_id in explicit_selected_ids
            if master_id not in selected_master_ids
        ]
        archived_hidden_ids = await _archived_master_ids_for_user(
            session,
            user_id,
            hidden_selected_ids,
        )
        if set(hidden_selected_ids) != archived_hidden_ids:
            raise OptimizationSelectionInvalidError(
                "The current resume snapshot does not match the persisted selection"
            )
        effective_selected_ids = [
            master_id
            for master_id in explicit_selected_ids
            if master_id not in archived_hidden_ids
        ]
        if (
            len(selected_master_ids) != len(effective_selected_ids)
            or set(selected_master_ids) != set(effective_selected_ids)
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
    bank_candidates = _bank_candidates(
        parsed,
        selected_ids=set(selected_master_ids),
        analysis_result=analysis_result,
        enabled=request.include_bank_suggestions and jd_available,
    )
    fact_metadata = _allowlist_fact_metadata(
        trusted_resume_snapshot.get("fact_metadata"),
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
    if evaluation.get("evaluationVersion") == GUIDANCE_VERSION:
        evaluation, receipt_binding, guidance_tasks, guidance_sources = (
            await _resolve_guidance_evaluation(
                evaluation,
                user_id=user_id,
                evaluation_input={
                    "resume": deepcopy(parsed.get("resume")),
                    "fact_metadata": deepcopy(parsed.get("fact_metadata")),
                    "target_role": parsed.get("target_role", ""),
                },
                jd_available=jd_available,
            )
        )
        # This material is private optimization authority.  Keeping it inside
        # the already private frozen evaluation binds plan/apply freshness
        # without exposing it through the public guidance report.
        evaluation["_guidanceReceiptBinding"] = receipt_binding
        evaluation["_guidanceTasks"] = guidance_tasks
        evaluation["_guidanceSources"] = guidance_sources
    else:
        evaluation = _normalize_persisted_evaluation(
            evaluation,
            jd_available=jd_available,
            fact_metadata=fact_metadata,
        )
    _parse_persisted_frontend_evaluation_signature(
        evaluation_signature,
        jd_signature=jd_signature,
        evaluation=evaluation,
        analysis_result=analysis_result,
    )

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
