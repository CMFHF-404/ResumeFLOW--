from __future__ import annotations

from typing import Any, Dict, List
import uuid

from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import ExperienceCategory, ExperienceDraft, MasterExperience
from ...utils.time_utils import utc_now
from .draft_schemas import ExperienceDraftRead, ExperienceDraftUpsert
from .experience_service import NotFoundError


def normalize_draft_payload(payload: ExperienceDraftUpsert) -> Dict[str, Any]:
    return {
        "category": payload.category.value if isinstance(payload.category, ExperienceCategory) else payload.category,
        "client_draft_key": payload.client_draft_key.strip(),
        "mode": payload.mode,
        "simple_text": payload.simple_text or "",
        "card_data": payload.card_data or {},
        "target_master_id": payload.target_master_id or None,
    }


def _parse_optional_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    return uuid.UUID(value)


async def _find_experience_draft(
    session: AsyncSession,
    user_id: str,
    category: ExperienceCategory,
    client_draft_key: str,
) -> ExperienceDraft | None:
    result = await session.execute(
        select(ExperienceDraft).where(
            ExperienceDraft.user_id == user_id,
            ExperienceDraft.category == category,
            ExperienceDraft.client_draft_key == client_draft_key,
        )
    )
    return result.scalars().first()


def _apply_draft_payload(
    draft: ExperienceDraft,
    normalized: Dict[str, Any],
    target_master_id: uuid.UUID | None,
) -> None:
    draft.mode = normalized["mode"]
    draft.simple_text = normalized["simple_text"]
    draft.card_data = normalized["card_data"]
    draft.target_master_id = target_master_id
    draft.updated_at = utc_now()


async def resolve_target_master_id_for_user(
    session: AsyncSession,
    user_id: str,
    value: str | None,
) -> uuid.UUID | None:
    try:
        target_id = _parse_optional_uuid(value)
    except ValueError as exc:
        raise NotFoundError("Target experience not found") from exc
    if target_id is None:
        return None
    result = await session.execute(
        select(MasterExperience.id).where(
            MasterExperience.id == target_id,
            MasterExperience.user_id == user_id,
        )
    )
    if not result.scalars().first():
        raise NotFoundError("Target experience not found")
    return target_id


def draft_to_read(draft: ExperienceDraft) -> ExperienceDraftRead:
    return ExperienceDraftRead(
        id=str(draft.id),
        category=draft.category,
        client_draft_key=draft.client_draft_key,
        mode="expert" if draft.mode == "expert" else "simple",
        simple_text=draft.simple_text or "",
        card_data=draft.card_data or {},
        target_master_id=str(draft.target_master_id) if draft.target_master_id else None,
        updated_at=draft.updated_at,
    )


async def list_experience_drafts(
    session: AsyncSession,
    user_id: str,
    category: ExperienceCategory,
) -> List[ExperienceDraft]:
    result = await session.execute(
        select(ExperienceDraft)
        .where(
            ExperienceDraft.user_id == user_id,
            ExperienceDraft.category == category,
        )
        .order_by(desc(ExperienceDraft.updated_at))
    )
    return list(result.scalars().all())


async def upsert_experience_draft(
    session: AsyncSession,
    user_id: str,
    payload: ExperienceDraftUpsert,
) -> ExperienceDraft:
    normalized = normalize_draft_payload(payload)
    target_master_id = await resolve_target_master_id_for_user(
        session,
        user_id,
        normalized["target_master_id"],
    )
    draft = await _find_experience_draft(
        session,
        user_id,
        payload.category,
        normalized["client_draft_key"],
    )
    now = utc_now()
    if draft is None:
        draft = ExperienceDraft(
            user_id=user_id,
            category=payload.category,
            client_draft_key=normalized["client_draft_key"],
            mode=normalized["mode"],
            simple_text=normalized["simple_text"],
            card_data=normalized["card_data"],
            target_master_id=target_master_id,
            created_at=now,
            updated_at=now,
        )
    else:
        _apply_draft_payload(draft, normalized, target_master_id)

    session.add(draft)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        draft = await _find_experience_draft(
            session,
            user_id,
            payload.category,
            normalized["client_draft_key"],
        )
        if draft is None:
            raise
        _apply_draft_payload(draft, normalized, target_master_id)
        session.add(draft)
        await session.commit()
    await session.refresh(draft)
    return draft


async def delete_experience_draft(
    session: AsyncSession,
    user_id: str,
    draft_id: str,
) -> ExperienceDraft:
    result = await session.execute(
        select(ExperienceDraft).where(
            ExperienceDraft.id == uuid.UUID(draft_id),
            ExperienceDraft.user_id == user_id,
        )
    )
    draft = result.scalars().first()
    if not draft:
        raise NotFoundError("Experience draft not found")
    await session.delete(draft)
    await session.commit()
    return draft
