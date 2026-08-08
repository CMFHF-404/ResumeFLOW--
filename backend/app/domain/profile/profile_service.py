from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import Profile, ProfileLink
from ...utils.time_utils import utc_now
from ..account.user_onboarding_service import ensure_user_with_signup_bonus
from ..resume.resume_analysis_freshness import acquire_user_resume_analysis_lock
from .schemas import ProfileLinkPayload, ProfileUpdate


class NotFoundError(Exception):
    pass


class ProfileUpdateConflictError(Exception):
    pass


_RESUME_EVALUATION_PROFILE_FIELDS = {
    "full_name",
    "email",
    "phone",
    "location",
    "summary",
    "social_links",
}


def _normalize_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


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
    expected_updated_at = payload.expected_updated_at
    if expected_updated_at is None:
        profile = await get_current_profile(session, user_id)
    else:
        profile = await _fetch_profile_for_update(session, user_id)
        if profile is None:
            raise ProfileUpdateConflictError("Profile no longer exists")
        elif _normalize_timestamp(profile.updated_at) != _normalize_timestamp(expected_updated_at):
            raise ProfileUpdateConflictError("Profile changed since it was loaded")
    update_data = payload.model_dump(exclude_unset=True)
    links_payload = payload.links
    if links_payload is not None and (
        "social_links" not in update_data or update_data["social_links"] is None
    ):
        update_data["social_links"] = _build_social_links_from_payload(links_payload)
    update_data.pop("links", None)
    update_data.pop("expected_updated_at", None)
    for json_field in ("social_links", "extra_json"):
        if json_field in update_data and update_data[json_field] is None:
            update_data[json_field] = {}
    previous_resume_profile = _resume_editor_profile_snapshot(profile)
    invalidates_resume_evaluations = any(
        field in update_data and getattr(profile, field, None) != update_data[field]
        for field in _RESUME_EVALUATION_PROFILE_FIELDS
    )
    for field, value in update_data.items():
        setattr(profile, field, value)
    if "social_links" in update_data:
        await _clear_profile_links(session, user_id)
    updated_at = utc_now()
    next_resume_profile = _resume_editor_profile_snapshot(profile)
    if previous_resume_profile != next_resume_profile:
        await _sync_global_resumes_after_profile_update(
            session,
            user_id,
            updated_at=updated_at,
            previous_profile=previous_resume_profile,
            invalidate_evaluations=invalidates_resume_evaluations,
        )
    profile.updated_at = updated_at
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


def _social_link_url(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        url = value.get("url")
        return str(url) if url is not None else ""
    return ""


def _resume_editor_profile_snapshot(profile: Any) -> Dict[str, str]:
    social_links = getattr(profile, "social_links", None)
    social_links = social_links if isinstance(social_links, dict) else {}
    extra_json = getattr(profile, "extra_json", None)
    extra_json = extra_json if isinstance(extra_json, dict) else {}
    return {
        "name": str(getattr(profile, "full_name", "") or ""),
        "email": str(getattr(profile, "email", "") or ""),
        "phone": str(getattr(profile, "phone", "") or ""),
        "location": str(getattr(profile, "location", "") or ""),
        "linkedin": _social_link_url(social_links.get("linkedin")),
        "summary": str(getattr(profile, "summary", "") or ""),
        "avatarDataUrl": str(extra_json.get("avatar_data_url") or ""),
    }


async def _sync_global_resumes_after_profile_update(
    session: AsyncSession,
    user_id: str,
    *,
    updated_at: datetime,
    previous_profile: Dict[str, str],
    invalidate_evaluations: bool,
) -> None:
    """Refresh global resumes and migrate unambiguous legacy global snapshots.

    A legacy embedded profile is global when it exactly matches the profile
    snapshot from immediately before this locked profile update. Canonicalizing
    it in the same transaction prevents the next read from misclassifying it as
    a local snapshot after the global values change.
    """
    await acquire_user_resume_analysis_lock(session, user_id)
    await session.execute(
        text(
            """
            UPDATE resumes
            SET config = (
                    CASE
                        WHEN :invalidate_evaluations
                          AND jsonb_typeof(COALESCE(config, '{}'::jsonb) -> 'jdAnalysis') = 'object'
                        THEN jsonb_set(
                            jsonb_set(
                                COALESCE(config, '{}'::jsonb),
                                '{jdAnalysis,isOutdated}',
                                'true'::jsonb,
                                true
                            ),
                            '{jdAnalysis,evaluationIsOutdated}',
                            'true'::jsonb,
                            true
                        )
                        ELSE COALESCE(config, '{}'::jsonb)
                    END
                    || jsonb_build_object('profileSyncMode', 'global')
                ) - 'profile',
                updated_at = :updated_at
            WHERE user_id = :user_id
              AND (
                    COALESCE(config, '{}'::jsonb) ->> 'profileSyncMode' = 'global'
                    OR (
                        NOT (COALESCE(config, '{}'::jsonb) ? 'profileSyncMode')
                        AND NOT (COALESCE(config, '{}'::jsonb) ? 'profile')
                    )
                    OR (
                        NOT (COALESCE(config, '{}'::jsonb) ? 'profileSyncMode')
                        AND COALESCE(config, '{}'::jsonb) ? 'profile'
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'name', '') = :profile_name
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'email', '') = :profile_email
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'phone', '') = :profile_phone
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'location', '') = :profile_location
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'linkedin', '') = :profile_linkedin
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'summary', '') = :profile_summary
                        AND COALESCE(COALESCE(config, '{}'::jsonb) -> 'profile' ->> 'avatarDataUrl', '') = :profile_avatar
                    )
                )
            """
        ),
        {
            "user_id": user_id,
            "updated_at": updated_at,
            "invalidate_evaluations": invalidate_evaluations,
            "profile_name": previous_profile["name"],
            "profile_email": previous_profile["email"],
            "profile_phone": previous_profile["phone"],
            "profile_location": previous_profile["location"],
            "profile_linkedin": previous_profile["linkedin"],
            "profile_summary": previous_profile["summary"],
            "profile_avatar": previous_profile["avatarDataUrl"],
        },
    )


async def _fetch_profile(session: AsyncSession, user_id: str) -> Optional[Profile]:
    result = await session.execute(select(Profile).where(Profile.user_id == user_id))
    return result.scalars().first()


async def _fetch_profile_for_update(
    session: AsyncSession,
    user_id: str,
) -> Optional[Profile]:
    result = await session.execute(
        select(Profile).where(Profile.user_id == user_id).with_for_update()
    )
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
    await ensure_user_with_signup_bonus(session, user_id)
