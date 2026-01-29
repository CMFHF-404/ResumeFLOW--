from typing import List

from sqlalchemy import delete
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..models import Profile, ProfileLink, utc_now
from ..schemas import ProfileLinkPayload, ProfileUpdate


async def ensure_profile(session: AsyncSession, user_id: str) -> Profile:
    result = await session.exec(select(Profile).where(Profile.user_id == user_id))
    profile = result.first()
    if profile:
        return profile
    profile = Profile(user_id=user_id)
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


async def get_profile_links(session: AsyncSession, user_id: str) -> List[ProfileLink]:
    result = await session.exec(
        select(ProfileLink)
        .where(ProfileLink.user_id == user_id)
        .order_by(ProfileLink.position)
    )
    return list(result.all())


async def replace_profile_links(
    session: AsyncSession,
    user_id: str,
    links: List[ProfileLinkPayload],
) -> List[ProfileLink]:
    await session.exec(delete(ProfileLink).where(ProfileLink.user_id == user_id))
    session.add_all(
        [
            ProfileLink(
                user_id=user_id,
                label=link.label,
                url=link.url,
                position=link.position,
            )
            for link in links
        ]
    )
    await session.commit()
    return await get_profile_links(session, user_id)


async def update_profile(
    session: AsyncSession,
    user_id: str,
    payload: ProfileUpdate,
) -> Profile:
    profile = await ensure_profile(session, user_id)
    update_data = payload.model_dump(exclude_unset=True)
    update_data.pop("links", None)
    for field, value in update_data.items():
        setattr(profile, field, value)
    profile.updated_at = utc_now()
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile
