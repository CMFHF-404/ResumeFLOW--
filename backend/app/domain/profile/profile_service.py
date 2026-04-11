from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Profile, ProfileLink, User
from ...utils.time_utils import utc_now
from .schemas import ProfileLinkPayload, ProfileUpdate


class NotFoundError(Exception):
    pass


async def get_current_profile(
    session: AsyncSession,
    user_id: str,
    full_name_hint: Optional[str] = None,
) -> Profile:
    profile = await _fetch_profile(session, user_id)
    if profile:
        return await _hydrate_social_links(session, profile)
    # Lazy registration: create local user/profile on first access.
    return await _create_profile(session, user_id, full_name_hint=full_name_hint)


async def get_profile_if_exists(
    session: AsyncSession,
    user_id: str,
) -> Optional[Profile]:
    return await _fetch_profile(session, user_id)


async def update_profile(
    session: AsyncSession,
    user_id: str,
    payload: ProfileUpdate,
) -> Profile:
    profile = await get_current_profile(session, user_id)
    update_data = payload.model_dump(exclude_unset=True)
    links_payload = payload.links
    if links_payload is not None and (
        "social_links" not in update_data or update_data["social_links"] is None
    ):
        update_data["social_links"] = _build_social_links_from_payload(links_payload)
    update_data.pop("links", None)
    for json_field in ("social_links", "extra_json"):
        if json_field in update_data and update_data[json_field] is None:
            update_data[json_field] = {}
    for field, value in update_data.items():
        setattr(profile, field, value)
    if "social_links" in update_data:
        await _clear_profile_links(session, user_id)
    profile.updated_at = utc_now()
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


async def _fetch_profile(session: AsyncSession, user_id: str) -> Optional[Profile]:
    result = await session.execute(select(Profile).where(Profile.user_id == user_id))
    return result.scalars().first()


async def _fetch_profile_links(
    session: AsyncSession, user_id: str
) -> List[ProfileLink]:
    result = await session.execute(
        select(ProfileLink)
        .where(ProfileLink.user_id == user_id)
        .order_by(ProfileLink.position)
    )
    return list(result.scalars().all())


async def _clear_profile_links(session: AsyncSession, user_id: str) -> None:
    await session.execute(delete(ProfileLink).where(ProfileLink.user_id == user_id))


def _build_social_links(links: List[ProfileLink]) -> Dict[str, Any]:
    return _build_social_links_from_items(
        (link.label, link.url, link.position) for link in links
    )


def _build_social_links_from_payload(
    links: List[ProfileLinkPayload],
) -> Dict[str, Any]:
    return _build_social_links_from_items(
        (link.label, link.url, link.position) for link in links
    )


def _build_social_links_from_items(
    items: Iterable[Tuple[str, str, int]],
) -> Dict[str, Any]:
    return {label: {"url": url, "position": position} for label, url, position in items}


async def _hydrate_social_links(session: AsyncSession, profile: Profile) -> Profile:
    if profile.social_links:
        return profile
    links = await _fetch_profile_links(session, profile.user_id)
    if not links:
        return profile
    # Lazy migration: backfill social_links from legacy profile_links on read.
    profile.social_links = _build_social_links(links)
    profile.updated_at = utc_now()
    session.add(profile)
    await _clear_profile_links(session, profile.user_id)
    await session.commit()
    await session.refresh(profile)
    return profile


def _normalize_full_name_hint(full_name_hint: Optional[str]) -> Optional[str]:
    if not full_name_hint:
        return None
    normalized = full_name_hint.strip()
    return normalized or None


async def _create_profile(
    session: AsyncSession,
    user_id: str,
    full_name_hint: Optional[str] = None,
) -> Profile:
    try:
        await _ensure_user(session, user_id)
        normalized_full_name = _normalize_full_name_hint(full_name_hint)
        profile = Profile(user_id=user_id, full_name=normalized_full_name)
        session.add(profile)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        profile = await _fetch_profile(session, user_id)
        if profile:
            return profile
        raise

    await session.refresh(profile)
    return profile


async def _ensure_user(session: AsyncSession, user_id: str) -> None:
    result = await session.execute(select(User).where(User.id == user_id))
    if result.scalars().first():
        return
    session.add(User(id=user_id))
