from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import desc
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_404_NOT_FOUND, HTTP_409_CONFLICT

from ...models import AgentApiKey, AgentPluginConfig
from ...utils.time_utils import utc_now
from .schemas import (
    AgentApiKeyRead,
    AgentJobGenerateRequest,
    AgentPluginConfigRead,
    AgentPluginConfigUpdate,
    DEFAULT_AGENT_POLISH_LEVEL,
    DEFAULT_AGENT_TEMPLATE_ID,
)

API_KEY_PREFIX = "rfag_"
KEY_PREFIX_LENGTH = 12


@dataclass(frozen=True)
class CreatedAgentApiKey:
    plaintext_key: str
    read: AgentApiKeyRead


@dataclass(frozen=True)
class AgentAuthenticatedUser:
    id: str


@dataclass(frozen=True)
class AgentGenerateOptions:
    template_id: str
    polish_before_output: bool
    polish_level: str
    force_one_page: bool


def hash_agent_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def verify_agent_api_key_hash(key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_agent_api_key(key), key_hash)


def _new_plaintext_key() -> str:
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def _key_prefix(key: str) -> str:
    return key[:KEY_PREFIX_LENGTH]


def _to_api_key_read(record: AgentApiKey) -> AgentApiKeyRead:
    return AgentApiKeyRead(
        id=str(record.id),
        name=record.name,
        key_prefix=record.key_prefix,
        key=getattr(record, "key_plaintext", None) if record.revoked_at is None else None,
        created_at=record.created_at,
        last_used_at=record.last_used_at,
        revoked_at=record.revoked_at,
    )


async def _list_active_agent_api_keys(session: AsyncSession, user_id: str) -> List[AgentApiKey]:
    result = await session.execute(
        select(AgentApiKey)
        .where(
            AgentApiKey.user_id == user_id,
            AgentApiKey.revoked_at.is_(None),
        )
        .order_by(desc(AgentApiKey.created_at))
    )
    return list(result.scalars().all())


def _created_from_reusable_api_key(record: AgentApiKey) -> CreatedAgentApiKey:
    return CreatedAgentApiKey(
        plaintext_key=record.key_plaintext,
        read=_to_api_key_read(record),
    )


async def _recover_agent_api_key_conflict(
    session: AsyncSession,
    user_id: str,
) -> Optional[CreatedAgentApiKey]:
    active_records = await _list_active_agent_api_keys(session, user_id)
    reusable = next(
        (
            record
            for record in active_records
            if getattr(record, "key_plaintext", None)
        ),
        None,
    )
    if reusable is not None:
        return _created_from_reusable_api_key(reusable)
    if active_records:
        raise HTTPException(
            status_code=HTTP_409_CONFLICT,
            detail="Existing Agent API key cannot be displayed. Refresh it to create a replacement.",
        )
    return None


def _to_plugin_config_read(record: Optional[AgentPluginConfig]) -> AgentPluginConfigRead:
    if record is None:
        return AgentPluginConfigRead()
    return AgentPluginConfigRead(
        selected_template_id=record.selected_template_id or DEFAULT_AGENT_TEMPLATE_ID,
        polish_before_output=bool(record.polish_before_output),
        polish_level=record.polish_level or DEFAULT_AGENT_POLISH_LEVEL,
        force_one_page=bool(record.force_one_page),
    )


async def get_agent_plugin_config(
    session: AsyncSession,
    user_id: str,
) -> AgentPluginConfigRead:
    result = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.user_id == user_id)
    )
    return _to_plugin_config_read(result.scalars().first())


async def upsert_agent_plugin_config(
    session: AsyncSession,
    user_id: str,
    payload: AgentPluginConfigUpdate,
) -> AgentPluginConfigRead:
    result = await session.execute(
        select(AgentPluginConfig).where(AgentPluginConfig.user_id == user_id)
    )
    record = result.scalars().first()
    if record is None:
        record = AgentPluginConfig(user_id=user_id)
    record.selected_template_id = payload.selected_template_id.strip() or DEFAULT_AGENT_TEMPLATE_ID
    record.polish_before_output = payload.polish_before_output
    record.polish_level = payload.polish_level.strip() or DEFAULT_AGENT_POLISH_LEVEL
    record.force_one_page = payload.force_one_page
    record.updated_at = utc_now()
    session.add(record)
    await session.commit()
    return _to_plugin_config_read(record)


async def resolve_agent_generate_options(
    session: AsyncSession,
    user_id: str,
    payload: AgentJobGenerateRequest,
) -> AgentGenerateOptions:
    config = await get_agent_plugin_config(session, user_id)
    return AgentGenerateOptions(
        template_id=payload.template_id or config.selected_template_id,
        polish_before_output=(
            payload.polish_before_output
            if payload.polish_before_output is not None
            else config.polish_before_output
        ),
        polish_level=payload.polish_level or config.polish_level,
        force_one_page=True,
    )


async def create_agent_api_key(
    session: AsyncSession,
    user_id: str,
    name: str,
    rotate: bool = False,
) -> CreatedAgentApiKey:
    active_records = await _list_active_agent_api_keys(session, user_id)
    if not rotate:
        reusable = next(
            (
                record
                for record in active_records
                if getattr(record, "key_plaintext", None)
            ),
            None,
        )
        if reusable is not None:
            return _created_from_reusable_api_key(reusable)
        if active_records:
            raise HTTPException(
                status_code=HTTP_409_CONFLICT,
                detail="Existing Agent API key cannot be displayed. Refresh it to create a replacement.",
            )

    plaintext_key = _new_plaintext_key()
    for record in active_records:
        record.revoked_at = utc_now()
        record.key_plaintext = None
        session.add(record)
    if active_records:
        await session.flush()
    record = AgentApiKey(
        user_id=user_id,
        name=name.strip() or "Agent",
        key_prefix=_key_prefix(plaintext_key),
        key_hash=hash_agent_api_key(plaintext_key),
        key_plaintext=plaintext_key,
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        recovered = await _recover_agent_api_key_conflict(session, user_id)
        if recovered is not None:
            return recovered
        raise HTTPException(
            status_code=HTTP_409_CONFLICT,
            detail="Agent API key was updated concurrently. Please retry.",
        ) from exc
    await session.refresh(record)
    return CreatedAgentApiKey(
        plaintext_key=plaintext_key,
        read=_to_api_key_read(record),
    )


async def list_agent_api_keys(session: AsyncSession, user_id: str) -> List[AgentApiKeyRead]:
    result = await session.execute(
        select(AgentApiKey)
        .where(AgentApiKey.user_id == user_id)
        .order_by(desc(AgentApiKey.created_at))
    )
    return [_to_api_key_read(record) for record in result.scalars().all()]


async def revoke_agent_api_key(
    session: AsyncSession,
    user_id: str,
    api_key_id: str,
) -> AgentApiKey:
    result = await session.execute(
        select(AgentApiKey).where(
            AgentApiKey.id == api_key_id,
            AgentApiKey.user_id == user_id,
        )
    )
    record = result.scalars().first()
    if not record:
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Agent API key not found")
    if record.revoked_at is None:
        record.revoked_at = utc_now()
        record.key_plaintext = None
        session.add(record)
        await session.commit()
        await session.refresh(record)
    return record


async def authenticate_agent_api_key(
    session: AsyncSession,
    key: str,
) -> AgentAuthenticatedUser:
    if not key or not key.startswith(API_KEY_PREFIX):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    result = await session.execute(
        select(AgentApiKey).where(AgentApiKey.key_prefix == _key_prefix(key))
    )
    record = result.scalars().first()
    if not record or record.revoked_at is not None:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    if not verify_agent_api_key_hash(key, record.key_hash):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid Agent API key")
    record.last_used_at = utc_now()
    session.add(record)
    await session.commit()
    return AgentAuthenticatedUser(id=record.user_id)
