from typing import Any, Dict, List, Tuple

from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..constants import ALLOWED_OVERRIDE_KEYS
from ..models import ExperienceVersion, MasterExperience, Resume, ResumeExperience, utc_now
from ..schemas import ResumeCreate, ResumeExperiencePatch, ResumeUpdate
from .experience_service import get_version_for_user


class NotFoundError(Exception):
    pass


OP_REQUIREMENTS = {
    "add": {"required": {"experience_version_id", "section"}, "optional": {"position"}},
    "remove": {"required": {"resume_experience_id"}, "optional": set()},
    "move": {"required": {"resume_experience_id", "position"}, "optional": set()},
    "override": {
        "required": {"resume_experience_id", "overrides_json"},
        "optional": set(),
    },
    "sync": {"required": {"resume_experience_id"}, "optional": {"mode"}},
}


async def list_resumes(
    session: AsyncSession, user_id: str, limit: int, offset: int
) -> List[Resume]:
    result = await session.exec(
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(desc(Resume.updated_at))
        .limit(limit)
        .offset(offset)
    )
    return list(result.all())


async def get_resume(session: AsyncSession, user_id: str, resume_id: str) -> Resume:
    result = await session.exec(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id)
    )
    resume = result.first()
    if not resume:
        raise NotFoundError("Resume not found")
    return resume


async def create_resume(
    session: AsyncSession, user_id: str, payload: ResumeCreate
) -> Resume:
    resume = Resume(
        user_id=user_id,
        title=payload.title,
        target_role=payload.target_role,
        template_id=payload.template_id,
    )
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


async def update_resume(
    session: AsyncSession, user_id: str, resume_id: str, payload: ResumeUpdate
) -> Resume:
    resume = await get_resume(session, user_id, resume_id)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(resume, field, value)
    resume.updated_at = utc_now()
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


async def archive_resume(
    session: AsyncSession, user_id: str, resume_id: str
) -> Resume:
    resume = await get_resume(session, user_id, resume_id)
    resume.is_archived = True
    resume.updated_at = utc_now()
    session.add(resume)
    await session.commit()
    await session.refresh(resume)
    return resume


async def list_resume_experiences(
    session: AsyncSession, resume_id: str
) -> List[Tuple[ResumeExperience, ExperienceVersion]]:
    result = await session.exec(
        select(ResumeExperience, ExperienceVersion)
        .join(
            ExperienceVersion,
            ExperienceVersion.id == ResumeExperience.experience_version_id,
        )
        .where(ResumeExperience.resume_id == resume_id)
        .order_by(ResumeExperience.position)
    )
    return list(result.all())


async def apply_experience_ops(
    session: AsyncSession,
    user_id: str,
    resume_id: str,
    payload: ResumeExperiencePatch,
) -> None:
    resume = await get_resume(session, user_id, resume_id)
    ops = _validate_ops(payload.ops)

    handlers = {
        "add": _handle_add,
        "remove": lambda s, _u, r, o: _handle_remove(s, r, o),
        "move": lambda s, _u, r, o: _handle_move(s, r, o),
        "override": lambda s, _u, r, o: _handle_override(s, r, o),
        "sync": _handle_sync,
    }

    for op in ops:
        handler = handlers[op["op"]]
        await handler(session, user_id, resume, op)

    resume.updated_at = utc_now()
    session.add(resume)
    await session.commit()


def _validate_ops(ops: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized = []
    for op in ops:
        op_type = op.get("op")
        rules = OP_REQUIREMENTS.get(op_type)
        if not rules:
            raise ValueError(f"Unsupported op: {op_type}")
        missing = rules["required"] - set(op.keys())
        if missing:
            raise ValueError(f"Missing fields for {op_type}: {sorted(missing)}")
        normalized.append(op)
    return normalized


async def _handle_add(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    version_id = op["experience_version_id"]
    section = op["section"]
    position = int(op.get("position", 0))

    await get_version_for_user(session, user_id, version_id)
    resume_experience = ResumeExperience(
        resume_id=resume.id,
        experience_version_id=version_id,
        section=section,
        position=position,
    )
    session.add(resume_experience)


async def _handle_remove(
    session: AsyncSession, resume: Resume, op: Dict[str, Any]
) -> None:
    resume_experience = await _get_resume_experience(
        session, resume.id, op["resume_experience_id"]
    )
    session.delete(resume_experience)


async def _handle_move(
    session: AsyncSession, resume: Resume, op: Dict[str, Any]
) -> None:
    resume_experience = await _get_resume_experience(
        session, resume.id, op["resume_experience_id"]
    )
    resume_experience.position = int(op["position"])
    session.add(resume_experience)


async def _handle_override(
    session: AsyncSession, resume: Resume, op: Dict[str, Any]
) -> None:
    resume_experience = await _get_resume_experience(
        session, resume.id, op["resume_experience_id"]
    )
    overrides = _filter_overrides(op.get("overrides_json") or {})
    merged = {**(resume_experience.overrides_json or {}), **overrides}
    resume_experience.overrides_json = merged
    session.add(resume_experience)


async def _handle_sync(
    session: AsyncSession, user_id: str, resume: Resume, op: Dict[str, Any]
) -> None:
    resume_experience = await _get_resume_experience(
        session, resume.id, op["resume_experience_id"]
    )
    version = await get_version_for_user(
        session, user_id, resume_experience.experience_version_id
    )
    result = await session.exec(
        select(MasterExperience).where(MasterExperience.id == version.master_experience_id)
    )
    master = result.first()
    if master and master.latest_version_id:
        resume_experience.experience_version_id = master.latest_version_id
        session.add(resume_experience)


async def _get_resume_experience(
    session: AsyncSession, resume_id: str, resume_experience_id: str
) -> ResumeExperience:
    result = await session.exec(
        select(ResumeExperience).where(
            ResumeExperience.id == resume_experience_id,
            ResumeExperience.resume_id == resume_id,
        )
    )
    resume_experience = result.first()
    if not resume_experience:
        raise NotFoundError("Resume experience not found")
    return resume_experience


def _filter_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in overrides.items() if key in ALLOWED_OVERRIDE_KEYS}
