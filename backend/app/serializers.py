from typing import Any, Dict

from .constants import ALLOWED_OVERRIDE_KEYS
from .models import ExperienceVersion, MasterExperience, Resume, ResumeExperienceLink
from .schemas import (
    ExperienceVersionRead,
    MasterExperienceRead,
    ResumeExperienceItem,
    ResumeExperienceMerged,
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
        tags=version.tags,
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
        config=resume.config or {},
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )


def resume_experience_to_read(
    resume_experience: ResumeExperienceLink, version: ExperienceVersion
) -> ResumeExperienceItem:
    overrides = _filter_overrides(resume_experience.overrides_json or {})
    snapshot = _apply_overrides(_snapshot_from_version(version), overrides)
    return ResumeExperienceItem(
        id=str(resume_experience.id),
        resume_id=str(resume_experience.resume_id),
        experience_version_id=str(resume_experience.experience_version_id),
        display_order=resume_experience.display_order,
        overrides_json=resume_experience.overrides_json or {},
        experience=snapshot,
    )


def _snapshot_from_version(version: ExperienceVersion) -> ResumeExperienceMerged:
    return ResumeExperienceMerged(
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
    )


def _apply_overrides(
    snapshot: ResumeExperienceMerged, overrides: Dict[str, Any]
) -> ResumeExperienceMerged:
    if not overrides:
        return snapshot
    data = snapshot.model_dump()
    for key, value in overrides.items():
        if key in data:
            data[key] = value
    return ResumeExperienceMerged(**data)


def _filter_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in overrides.items() if key in ALLOWED_OVERRIDE_KEYS}
