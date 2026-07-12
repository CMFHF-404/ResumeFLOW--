from ...models import ExperienceVersion, MasterExperience
from .schemas import ExperienceVersionRead, MasterExperienceRead


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
