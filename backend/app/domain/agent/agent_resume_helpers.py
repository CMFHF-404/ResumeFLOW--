from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_404_NOT_FOUND

from ...models import ExperienceCategory, MasterExperience
from ..certifications.certification_service import list_certifications
from ..experience.experience_service import list_experiences
from ..profile.profile_service import get_profile_if_exists
from ..resume.models import Resume
from ..resume.resume_schema import ResumeExperienceItem
from ..resume.resume_service import NotFoundError as ResumeNotFoundError
from ..resume.resume_service import get_resume_detail
from ..skills.skill_service import list_user_skills
from .agent_common_helpers import _as_experience_category


AGENT_EXPERIENCE_FETCH_LIMIT = 200


async def resolve_agent_resume(
    session: AsyncSession,
    user_id: str,
    resume_id: Optional[str],
) -> Resume:
    if resume_id:
        try:
            resume, _items = await get_resume_detail(session, user_id, resume_id)
        except ResumeNotFoundError as exc:
            raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return resume

    result = await session.execute(
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(desc(Resume.updated_at))
    )
    resumes = result.scalars().all()
    if not resumes:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="No resume found")
    for resume in resumes:
        if not _is_agent_generated_resume(resume):
            return resume
    return resumes[0]

def _is_agent_generated_resume(resume: Resume) -> bool:
    config = getattr(resume, "config", None)
    return isinstance(config, dict) and isinstance(config.get("agentJob"), dict)

async def resolve_agent_resume_detail(
    session: AsyncSession,
    user_id: str,
    resume_id: Optional[str],
) -> Tuple[Resume, List[ResumeExperienceItem]]:
    resume = await resolve_agent_resume(session, user_id, resume_id)
    try:
        return await get_resume_detail(session, user_id, str(resume.id))
    except ResumeNotFoundError as exc:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail=str(exc)) from exc

async def _load_agent_bank(session: AsyncSession, user_id: str) -> Dict[str, Any]:
    profile = await get_profile_if_exists(session, user_id)
    experience_rows = await list_experiences(
        session,
        user_id,
        category=None,
        keyword=None,
        limit=AGENT_EXPERIENCE_FETCH_LIMIT,
        offset=0,
        include_archived=False,
    )
    certifications = await list_certifications(session, user_id)
    skill_rows = await list_user_skills(session, user_id)
    return {
        "profile": profile,
        "experiences": experience_rows,
        "certifications": certifications,
        "skills": skill_rows,
    }

def _resume_item_master_ids(resume_items: List[ResumeExperienceItem]) -> List[str]:
    ids: List[str] = []
    for item in resume_items:
        master_id = str(getattr(item.experience, "master_experience_id", "") or "")
        if master_id:
            ids.append(master_id)
    return ids

async def _load_resume_item_categories(
    session: AsyncSession,
    user_id: str,
    resume_items: List[ResumeExperienceItem],
) -> Dict[str, ExperienceCategory]:
    master_ids = _resume_item_master_ids(resume_items)
    if not master_ids:
        return {}
    master_uuid_ids: List[uuid.UUID] = []
    for master_id in master_ids:
        try:
            master_uuid_ids.append(uuid.UUID(master_id))
        except ValueError:
            continue
    if not master_uuid_ids:
        return {}
    result = await session.execute(
        select(MasterExperience).where(
            MasterExperience.user_id == user_id,
            MasterExperience.id.in_(master_uuid_ids),
        )
    )
    category_by_master_id: Dict[str, ExperienceCategory] = {}
    for master in result.scalars().all():
        category = _as_experience_category(getattr(master, "category", None))
        if category:
            category_by_master_id[str(master.id)] = category
    return category_by_master_id
