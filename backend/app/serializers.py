from typing import Any, Dict

from .constants import ALLOWED_OVERRIDE_KEYS
from .models import ExperienceVersion, MasterExperience, Resume, ResumeExperience
from .schemas import (
    ExperienceSnapshot,
    ExperienceVersionRead,
    MasterExperienceRead,
    ResumeExperienceRead,
    ResumeRead,
)


def experience_version_to_read(version: ExperienceVersion) -> ExperienceVersionRead:
    return ExperienceVersionRead(
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
        star=version.star,
        created_at=version.created_at,
    )


def master_experience_to_read(master: MasterExperience) -> MasterExperienceRead:
    return MasterExperienceRead(
        id=str(master.id),
        category=master.category,
        latest_version_id=str(master.latest_version_id) if master.latest_version_id else None,
        is_archived=master.is_archived,
        created_at=master.created_at,
        updated_at=master.updated_at,
    )


def resume_to_read(resume: Resume) -> ResumeRead:
    return ResumeRead(
        id=str(resume.id),
        user_id=str(resume.user_id),
        title=resume.title,
        target_role=resume.target_role,
        template_id=resume.template_id,
        is_archived=resume.is_archived,
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )


def resume_experience_to_read(
    resume_experience: ResumeExperience, version: ExperienceVersion
) -> ResumeExperienceRead:
    overrides = _filter_overrides(resume_experience.overrides_json or {})
    snapshot = _apply_overrides(_snapshot_from_version(version), overrides)
    return ResumeExperienceRead(
        id=str(resume_experience.id),
        resume_id=str(resume_experience.resume_id),
        section=resume_experience.section,
        position=resume_experience.position,
        overrides_json=resume_experience.overrides_json or {},
        experience=snapshot,
    )


def _snapshot_from_version(version: ExperienceVersion) -> ExperienceSnapshot:
    return ExperienceSnapshot(
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
        star=version.star,
    )


def _apply_overrides(
    snapshot: ExperienceSnapshot, overrides: Dict[str, Any]
) -> ExperienceSnapshot:
    if not overrides:
        return snapshot
    data = snapshot.model_dump()
    for key, value in overrides.items():
        if key in data:
            data[key] = value
    return ExperienceSnapshot(**data)


def _filter_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in overrides.items() if key in ALLOWED_OVERRIDE_KEYS}
