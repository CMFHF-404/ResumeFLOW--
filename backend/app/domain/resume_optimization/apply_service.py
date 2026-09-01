from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import and_, or_
from pydantic import ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import ALLOWED_OVERRIDE_KEYS
from ...database import AsyncSessionFactory
from ...models import ExperienceVersion, MasterExperience
from ...utils.time_utils import utc_now_aware
from ..resume.models import Resume, ResumeExperienceLink
from ..resume.resume_service import _mark_resume_analysis_outdated
from .models import ResumeOptimizationRun
from .run_service import OptimizationRunNotFoundError, hash_canonical_json
from .schemas import (
    OptimizationAction,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    ResumeOptimizationApplyRequest,
    ResumeOptimizationStatus,
)
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
_STAR_PATHS = frozenset({"star.s", "star.t", "star.a", "star.r"})
_SUMMARY_MODULE_IDS = frozenset({"personal_summary", "current_resume", "resume"})
_SUMMARY_PATHS = frozenset({"personal_summary", "personalSummary"})
_SKILL_PATHS = frozenset({"skills.order", "skillsOrder", "selection.skillIds"})
_SECTION_PATHS = frozenset({"section_order", "sectionOrder"})
_APPLY_SNAPSHOT_VERSION = "resume_optimization_apply_v1"
_STALE_PUBLIC_MESSAGE = "简历内容或六维评估已更新，请重新生成优化方案。"


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
    by_id = {change.change_id: change for change in plan.changes}
    if accepted_change_ids - set(by_id):
        raise OptimizationApplyValidationError("An accepted change ID is unknown")

    selected: list[OptimizationChange] = []
    for change in plan.changes:
        if change.change_id not in accepted_change_ids:
            continue
        if change.safety_status != "allowed":
            raise OptimizationApplyValidationError(
                "Only safety-allowed changes may be applied"
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
        selected.append(change)
    return selected


def _validated_snapshot(run: ResumeOptimizationRun) -> dict[str, Any]:
    snapshot = run.before_snapshot
    if not isinstance(snapshot, Mapping) or set(snapshot) != _FROZEN_SNAPSHOT_KEYS:
        raise OptimizationApplyValidationError("Frozen optimization snapshot is invalid")
    copied = deepcopy(dict(snapshot))
    if hash_canonical_json(copied) != run.source_snapshot_hash:
        raise OptimizationApplyStaleError()
    if str(copied.get("resume_id")) != str(run.resume_id):
        raise OptimizationApplyStaleError()
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
) -> OptimizationApplyPatch:
    if not isinstance(current_resume_config, dict):
        raise OptimizationApplyValidationError("Current resume config is invalid")
    if not isinstance(current_link_overrides, dict):
        raise OptimizationApplyValidationError("Current link overrides are invalid")

    snapshot = _validated_snapshot(run)
    frozen_links = _frozen_links(run)
    changes = _accepted_changes(run, accepted_change_ids)
    next_config = deepcopy(current_resume_config)
    next_stars: dict[str, dict[str, Any]] = {}
    targets: set[tuple[str, str]] = set()

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
            next_layout = deepcopy(dict(layout))
            next_layout["sectionOrder"] = next_order
            next_config["layout"] = next_layout
            continue

        raise OptimizationApplyValidationError("Unsupported optimization change")

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
    config = resume.config
    analysis = config.get("jdAnalysis") if isinstance(config, Mapping) else None
    result = analysis.get("result") if isinstance(analysis, Mapping) else None
    evaluation = result.get("resumeEvaluation") if isinstance(result, Mapping) else None
    if (
        not isinstance(analysis, Mapping)
        or analysis.get("isOutdated") is True
        or analysis.get("evaluationIsOutdated") is True
        or not isinstance(evaluation, Mapping)
        or analysis.get("evaluationSignature") != run.source_evaluation_signature
        or analysis.get("jdInputSignature") != run.source_jd_signature
        or snapshot.get("evaluation_signature") != run.source_evaluation_signature
        or snapshot.get("jd_signature") != run.source_jd_signature
    ):
        raise OptimizationApplyStaleError()


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

        changes = _accepted_changes(run, set(payload.accepted_change_ids))
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
