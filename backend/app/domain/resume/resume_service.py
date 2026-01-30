from typing import Any, Dict, List, Tuple

from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...constants import ALLOWED_OVERRIDE_KEYS
from ...models import ExperienceVersion
from ...utils.time_utils import utc_now
from ..experience.experience_service import get_version_for_user
from .models import Resume, ResumeExperienceLink
from .resume_schema import (
    ResumeAssemblyPatch,
    ResumeCreate,
    ResumeExperienceItem,
    ResumeExperienceMerged,
)


class NotFoundError(Exception):
    pass


OP_REQUIREMENTS = {
    "add": {"required": {"experience_version_id"}, "optional": {"display_order"}},
    "remove": {"required": {"resume_experience_id"}, "optional": set()},
    "reorder": {"required": {"resume_experience_id", "display_order"}, "optional": set()},
    "override": {"required": {"resume_experience_id", "overrides_json"}, "optional": set()},
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
    resume = await _get_resume(session, user_id, resume_id)
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
    overrides = _filter_overrides(op.get("overrides_json") or {})
    merged = {**(link.overrides_json or {}), **overrides}
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
    session: AsyncSession, user_id: str, resume_id: str
) -> Resume:
    result = await session.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id)
    )
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
    return {key: value for key, value in overrides.items() if key in ALLOWED_OVERRIDE_KEYS}


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
        star=version.star,
    ).model_dump()
    for key, value in overrides.items():
        if key in data:
            data[key] = value
    return ResumeExperienceMerged(**data)
