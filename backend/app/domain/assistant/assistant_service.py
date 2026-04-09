from __future__ import annotations

from datetime import timezone
from typing import List
from uuid import UUID

from sqlalchemy import delete, desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import (
    AIAssistantMessage,
    AIAssistantSession,
    Certification,
    ExperienceVersion,
    MasterExperience,
    Skill,
    UserSkill,
)
from ...utils.time_utils import utc_now
from ..certifications.schemas import CertificationCreate
from ..experience.schemas import ExperienceCreate, ExperienceVersionPayload
from ..skills.schemas import UserSkillCreate
from .schemas import AssistantSessionCreate, AssistantSessionUpdate


class NotFoundError(Exception):
    pass


class InvalidMessageError(Exception):
    pass


def _is_message_applied(message: AIAssistantMessage) -> bool:
    applied_at = (message.content_json or {}).get("applied_at")
    return isinstance(applied_at, str) and bool(applied_at.strip())


def _read_context_string(context: dict, key: str) -> str | None:
    value = context.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _latest_preview_matches_message(
    latest_preview: dict | None,
    message_content: dict | None,
) -> bool:
    if not isinstance(latest_preview, dict) or not isinstance(message_content, dict):
        return False
    return latest_preview == message_content


async def _get_or_create_skill(
    session: AsyncSession,
    *,
    name: str,
    category: str | None = None,
) -> Skill:
    query = select(Skill).where(Skill.name == name)
    if category is not None:
        query = query.where(Skill.category == category)
    result = await session.execute(query)
    skill = result.scalars().one_or_none()
    if skill:
        return skill

    skill = Skill(name=name, category=category)
    session.add(skill)
    await session.flush()
    return skill


async def _apply_direct_draft_card(
    session: AsyncSession,
    *,
    user_id: str,
    message: AIAssistantMessage,
) -> None:
    content = message.content_json or {}
    card_type = content.get("type")
    data = content.get("data")
    if not isinstance(data, dict):
        raise InvalidMessageError("Draft card payload is invalid")

    if card_type == "experience":
        payload = ExperienceCreate.model_validate(
            {
                "category": data.get("category"),
                "version": {
                    "title": data.get("title"),
                    "org": data.get("org"),
                    "start_date": data.get("startDate"),
                    "end_date": None if data.get("isCurrent") else data.get("endDate"),
                    "is_current": bool(data.get("isCurrent")),
                    "star": data.get("star") or {},
                },
            }
        )
        master = MasterExperience(user_id=user_id, category=payload.category)
        session.add(master)
        await session.flush()

        version = ExperienceVersion(
            master_experience_id=master.id,
            version=1,
            title=payload.version.title,
            org=payload.version.org,
            location=payload.version.location,
            start_date=payload.version.start_date,
            end_date=payload.version.end_date,
            is_current=payload.version.is_current,
            summary=payload.version.summary,
            highlights=payload.version.highlights,
            tags=payload.version.tags,
            star=payload.version.star,
        )
        session.add(version)
        await session.flush()

        master.latest_version_id = version.id
        master.updated_at = utc_now()
        session.add(master)
        return

    if card_type == "certification":
        payload = CertificationCreate.model_validate(
            {
                "name": data.get("name"),
                "issuer": data.get("issuer"),
                "issue_date": data.get("issueDate") or None,
                "expiry_date": data.get("expiryDate") or None,
                "credential_id": data.get("credentialId") or None,
                "credential_url": data.get("credentialUrl") or None,
                "description": data.get("description") or None,
            }
        )
        session.add(Certification(user_id=user_id, **payload.model_dump()))
        return

    if card_type == "skill_group":
        raw_skills = data.get("skills")
        if not isinstance(raw_skills, list) or not raw_skills:
            raise InvalidMessageError("Draft skill group payload is invalid")
        for raw_skill in raw_skills:
            if not isinstance(raw_skill, dict):
                raise InvalidMessageError("Draft skill group payload is invalid")
            payload = UserSkillCreate.model_validate(
                {
                    "name": raw_skill.get("name"),
                    "category": data.get("category") or None,
                    "proficiency": raw_skill.get("proficiency"),
                }
            )
            skill = await _get_or_create_skill(
                session,
                name=payload.name,
                category=payload.category,
            )
            session.add(
                UserSkill(
                    user_id=user_id,
                    skill_id=skill.id,
                    proficiency=payload.proficiency,
                )
            )
        return

    raise InvalidMessageError(f"Unsupported draft card type: {card_type}")


async def _apply_experience_bank_draft_card(
    session: AsyncSession,
    *,
    user_id: str,
    assistant_session: AIAssistantSession,
    message: AIAssistantMessage,
) -> None:
    content = message.content_json or {}
    if content.get("type") != "experience":
        raise InvalidMessageError("Experience bank sessions only support experience draft cards")
    data = content.get("data")
    if not isinstance(data, dict):
        raise InvalidMessageError("Draft card payload is invalid")

    master_id = _read_context_string(assistant_session.context_json or {}, "masterId")
    if not master_id:
        raise InvalidMessageError("Assistant session is missing experience context")

    result = await session.execute(
        select(MasterExperience).where(
            MasterExperience.id == master_id,
            MasterExperience.user_id == user_id,
        )
    )
    master = result.scalars().one_or_none()
    if not master:
        raise NotFoundError(f"Master experience {master_id} not found")

    latest_version = None
    if master.latest_version_id:
        version_result = await session.execute(
            select(ExperienceVersion).where(
                ExperienceVersion.id == master.latest_version_id,
                ExperienceVersion.master_experience_id == master.id,
            )
        )
        latest_version = version_result.scalars().one_or_none()

    payload = ExperienceVersionPayload.model_validate(
        {
            "title": (data.get("title") or "").strip() or (latest_version.title if latest_version else None),
            "org": (data.get("org") or "").strip() or (latest_version.org if latest_version else None),
            "location": latest_version.location if latest_version else None,
            "start_date": data.get("startDate") or None,
            "end_date": None if data.get("isCurrent") else (data.get("endDate") or None),
            "is_current": bool(data.get("isCurrent")),
            "summary": latest_version.summary if latest_version else None,
            "highlights": latest_version.highlights if latest_version else [],
            "tags": latest_version.tags if latest_version else [],
            "star": data.get("star") or {},
        }
    )

    version_number_result = await session.execute(
        select(ExperienceVersion.version)
        .where(ExperienceVersion.master_experience_id == master.id)
        .order_by(desc(ExperienceVersion.version))
        .limit(1)
    )
    current_version = version_number_result.scalars().first()

    version = ExperienceVersion(
        master_experience_id=master.id,
        version=(current_version or 0) + 1,
        title=payload.title,
        org=payload.org,
        location=payload.location,
        start_date=payload.start_date,
        end_date=payload.end_date,
        is_current=payload.is_current,
        summary=payload.summary,
        highlights=payload.highlights,
        tags=payload.tags,
        star=payload.star,
    )
    session.add(version)
    await session.flush()

    master.latest_version_id = version.id
    master.updated_at = utc_now()
    session.add(master)


async def list_sessions(
    session: AsyncSession,
    user_id: str,
) -> List[AIAssistantSession]:
    result = await session.execute(
        select(AIAssistantSession)
        .where(AIAssistantSession.user_id == user_id)
        .order_by(AIAssistantSession.updated_at.desc())
    )
    return list(result.scalars().all())


async def create_session(
    session: AsyncSession,
    user_id: str,
    payload: AssistantSessionCreate,
) -> AIAssistantSession:
    assistant_session = AIAssistantSession(
        user_id=user_id,
        title=payload.title or _build_default_title(payload.mode),
        mode=payload.mode,
        entry_source=payload.entry_source,
        context_json=payload.context_json,
    )
    session.add(assistant_session)
    await session.commit()
    await session.refresh(assistant_session)
    return assistant_session


async def update_session(
    session: AsyncSession,
    user_id: str,
    session_id: UUID,
    payload: AssistantSessionUpdate,
) -> AIAssistantSession:
    assistant_session = await get_session(session, user_id, session_id)
    if payload.title is not None:
        normalized_title = payload.title.strip()
        if normalized_title:
            assistant_session.title = normalized_title
    assistant_session.updated_at = utc_now()
    session.add(assistant_session)
    await session.commit()
    await session.refresh(assistant_session)
    return assistant_session


async def get_session_detail(
    session: AsyncSession,
    user_id: str,
    session_id: UUID,
) -> tuple[AIAssistantSession, List[AIAssistantMessage]]:
    assistant_session = await get_session(session, user_id, session_id)
    result = await session.execute(
        select(AIAssistantMessage)
        .where(AIAssistantMessage.session_id == assistant_session.id)
        .order_by(AIAssistantMessage.created_at.asc())
    )
    return assistant_session, list(result.scalars().all())


async def get_session(
    session: AsyncSession,
    user_id: str,
    session_id: UUID,
) -> AIAssistantSession:
    result = await session.execute(
        select(AIAssistantSession).where(
            AIAssistantSession.id == session_id,
            AIAssistantSession.user_id == user_id,
        )
    )
    assistant_session = result.scalars().one_or_none()
    if not assistant_session:
        raise NotFoundError(f"Assistant session {session_id} not found")
    return assistant_session


async def delete_session(
    session: AsyncSession,
    user_id: str,
    session_id: UUID,
) -> None:
    assistant_session = await get_session(session, user_id, session_id)
    await session.execute(
        delete(AIAssistantMessage).where(AIAssistantMessage.session_id == assistant_session.id)
    )
    await session.delete(assistant_session)
    await session.commit()


async def mark_message_applied(
    session: AsyncSession,
    user_id: str,
    session_id: UUID,
    message_id: UUID,
    skip_apply: bool = False,
) -> AIAssistantMessage:
    assistant_session = await get_session(session, user_id, session_id)
    result = await session.execute(
        select(AIAssistantMessage).where(
            AIAssistantMessage.id == message_id,
            AIAssistantMessage.session_id == assistant_session.id,
        )
    )
    message = result.scalars().one_or_none()
    if not message:
        raise NotFoundError(f"Assistant message {message_id} not found")
    if message.message_type != "draft_card":
        raise InvalidMessageError("Only draft card messages can be marked as applied")
    if _is_message_applied(message):
        return message
    if skip_apply:
        if assistant_session.entry_source == "direct":
            raise InvalidMessageError("Direct assistant sessions must apply content before marking as applied")
    elif assistant_session.entry_source == "direct":
        await _apply_direct_draft_card(
            session,
            user_id=user_id,
            message=message,
        )
    elif assistant_session.entry_source == "experience_bank":
        await _apply_experience_bank_draft_card(
            session,
            user_id=user_id,
            assistant_session=assistant_session,
            message=message,
        )

    previous_content = dict(message.content_json or {})
    next_content = dict(previous_content)
    next_content["applied_at"] = utc_now().astimezone(timezone.utc).isoformat()
    message.content_json = next_content
    session.add(message)
    if _latest_preview_matches_message(assistant_session.latest_preview, previous_content):
        assistant_session.latest_preview = next_content
        session.add(assistant_session)
    await session.commit()
    await session.refresh(message)
    return message


async def append_message(
    session: AsyncSession,
    assistant_session: AIAssistantSession,
    *,
    role: str,
    message_type: str,
    content_json: dict,
) -> AIAssistantMessage:
    message = AIAssistantMessage(
        session_id=assistant_session.id,
        role=role,
        message_type=message_type,
        content_json=content_json,
    )
    session.add(message)
    assistant_session.updated_at = utc_now()
    session.add(assistant_session)
    await session.commit()
    await session.refresh(message)
    await session.refresh(assistant_session)
    return message


async def persist_assistant_turn(
    session: AsyncSession,
    assistant_session: AIAssistantSession,
    *,
    user_message: str,
    assistant_text: str,
    draft_card: dict | None,
    title: str | None = None,
) -> list[AIAssistantMessage]:
    created_messages: list[AIAssistantMessage] = []
    created_messages.append(
        AIAssistantMessage(
            session_id=assistant_session.id,
            role="user",
            message_type="user_text",
            content_json={"text": user_message},
        )
    )
    created_messages.append(
        AIAssistantMessage(
            session_id=assistant_session.id,
            role="assistant",
            message_type="assistant_text",
            content_json={"text": assistant_text},
        )
    )
    if draft_card:
        created_messages.append(
            AIAssistantMessage(
                session_id=assistant_session.id,
                role="assistant",
                message_type="draft_card",
                content_json=draft_card,
            )
        )
        assistant_session.latest_preview = draft_card
    else:
        assistant_session.latest_preview = {}
    if title:
        assistant_session.title = title
    assistant_session.updated_at = utc_now()
    session.add(assistant_session)
    for message in created_messages:
        session.add(message)
    await session.commit()
    for message in created_messages:
        await session.refresh(message)
    await session.refresh(assistant_session)
    return created_messages


def _build_default_title(mode: str) -> str:
    if mode == "general":
        return "AI 助理"
    if mode == "experience":
        return "经历整理"
    if mode == "certification":
        return "证书整理"
    if mode == "skill":
        return "技能整理"
    return "AI 助理"
