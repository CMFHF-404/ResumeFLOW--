import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple, Optional

from sqlalchemy import desc, text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import ALLOWED_OVERRIDE_KEYS
from ...models import ExperienceVersion
from ...utils.date_utils import normalize_month_date_string
from ...utils.time_utils import utc_now
from ..experience.experience_service import get_version_for_user
from .models import Resume, ResumeExperienceLink
from .resume_schema import (
    ResumeAssemblyPatch,
    ResumeCreate,
    ResumeExperienceItem,
    ResumeExperienceMerged,
    ResumeUpdate,
)


class NotFoundError(Exception):
    pass


class ConcurrencyConflictError(Exception):
    pass


def _normalize_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _target_role_signature(target_role: Optional[str]) -> str:
    return json.dumps(
        {"targetRole": str(target_role or "").strip()},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _invalidate_resume_analysis_for_target_role(
    config: Any,
    target_role: Optional[str],
    *,
    previous_target_role: Optional[str] = None,
) -> Any:
    if not isinstance(config, dict):
        return config
    analysis = config.get("jdAnalysis")
    if not isinstance(analysis, dict):
        return config
    expected_signature = _target_role_signature(target_role)
    if analysis.get("targetRoleSignature") != expected_signature:
        return _mark_resume_evaluation_outdated(config)

    if _target_role_signature(previous_target_role) == expected_signature:
        return config
    return _mark_resume_evaluation_outdated(config)


def _mark_resume_evaluation_outdated(config: Any) -> Any:
    if not isinstance(config, dict):
        return config
    analysis = config.get("jdAnalysis")
    if not isinstance(analysis, dict) or analysis.get("evaluationIsOutdated") is True:
        return config
    next_config = deepcopy(config)
    next_config["jdAnalysis"]["evaluationIsOutdated"] = True
    return next_config


def _mark_resume_analysis_outdated(config: Any) -> Any:
    if not isinstance(config, dict):
        return config
    analysis = config.get("jdAnalysis")
    if not isinstance(analysis, dict):
        return config
    if (
        analysis.get("isOutdated") is True
        and analysis.get("evaluationIsOutdated") is True
    ):
        return config
    next_config = deepcopy(config)
    next_config["jdAnalysis"]["isOutdated"] = True
    next_config["jdAnalysis"]["evaluationIsOutdated"] = True
    return next_config


def _value_with_presence(mapping: Any, key: str) -> Dict[str, Any]:
    if not isinstance(mapping, dict):
        return {"present": False, "value": None}
    return {
        "present": key in mapping,
        "value": deepcopy(mapping.get(key)),
    }


def _selection_value_with_presence(mapping: Any, key: str) -> Dict[str, Any]:
    projected = _value_with_presence(mapping, key)
    value = projected["value"]
    if isinstance(value, list):
        projected["value"] = sorted({str(item) for item in value if str(item)})
    return projected


def _resume_evaluation_config_projection(config: Any) -> Dict[str, Any]:
    """Return only config fields that change the evaluated resume snapshot."""
    if not isinstance(config, dict):
        return {}

    profile_sync_mode = config.get("profileSyncMode")
    layout = config.get("layout")
    is_summary_visible = not (
        isinstance(layout, dict)
        and layout.get("isSummaryVisible") is False
    )
    profile = config.get("profile")
    profile_projection = None
    if profile_sync_mode != "global" and isinstance(profile, dict):
        profile_projection = {
            key: deepcopy(profile.get(key))
            for key in (
                "name",
                "email",
                "phone",
                "location",
                "linkedin",
                *(("summary",) if is_summary_visible else ()),
            )
        }

    selection = config.get("selection")
    selection_projection = {
        key: _selection_value_with_presence(selection, key)
        for key in (
            "experienceIds",
            "educationIds",
            "certificationIds",
            "skillIds",
        )
    }
    layout_projection = {
        key: _value_with_presence(layout, key)
        for key in ("sectionOrder", "isSummaryVisible", "orders")
    }
    return {
        "profileSyncMode": _value_with_presence(config, "profileSyncMode"),
        "profile": profile_projection,
        "personalSummary": (
            _value_with_presence(config, "personalSummary")
            if is_summary_visible
            else {"present": False, "value": None}
        ),
        "selection": selection_projection,
        "layout": layout_projection,
    }


def _invalidate_resume_analysis_for_config_change(
    previous_config: Any,
    next_config: Any,
) -> Any:
    previous_analysis = (
        previous_config.get("jdAnalysis")
        if isinstance(previous_config, dict)
        else None
    )
    next_analysis = (
        next_config.get("jdAnalysis")
        if isinstance(next_config, dict)
        else None
    )
    if not isinstance(previous_analysis, dict) or not isinstance(next_analysis, dict):
        return next_config
    if (
        _resume_evaluation_config_projection(previous_config)
        == _resume_evaluation_config_projection(next_config)
    ):
        return next_config

    return _mark_resume_evaluation_outdated(next_config)


OP_REQUIREMENTS = {
    "add": {"required": {"experience_version_id"}, "optional": {"display_order"}},
    "remove": {"required": {"resume_experience_id"}, "optional": set()},
    "reorder": {"required": {"resume_experience_id", "display_order"}, "optional": set()},
    "override": {
        "required": {"resume_experience_id", "overrides_json"},
        "optional": {"experience_version_id", "clear_override_keys"},
    },
}


async def list_resumes(
    session: AsyncSession, user_id: str, limit: int, offset: int
) -> List[Resume]:
    result = await session.execute(
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(desc(Resume.updated_at))
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def create_resume(
    session: AsyncSession, user_id: str, payload: ResumeCreate
) -> Resume:
    resume = Resume(
        user_id=user_id,
        title=payload.title,
        target_role=payload.target_role,
        config=payload.config or {},
    )
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


async def update_resume(
    session: AsyncSession, user_id: str, resume_id: str, payload: ResumeUpdate
) -> Resume:
    if (
        payload.expected_updated_at is None
        and (
            payload.title is not None
            or payload.config is not None
            or payload.target_role is not None
        )
    ):
        raise ConcurrencyConflictError(
            "expected_updated_at is required when changing resume content."
        )
    resume = await _get_resume(session, user_id, resume_id, for_update=True)
    if (
        payload.expected_updated_at is not None
        and _normalize_timestamp(resume.updated_at)
        != _normalize_timestamp(payload.expected_updated_at)
    ):
        raise ConcurrencyConflictError(
            "Resume changed since it was loaded. Reload before saving again."
        )
    previous_config = deepcopy(resume.config)
    previous_target_role = resume.target_role
    target_role_changed = (
        payload.target_role is not None
        and resume.target_role != payload.target_role
    )
    if payload.title is not None:
        resume.title = payload.title
    if payload.target_role is not None:
        resume.target_role = payload.target_role
    if payload.config is not None:
        resume.config = payload.config
        resume.config = _invalidate_resume_analysis_for_config_change(
            previous_config,
            resume.config,
        )
    if target_role_changed:
        resume.config = _invalidate_resume_analysis_for_target_role(
            resume.config,
            resume.target_role,
            previous_target_role=previous_target_role,
        )
    resume.updated_at = utc_now()
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


async def persist_resume_boss_greeting(
    session: AsyncSession,
    user_id: str,
    resume_id: str,
    greeting: str,
    signature: Optional[str] = None,
    expected_updated_at: Optional[datetime] = None,
) -> Resume:
    if expected_updated_at is None:
        raise ConcurrencyConflictError(
            "expected_updated_at is required when persisting a boss greeting."
        )
    resume = await _get_resume(session, user_id, resume_id, for_update=True)
    if (
        _normalize_timestamp(resume.updated_at)
        != _normalize_timestamp(expected_updated_at)
    ):
        raise ConcurrencyConflictError(
            "Resume changed while the boss greeting was generated. Regenerate it."
        )
    boss_greeting_payload: Dict[str, Any] = {
        "greeting": greeting,
    }
    if signature:
        boss_greeting_payload["signature"] = signature
    updated_at = utc_now()
    await session.execute(
        text(
            """
            UPDATE resumes
            SET config = jsonb_set(
                    COALESCE(config, '{}'::jsonb),
                    '{bossGreeting}',
                    CAST(:boss_greeting_payload AS jsonb),
                    true
                ),
                updated_at = :updated_at
            WHERE id = :resume_id AND user_id = :user_id
            """
        ),
        {
            "boss_greeting_payload": json.dumps(boss_greeting_payload, ensure_ascii=False),
            "updated_at": updated_at,
            "resume_id": str(resume.id),
            "user_id": user_id,
        },
    )
    await session.commit()
    await session.refresh(resume)
    return resume


async def delete_resume(
    session: AsyncSession, user_id: str, resume_id: str
) -> None:
    resume = await _get_resume(session, user_id, resume_id)
    await session.delete(resume)
    await session.commit()


async def duplicate_resume(
    session: AsyncSession,
    user_id: str,
    resume_id: str,
    title: Optional[str] = None,
) -> Resume:
    source = await _get_resume(session, user_id, resume_id)
    duplicated_title = title or f"{source.title} (副本)"
    duplicated = Resume(
        user_id=user_id,
        title=duplicated_title,
        target_role=source.target_role,
        config=_build_duplicated_config(source.config),
    )
    session.add(duplicated)
    await session.flush()
    pairs = await _list_resume_experiences(session, source.id)
    for link, _version in pairs:
        session.add(
            ResumeExperienceLink(
                resume_id=duplicated.id,
                experience_version_id=link.experience_version_id,
                overrides_json={**(link.overrides_json or {})},
                display_order=link.display_order,
            )
        )
    await session.commit()
    await session.refresh(duplicated)
    return duplicated


def _build_duplicated_config(source_config: Any) -> Dict[str, Any]:
    if not isinstance(source_config, dict):
        return {}
    duplicated_config = deepcopy(source_config)
    duplicated_config.pop("jdAnalysis", None)
    duplicated_config.pop("bossGreeting", None)
    return duplicated_config


async def get_resume_detail(
    session: AsyncSession, user_id: str, resume_id: str
) -> Tuple[Resume, List[ResumeExperienceItem]]:
    resume = await _get_resume(session, user_id, resume_id)
    pairs = await _list_resume_experiences(session, resume.id)
    items = [_build_resume_experience(link, version) for link, version in pairs]
    return resume, items


async def update_assembly(
    session: AsyncSession,
    user_id: str,
    resume_id: str,
    payload: ResumeAssemblyPatch,
) -> Resume:
    if payload.expected_updated_at is None:
        raise ConcurrencyConflictError(
            "expected_updated_at is required when changing resume assembly."
        )
    resume = await _get_resume(session, user_id, resume_id, for_update=True)
    if (
        _normalize_timestamp(resume.updated_at)
        != _normalize_timestamp(payload.expected_updated_at)
    ):
        raise ConcurrencyConflictError(
            "Resume changed since it was loaded. Reload before saving again."
        )
    ops = _validate_ops(payload.operations)
    handlers = {
        "add": _handle_add,
        "remove": _handle_remove,
        "reorder": _handle_reorder,
        "override": _handle_override,
    }

    for op in ops:
        handler = handlers[op["op"]]
        await handler(session, user_id, resume, op)
    if ops:
        resume.config = _mark_resume_analysis_outdated(resume.config)
    resume.updated_at = utc_now()
    session.add(resume)
    await session.commit()

    await session.refresh(resume)
    return resume


async def _list_resume_experiences(
    session: AsyncSession, resume_id: str
) -> List[Tuple[ResumeExperienceLink, ExperienceVersion]]:
    result = await session.execute(
        select(ResumeExperienceLink, ExperienceVersion)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == ResumeExperienceLink.experience_version_id,
        )
        .where(ResumeExperienceLink.resume_id == resume_id)
        .order_by(ResumeExperienceLink.display_order)
    )
    return list(result.all())


async def _handle_add(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    version_id = op["experience_version_id"]
    await get_version_for_user(session, user_id, version_id)
    if "display_order" in op:
        display_order = int(op["display_order"])
    else:
        display_order = await _next_display_order(session, resume.id)
    link = ResumeExperienceLink(
        resume_id=resume.id,
        experience_version_id=version_id,
        display_order=display_order,
    )
    session.add(link)


async def _handle_remove(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    link = await _get_link(session, resume.id, op["resume_experience_id"])
    session.delete(link)


async def _handle_reorder(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    link = await _get_link(session, resume.id, op["resume_experience_id"])
    link.display_order = int(op["display_order"])
    session.add(link)


async def _handle_override(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    link = await _get_link(session, resume.id, op["resume_experience_id"])
    next_version_id = op.get("experience_version_id")
    if next_version_id is not None:
        await get_version_for_user(session, user_id, next_version_id)
        link.experience_version_id = next_version_id
    overrides = _filter_overrides(op.get("overrides_json") or {})
    existing = _normalize_overrides(link.overrides_json)
    clear_override_keys = _normalize_override_keys(op.get("clear_override_keys"))
    if clear_override_keys:
        existing = {
            key: value
            for key, value in existing.items()
            if key not in clear_override_keys
        }
    merged = {**existing, **overrides}
    link.overrides_json = merged
    session.add(link)


def _validate_ops(operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for op in operations:
        op_type = op.get("op")
        rules = OP_REQUIREMENTS.get(op_type)
        if not rules:
            raise ValueError(f"Unsupported op: {op_type}")
        missing = rules["required"] - set(op.keys())
        if missing:
            raise ValueError(f"Missing fields for {op_type}: {sorted(missing)}")
        normalized.append(op)
    return normalized


async def _get_resume(
    session: AsyncSession,
    user_id: str,
    resume_id: str,
    *,
    for_update: bool = False,
) -> Resume:
    statement = select(Resume).where(
        Resume.id == resume_id,
        Resume.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    resume = result.scalars().first()
    if not resume:
        raise NotFoundError("Resume not found")
    return resume


async def _get_link(
    session: AsyncSession, resume_id: str, link_id: str
) -> ResumeExperienceLink:
    result = await session.execute(
        select(ResumeExperienceLink).where(
            ResumeExperienceLink.id == link_id,
            ResumeExperienceLink.resume_id == resume_id,
        )
    )
    link = result.scalars().first()
    if not link:
        raise NotFoundError("Resume experience not found")
    return link


async def _next_display_order(session: AsyncSession, resume_id: str) -> int:
    result = await session.execute(
        select(ResumeExperienceLink.display_order)
        .where(ResumeExperienceLink.resume_id == resume_id)
        .order_by(desc(ResumeExperienceLink.display_order))
        .limit(1)
    )
    current = result.scalars().first()
    return (current if current is not None else -1) + 1


def _filter_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    safe_overrides = _normalize_overrides(overrides)
    safe_overrides = _normalize_date_overrides(safe_overrides)
    return {key: value for key, value in safe_overrides.items() if key in ALLOWED_OVERRIDE_KEYS}


def _normalize_overrides(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _normalize_date_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(overrides)
    for key in ("start_date", "end_date"):
        if key not in normalized:
            continue
        normalized_value = normalize_month_date_string(normalized[key])
        if normalized_value:
            normalized[key] = normalized_value
        else:
            normalized.pop(key, None)
    return normalized


def _normalize_override_keys(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [
        key
        for key in value
        if isinstance(key, str) and key in ALLOWED_OVERRIDE_KEYS
    ]


def _build_resume_experience(
    link: ResumeExperienceLink, version: ExperienceVersion
) -> ResumeExperienceItem:
    overrides = _filter_overrides(link.overrides_json or {})
    merged = _merge_version(version, overrides)
    return ResumeExperienceItem(
        id=str(link.id),
        resume_id=str(link.resume_id),
        experience_version_id=str(link.experience_version_id),
        display_order=link.display_order,
        overrides_json=link.overrides_json or {},
        experience=merged,
    )


def _merge_version(
    version: ExperienceVersion, overrides: Dict[str, Any]
) -> ResumeExperienceMerged:
    # Resume-level overrides take precedence over version fields.
    data = ResumeExperienceMerged(
        id=str(version.id),
        master_experience_id=str(version.master_experience_id),
        version=version.version,
        title=version.title,
        org=version.org,
        location=version.location,
        start_date=version.start_date,
        end_date=version.end_date,
        is_current=version.is_current,
        summary=version.summary,
        highlights=version.highlights,
        tags=version.tags,
        star=version.star,
    ).model_dump()
    for key, value in overrides.items():
        if key in data:
            data[key] = value
    return ResumeExperienceMerged(**data)
