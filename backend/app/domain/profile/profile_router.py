from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import get_session
from ...dependencies import get_current_user
from ...models import Profile
from .profile_service import get_current_profile, update_profile
from .schemas import ProfileLinkPayload, ProfileRead, ProfileUpdate

router = APIRouter(prefix="/profile", tags=["profile"])

NAME_CLAIM_KEYS = ("name", "username", "email")


def _normalize_full_name(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _extract_full_name_hint(claims: Dict[str, Any]) -> Optional[str]:
    for key in NAME_CLAIM_KEYS:
        candidate = _normalize_full_name(claims.get(key))
        if candidate:
            return candidate
    return None


def _build_legacy_links(social_links: Dict[str, Any]) -> List[ProfileLinkPayload]:
    links: List[ProfileLinkPayload] = []
    for label, data in social_links.items():
        if not isinstance(data, dict):
            continue
        url = data.get("url")
        if not url:
            continue
        position = data.get("position")
        if not isinstance(position, int):
            position = 0
        links.append(ProfileLinkPayload(label=label, url=url, position=position))
    return sorted(links, key=lambda item: item.position)


def _profile_to_read(profile: Profile) -> ProfileRead:
    social_links = profile.social_links or {}
    return ProfileRead(
        user_id=profile.user_id,
        full_name=profile.full_name,
        title=profile.title,
        summary=profile.summary,
        location=profile.location,
        phone=profile.phone,
        email=profile.email,
        social_links=social_links,
        links=_build_legacy_links(social_links),
        extra_json=profile.extra_json or {},
        updated_at=profile.updated_at,
    )


@router.get("", response_model=ProfileRead)
async def get_profile(
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    claims = getattr(request.state, "claims", None)
    if not isinstance(claims, dict):
        claims = {}
    full_name_hint = _extract_full_name_hint(claims)
    profile = await get_current_profile(
        session,
        current_user.id,
        full_name_hint=full_name_hint,
    )
    return _profile_to_read(profile)


@router.patch("", response_model=ProfileRead)
async def patch_profile(
    payload: ProfileUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
):
    profile = await update_profile(session, current_user.id, payload)
    return _profile_to_read(profile)
