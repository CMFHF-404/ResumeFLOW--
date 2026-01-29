from typing import List, Optional, Tuple

from sqlalchemy import desc, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import ExperienceCategory, ExperienceVersion, MasterExperience
from ...utils.time_utils import utc_now
from .schemas import ExperienceCreate, ExperienceUpdate, ExperienceVersionPayload


class NotFoundError(Exception):
    pass


async def list_experiences(
    session: AsyncSession,
    user_id: str,
    category: Optional[ExperienceCategory],
    keyword: Optional[str],
    limit: int,
    offset: int,
) -> List[Tuple[MasterExperience, Optional[ExperienceVersion]]]:
    statement = (
        select(MasterExperience, ExperienceVersion)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == MasterExperience.latest_version_id,
            isouter=True,
        )
        .where(MasterExperience.user_id == user_id)
        .order_by(MasterExperience.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if category:
        statement = statement.where(MasterExperience.category == category)
    if keyword:
        like_value = f"%{keyword}%"
        statement = statement.where(
            or_(
                ExperienceVersion.title.ilike(like_value),
                ExperienceVersion.org.ilike(like_value),
                ExperienceVersion.summary.ilike(like_value),
            )
        )

    result = await session.exec(statement)
    return list(result.all())


async def get_version_for_user(
    session: AsyncSession, user_id: str, version_id: str
) -> ExperienceVersion:
    result = await session.exec(
        select(ExperienceVersion)
        .join(MasterExperience)
        .where(
            ExperienceVersion.id == version_id,
            MasterExperience.user_id == user_id,
        )
    )
    version = result.first()
    if not version:
        raise NotFoundError("Experience version not found")
    return version


async def get_experience_detail(
    session: AsyncSession, user_id: str, master_id: str
) -> Tuple[MasterExperience, Optional[ExperienceVersion], List[ExperienceVersion]]:
    master = await _get_master(session, user_id, master_id)
    result = await session.exec(
        select(ExperienceVersion)
        .where(ExperienceVersion.master_experience_id == master.id)
        .order_by(ExperienceVersion.version.desc())
    )
    versions = list(result.all())
    latest_version = next(
        (version for version in versions if version.id == master.latest_version_id),
        None,
    )
    return master, latest_version, versions


async def create_experience(
    session: AsyncSession, user_id: str, payload: ExperienceCreate
) -> Tuple[MasterExperience, ExperienceVersion]:
    async with session.begin():
        master = MasterExperience(user_id=user_id, category=payload.category)
        session.add(master)
        await session.flush()

        version = _build_version(master.id, 1, payload.version)
        session.add(version)
        await session.flush()

        master.latest_version_id = version.id
        master.updated_at = utc_now()
        session.add(master)

    await session.refresh(master)
    await session.refresh(version)
    return master, version


async def update_experience(
    session: AsyncSession, user_id: str, master_id: str, payload: ExperienceUpdate
) -> Tuple[MasterExperience, Optional[ExperienceVersion]]:
    version: Optional[ExperienceVersion] = None
    async with session.begin():
        master = await _get_master(session, user_id, master_id)
        is_master_updated = False
        if payload.category is not None:
            master.category = payload.category
            is_master_updated = True
        if payload.is_archived is not None:
            master.is_archived = payload.is_archived
            is_master_updated = True
        if payload.version is not None:
            next_version = await _next_version_number(session, master.id)
            version = _build_version(master.id, next_version, payload.version)
            session.add(version)
            await session.flush()
            master.latest_version_id = version.id
            is_master_updated = True
        if is_master_updated:
            master.updated_at = utc_now()
            session.add(master)

    await session.refresh(master)
    if version:
        await session.refresh(version)
    return master, version


async def archive_experience(
    session: AsyncSession, user_id: str, master_id: str
) -> MasterExperience:
    master = await _get_master(session, user_id, master_id)
    master.is_archived = True
    master.updated_at = utc_now()
    session.add(master)
    await session.commit()
    await session.refresh(master)
    return master


async def _get_master(
    session: AsyncSession, user_id: str, master_id: str
) -> MasterExperience:
    result = await session.exec(
        select(MasterExperience).where(
            MasterExperience.id == master_id,
            MasterExperience.user_id == user_id,
        )
    )
    master = result.first()
    if not master:
        raise NotFoundError("Master experience not found")
    return master


async def _next_version_number(session: AsyncSession, master_id: str) -> int:
    result = await session.exec(
        select(ExperienceVersion.version)
        .where(ExperienceVersion.master_experience_id == master_id)
        .order_by(desc(ExperienceVersion.version))
        .limit(1)
    )
    current = result.first()
    return (current or 0) + 1


def _build_version(
    master_id: str, version_number: int, payload: ExperienceVersionPayload
) -> ExperienceVersion:
    return ExperienceVersion(
        master_experience_id=master_id,
        version=version_number,
        title=payload.title,
        org=payload.org,
        location=payload.location,
        start_date=payload.start_date,
        end_date=payload.end_date,
        is_current=payload.is_current,
        summary=payload.summary,
        highlights=payload.highlights,
        star=payload.star,
    )
