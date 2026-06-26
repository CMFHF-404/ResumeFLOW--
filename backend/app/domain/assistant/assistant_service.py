from __future__ import annotations

import logging
from datetime import timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import delete, desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import (
    AIAssistantImageBlob,
    AIAssistantMessage,
    AIAssistantSession,
    Certification,
    ExperienceCategory,
    ExperienceVersion,
    MasterExperience,
    Skill,
    UserSkill,
)
from ...utils.time_utils import utc_now
from ..ai.assistant_action_utils import (
    _normalize_assistant_action_text,
    _normalize_assistant_draft_card,
)
from ..ai.ai_service import (
    _normalize_selected_experiences,
    _normalize_selected_resume,
)
from ..certifications.schemas import CertificationCreate
from ..experience.schemas import ExperienceCreate, ExperienceVersionPayload
from .schemas import AssistantSessionCreate, AssistantSessionUpdate


logger = logging.getLogger("uvicorn.error")


class NotFoundError(Exception):
    pass


class InvalidMessageError(Exception):
    pass


def _sanitize_attachment_preview(attachment: Any) -> dict | None:
    if not isinstance(attachment, dict):
        return None
    return {
        key: value
        for key, value in attachment.items()
        if key not in {"imageB64", "text"}
    }


def _is_message_applied(message: AIAssistantMessage) -> bool:
    applied_at = (message.content_json or {}).get("applied_at")
    return isinstance(applied_at, str) and bool(applied_at.strip())


def _read_context_string(context: dict, key: str) -> str | None:
    value = context.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _summarize_draft_content(content: Any) -> Dict[str, Any]:
    if not isinstance(content, dict):
        return {"content_type": type(content).__name__}
    data = content.get("data")
    if not isinstance(data, dict):
        return {
            "type": content.get("type"),
            "status": content.get("status"),
            "has_data": False,
        }
    return {
        "type": content.get("type"),
        "status": content.get("status"),
        "category": data.get("category"),
        "has_data": True,
        "has_targetMasterId": isinstance(data.get("targetMasterId"), str)
        and bool(data.get("targetMasterId").strip()),
        "has_title": isinstance(data.get("title"), str) and bool(data.get("title").strip()),
        "has_org": isinstance(data.get("org"), str) and bool(data.get("org").strip()),
        "has_startDate": isinstance(data.get("startDate"), str) and bool(data.get("startDate").strip()),
        "has_endDate": isinstance(data.get("endDate"), str) and bool(data.get("endDate").strip()),
        "isCurrent": data.get("isCurrent"),
        "has_star": isinstance(data.get("star"), dict),
    }


def _latest_preview_matches_message(
    latest_preview: dict | None,
    message_content: dict | None,
) -> bool:
    if not isinstance(latest_preview, dict) or not isinstance(message_content, dict):
        return False
    return latest_preview == message_content


def _normalize_apply_draft_content(content: Any) -> Dict[str, Any]:
    normalized = _normalize_assistant_draft_card(content)
    if not isinstance(normalized, dict):
        raise InvalidMessageError("Draft card payload is invalid")
    return normalized


def _read_draft_target_master_id(data: Dict[str, Any]) -> str | None:
    value = data.get("targetMasterId")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _read_draft_experience_category(data: Dict[str, Any]) -> ExperienceCategory:
    raw_category = data.get("category")
    if isinstance(raw_category, ExperienceCategory):
        return raw_category
    if isinstance(raw_category, str):
        try:
            return ExperienceCategory(raw_category)
        except ValueError:
            pass
    raise InvalidMessageError("Draft experience category is invalid")


def _build_apply_navigation(
    *,
    target_view: str,
    target_id: str | None = None,
    category: ExperienceCategory | str | None = None,
    resume_id: str | None = None,
) -> Dict[str, str]:
    navigation: Dict[str, str] = {"targetView": target_view}
    if target_id:
        navigation["targetId"] = str(target_id)
    if resume_id:
        navigation["resumeId"] = str(resume_id)
    if category:
        navigation["category"] = category.value if isinstance(category, ExperienceCategory) else str(category)
    return navigation


def _build_existing_experience_navigation(
    assistant_session: AIAssistantSession,
    data: Dict[str, Any],
    *,
    default_view: str,
    allow_unbound_target: bool,
) -> Dict[str, str] | None:
    category = _read_draft_experience_category(data)
    master_id = _resolve_bound_experience_master_id(
        assistant_session,
        data,
        allow_unbound_target=allow_unbound_target,
    )
    if not master_id:
        return None
    resume_id = _read_context_string(assistant_session.context_json or {}, "resumeId")
    target_view = "resume_editor" if default_view == "resume_editor" and resume_id else default_view
    return _build_apply_navigation(
        target_view=target_view,
        target_id=master_id,
        category=category,
        resume_id=resume_id,
    )


async def _get_user_master_experience(
    session: AsyncSession,
    *,
    user_id: str,
    master_id: str,
) -> MasterExperience:
    result = await session.execute(
        select(MasterExperience).where(
            MasterExperience.id == master_id,
            MasterExperience.user_id == user_id,
        )
    )
    master = result.scalars().one_or_none()
    if not master:
        raise NotFoundError(f"Master experience {master_id} not found")
    return master


async def _get_latest_experience_version(
    session: AsyncSession,
    *,
    master: MasterExperience,
) -> Optional[ExperienceVersion]:
    if not master.latest_version_id:
        return None
    result = await session.execute(
        select(ExperienceVersion).where(
            ExperienceVersion.id == master.latest_version_id,
            ExperienceVersion.master_experience_id == master.id,
        )
    )
    return result.scalars().one_or_none()


def _merge_star_payload(
    incoming_star: Any,
    category: ExperienceCategory,
    latest_version: Optional[ExperienceVersion] = None,
) -> Dict[str, Any]:
    resolved_star = latest_version.star.copy() if latest_version and isinstance(latest_version.star, dict) else {}
    if not isinstance(incoming_star, dict):
        return resolved_star
    if category == ExperienceCategory.EDUCATION:
        existing_star = dict(resolved_star)
        for key in ("s", "t", "a", "r"):
            resolved_star.pop(key, None)
        for source_key, target_key in (("s", "degree"), ("t", "gpa"), ("a", "courses")):
            value = incoming_star.get(source_key)
            if not (isinstance(value, str) and value.strip()):
                value = incoming_star.get(target_key)
            if not (isinstance(value, str) and value.strip()):
                value = existing_star.get(target_key)
            if not (isinstance(value, str) and value.strip()):
                value = existing_star.get(source_key)
            if isinstance(value, str) and value.strip():
                resolved_star[target_key] = value
            elif target_key not in resolved_star and isinstance(value, str):
                resolved_star[target_key] = value
        return resolved_star
    for key in ("s", "t", "a", "r"):
        value = incoming_star.get(key)
        normalized_value = (
            _normalize_assistant_action_text(value)
            if key == "a" and category != ExperienceCategory.EDUCATION
            else value
        )
        if isinstance(value, str) and value.strip():
            resolved_star[key] = normalized_value
        elif key not in resolved_star and isinstance(value, str):
            resolved_star[key] = normalized_value
    return resolved_star


def _build_experience_version_payload(
    data: Dict[str, Any],
    *,
    category: ExperienceCategory,
    latest_version: Optional[ExperienceVersion] = None,
) -> ExperienceVersionPayload:
    title = (data.get("title") or "").strip() if isinstance(data.get("title"), str) else ""
    org = (data.get("org") or "").strip() if isinstance(data.get("org"), str) else ""
    start_date = (data.get("startDate") or "").strip() if isinstance(data.get("startDate"), str) else ""
    end_date = (data.get("endDate") or "").strip() if isinstance(data.get("endDate"), str) else ""
    requested_is_current = bool(data.get("isCurrent"))

    should_preserve_existing_dates = (
        latest_version is not None
        and not start_date
        and not end_date
        and not requested_is_current
    )

    if should_preserve_existing_dates:
        resolved_start_date = latest_version.start_date
        resolved_end_date = latest_version.end_date
        resolved_is_current = bool(latest_version.is_current)
    else:
        resolved_start_date = start_date or (latest_version.start_date if latest_version else None)
        resolved_is_current = requested_is_current
        if resolved_is_current:
            resolved_end_date = None
        else:
            resolved_end_date = end_date or (
                latest_version.end_date
                if latest_version and not latest_version.is_current
                else None
            )

    return ExperienceVersionPayload.model_validate(
        {
            "title": title or (latest_version.title if latest_version else None),
            "org": org or (latest_version.org if latest_version else None),
            "location": latest_version.location if latest_version else None,
            "start_date": resolved_start_date,
            "end_date": resolved_end_date,
            "is_current": resolved_is_current,
            "summary": latest_version.summary if latest_version else None,
            "highlights": latest_version.highlights if latest_version else [],
            "tags": latest_version.tags if latest_version else [],
            "star": _merge_star_payload(data.get("star"), category, latest_version),
        }
    )


async def _create_experience_version(
    session: AsyncSession,
    *,
    master: MasterExperience,
    payload: ExperienceVersionPayload,
) -> ExperienceVersion:
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
    return version


def _resolve_bound_experience_master_id(
    assistant_session: AIAssistantSession,
    data: Dict[str, Any],
    *,
    allow_unbound_target: bool,
) -> str | None:
    context_master_id = _read_context_string(assistant_session.context_json or {}, "masterId")
    target_master_id = _read_draft_target_master_id(data)
    if context_master_id:
        if target_master_id and target_master_id != context_master_id:
            if assistant_session.entry_source == "experience_bank":
                logger.warning(
                    "Ignoring mismatched assistant draft target for experience_bank session: session_id=%s context_master_id=%s has_draft_target_master_id=%s",
                    assistant_session.id,
                    context_master_id,
                    True,
                )
                return context_master_id
            raise InvalidMessageError("Draft target does not match the current experience context")
        return context_master_id
    if not allow_unbound_target:
        return None
    return target_master_id


def _normalize_skill_merge_text(raw: Any) -> str:
    if not isinstance(raw, str):
        return ""
    return " ".join(raw.strip().split())


def _build_skill_merge_key(*, name: str | None, category: str | None) -> str:
    normalized_name = _normalize_skill_merge_text(name).casefold()
    normalized_category = _normalize_skill_merge_text(category).casefold()
    return f"{normalized_category}\0{normalized_name}"


def _read_target_user_skill_id(raw_skill: Dict[str, Any]) -> str | None:
    value = raw_skill.get("targetUserSkillId")
    return value.strip() if isinstance(value, str) and value.strip() else None


async def _get_or_create_skill(
    session: AsyncSession,
    *,
    name: str,
    category: str | None = None,
) -> Skill:
    query = select(Skill).where(Skill.name == name)
    query = query.where(Skill.category == category)
    result = await session.execute(query)
    skill = result.scalars().one_or_none()
    if skill:
        return skill

    skill = Skill(name=name, category=category)
    session.add(skill)
    await session.flush()
    return skill


async def _list_user_skill_rows(session: AsyncSession, *, user_id: str) -> List[tuple[UserSkill, Skill]]:
    result = await session.execute(
        select(UserSkill, Skill)
        .join(Skill, UserSkill.skill_id == Skill.id)
        .where(UserSkill.user_id == user_id)
    )
    return list(result.all())


def _normalize_skill_group_drafts(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    category = _normalize_skill_merge_text(data.get("category")) or None
    raw_skills = data.get("skills")
    if not isinstance(raw_skills, list) or not raw_skills:
        raise InvalidMessageError("Draft skill group payload is invalid")

    normalized_by_key: Dict[str, Dict[str, Any]] = {}
    for raw_skill in raw_skills:
        if not isinstance(raw_skill, dict):
            raise InvalidMessageError("Draft skill group payload is invalid")
        name = _normalize_skill_merge_text(raw_skill.get("name"))
        if not name:
            continue
        key = _build_skill_merge_key(name=name, category=category)
        normalized_by_key[key] = {
            "name": name,
            "category": category,
            "target_user_skill_id": _read_target_user_skill_id(raw_skill),
        }

    if not normalized_by_key:
        raise InvalidMessageError("Draft skill group payload is invalid")
    return list(normalized_by_key.values())


async def _apply_skill_group_draft_card(
    session: AsyncSession,
    *,
    user_id: str,
    data: Dict[str, Any],
) -> None:
    skill_drafts = _normalize_skill_group_drafts(data)
    existing_rows = await _list_user_skill_rows(session, user_id=user_id)
    existing_by_id = {str(user_skill.id): (user_skill, skill) for user_skill, skill in existing_rows}
    existing_by_key: Dict[str, tuple[UserSkill, Skill]] = {}
    for user_skill, skill in existing_rows:
        key = _build_skill_merge_key(name=skill.name, category=skill.category)
        existing_by_key.setdefault(key, (user_skill, skill))

    for item in skill_drafts:
        name = item["name"]
        category = item["category"]
        target_user_skill_id = item["target_user_skill_id"]
        key = _build_skill_merge_key(name=name, category=category)
        existing_row = existing_by_id.get(target_user_skill_id) if target_user_skill_id else None
        if existing_row is None:
            existing_row = existing_by_key.get(key)

        skill = await _get_or_create_skill(
            session,
            name=name,
            category=category,
        )
        if existing_row is not None:
            user_skill, _existing_skill = existing_row
            user_skill.skill_id = skill.id
            session.add(user_skill)
            existing_by_id[str(user_skill.id)] = (user_skill, skill)
            existing_by_key[key] = (user_skill, skill)
            continue

        user_skill = UserSkill(
            user_id=user_id,
            skill_id=skill.id,
        )
        session.add(user_skill)
        existing_by_id[str(user_skill.id)] = (user_skill, skill)
        existing_by_key[key] = (user_skill, skill)


async def _apply_direct_draft_card(
    session: AsyncSession,
    *,
    user_id: str,
    assistant_session: AIAssistantSession,
    message: AIAssistantMessage,
) -> Dict[str, str] | None:
    content = _normalize_apply_draft_content(message.content_json or {})
    card_type = content.get("type")
    data = content.get("data")
    if not isinstance(data, dict):
        raise InvalidMessageError("Draft card payload is invalid")

    if card_type == "experience":
        requested_category = _read_draft_experience_category(data)
        target_master_id = _resolve_bound_experience_master_id(
            assistant_session,
            data,
            allow_unbound_target=True,
        )
        if target_master_id:
            master = await _get_user_master_experience(
                session,
                user_id=user_id,
                master_id=target_master_id,
            )
            if master.category != requested_category:
                raise InvalidMessageError("Draft target category does not match the existing experience")
            latest_version = await _get_latest_experience_version(session, master=master)
            payload = _build_experience_version_payload(
                data,
                category=requested_category,
                latest_version=latest_version,
            )
            await _create_experience_version(
                session,
                master=master,
                payload=payload,
            )
            return _build_apply_navigation(
                target_view="experience_bank",
                target_id=str(master.id),
                category=master.category,
            )

        payload = ExperienceCreate.model_validate(
            {
                "category": requested_category,
                "version": _build_experience_version_payload(
                    data,
                    category=requested_category,
                ).model_dump(),
            }
        )
        master = MasterExperience(user_id=user_id, category=payload.category)
        session.add(master)
        await session.flush()
        await _create_experience_version(
            session,
            master=master,
            payload=payload.version,
        )
        return _build_apply_navigation(
            target_view="experience_bank",
            target_id=str(master.id),
            category=payload.category,
        )

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
        return None

    if card_type == "skill_group":
        await _apply_skill_group_draft_card(
            session,
            user_id=user_id,
            data=data,
        )
        return None

    raise InvalidMessageError(f"Unsupported draft card type: {card_type}")


async def _apply_experience_bank_draft_card(
    session: AsyncSession,
    *,
    user_id: str,
    assistant_session: AIAssistantSession,
    message: AIAssistantMessage,
) -> Dict[str, str] | None:
    content = _normalize_apply_draft_content(message.content_json or {})
    if content.get("type") != "experience":
        raise InvalidMessageError("Experience bank sessions only support experience draft cards")
    data = content.get("data")
    if not isinstance(data, dict):
        raise InvalidMessageError("Draft card payload is invalid")

    master_id = _resolve_bound_experience_master_id(
        assistant_session,
        data,
        allow_unbound_target=True,
    )
    if not master_id:
        return await _apply_direct_draft_card(
            session,
            user_id=user_id,
            assistant_session=assistant_session,
            message=message,
        )

    master = await _get_user_master_experience(
        session,
        user_id=user_id,
        master_id=master_id,
    )
    requested_category = _read_draft_experience_category(data)
    if master.category != requested_category:
        raise InvalidMessageError("Draft category does not match the current experience context")
    latest_version = await _get_latest_experience_version(session, master=master)
    payload = _build_experience_version_payload(
        data,
        category=requested_category,
        latest_version=latest_version,
    )
    await _create_experience_version(
        session,
        master=master,
        payload=payload,
    )
    return _build_apply_navigation(
        target_view="experience_bank",
        target_id=str(master.id),
        category=master.category,
    )


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
        delete(AIAssistantImageBlob).where(AIAssistantImageBlob.session_id == assistant_session.id)
    )
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
    context_json = assistant_session.context_json or {}
    context_master_id = _read_context_string(context_json, "masterId")
    result = await session.execute(
        select(AIAssistantMessage).where(
            AIAssistantMessage.id == message_id,
            AIAssistantMessage.session_id == assistant_session.id,
        )
    )
    message = result.scalars().one_or_none()
    if not message:
        raise NotFoundError(f"Assistant message {message_id} not found")
    draft_summary = _summarize_draft_content(message.content_json)
    logger.info(
        "Assistant draft apply context: user_id=%s session_id=%s message_id=%s entry_source=%s mode=%s skip_apply=%s context_master_id=%s context_category=%s message_type=%s draft=%s",
        user_id,
        assistant_session.id,
        message.id,
        assistant_session.entry_source,
        getattr(assistant_session, "mode", None),
        skip_apply,
        context_master_id,
        context_json.get("category") if isinstance(context_json, dict) else None,
        message.message_type,
        draft_summary,
    )
    if message.message_type != "draft_card":
        raise InvalidMessageError("Only draft card messages can be marked as applied")
    if _is_message_applied(message):
        logger.info(
            "Assistant draft already applied: session_id=%s message_id=%s",
            assistant_session.id,
            message.id,
        )
        return message
    apply_navigation: Dict[str, str] | None = None
    if skip_apply:
        if assistant_session.entry_source == "direct":
            raise InvalidMessageError("Direct assistant sessions must apply content before marking as applied")
        if assistant_session.entry_source in {"experience_bank", "resume_editor"}:
            content = message.content_json or {}
            data = content.get("data")
            if content.get("type") == "experience" and isinstance(data, dict):
                _resolve_bound_experience_master_id(
                    assistant_session,
                    data,
                    allow_unbound_target=False,
                )
                apply_navigation = _build_existing_experience_navigation(
                    assistant_session,
                    data,
                    default_view=assistant_session.entry_source,
                    allow_unbound_target=False,
                )
    elif assistant_session.entry_source == "direct":
        logger.info(
            "Assistant draft apply branch: direct session_id=%s message_id=%s",
            assistant_session.id,
            message.id,
        )
        apply_navigation = await _apply_direct_draft_card(
            session,
            user_id=user_id,
            assistant_session=assistant_session,
            message=message,
        )
    elif assistant_session.entry_source == "experience_bank":
        logger.info(
            "Assistant draft apply branch: experience_bank session_id=%s message_id=%s context_master_id=%s",
            assistant_session.id,
            message.id,
            context_master_id,
        )
        apply_navigation = await _apply_experience_bank_draft_card(
            session,
            user_id=user_id,
            assistant_session=assistant_session,
            message=message,
        )
    elif assistant_session.entry_source == "resume_editor":
        logger.info(
            "Assistant draft apply branch: resume_editor session_id=%s message_id=%s context_master_id=%s",
            assistant_session.id,
            message.id,
            context_master_id,
        )
        content = message.content_json or {}
        data = content.get("data")
        if content.get("type") == "experience" and isinstance(data, dict):
            if context_master_id:
                _resolve_bound_experience_master_id(
                    assistant_session,
                    data,
                    allow_unbound_target=False,
                )
            apply_navigation = _build_existing_experience_navigation(
                assistant_session,
                data,
                default_view="resume_editor",
                allow_unbound_target=not bool(context_master_id),
            )

    previous_content = dict(message.content_json or {})
    next_content = dict(previous_content)
    next_content["applied_at"] = utc_now().astimezone(timezone.utc).isoformat()
    if apply_navigation:
        next_content["apply_navigation"] = apply_navigation
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
    display_message: str | None = None,
    user_attachments: list[dict] | None = None,
    user_selected_experiences: list[dict] | None = None,
    user_selected_resume: dict | None = None,
    user_skill_id: str | None = None,
    assistant_text: str,
    draft_card: dict | None,
    assistant_thinking: str | None = None,
    suggested_followups: list[dict] | None = None,
    title: str | None = None,
) -> list[AIAssistantMessage]:
    user_content_json = {"text": display_message if display_message is not None else user_message}
    if user_skill_id:
        user_content_json["skill_id"] = user_skill_id
    normalized_attachments = [
        preview
        for preview in (_sanitize_attachment_preview(attachment) for attachment in (user_attachments or []))
        if preview
    ]
    if normalized_attachments:
        user_content_json["attachment"] = normalized_attachments[0]
        if len(normalized_attachments) > 1:
            user_content_json["attachments"] = normalized_attachments
    normalized_selected_experiences = _normalize_selected_experiences(user_selected_experiences)
    if normalized_selected_experiences:
        user_content_json["selected_experiences"] = normalized_selected_experiences
    normalized_selected_resume = _normalize_selected_resume(user_selected_resume)
    if normalized_selected_resume:
        user_content_json["selected_resume"] = normalized_selected_resume

    normalized_assistant_thinking = (
        "\n".join(
            line.strip()
            for line in assistant_thinking.splitlines()
            if line.strip()
        )
        if isinstance(assistant_thinking, str)
        else ""
    )

    created_messages: list[AIAssistantMessage] = []
    created_messages.append(
        AIAssistantMessage(
            session_id=assistant_session.id,
            role="user",
            message_type="user_text",
            content_json=user_content_json,
        )
    )
    created_messages.append(
        AIAssistantMessage(
            session_id=assistant_session.id,
            role="assistant",
            message_type="assistant_text",
            content_json={
                "text": assistant_text,
                **({"thinking": normalized_assistant_thinking} if normalized_assistant_thinking else {}),
                **({"skill_id": user_skill_id} if user_skill_id else {}),
                **({"suggestedFollowups": suggested_followups} if suggested_followups else {}),
            },
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
