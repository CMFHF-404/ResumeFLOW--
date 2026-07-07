from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import desc
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...database import AsyncSessionFactory
from ...models import AITokenPurchaseEvent, AITokenUsageEvent, AITokenWallet
from ...utils.time_utils import utc_now_aware as utc_now
from .schemas import (
    TokenPurchaseEventRead,
    TokenPurchaseOption,
    TokenPurchaseResponse,
    TokenQuotaSummary,
    TokenUsageAggregate,
    TokenUsageEventRead,
    TokenUsageListResponse,
)

UsageCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]


PURCHASE_OPTIONS: tuple[TokenPurchaseOption, ...] = (
    TokenPurchaseOption(
        id="tokens_100k",
        label="100k tokens",
        tokens=100_000,
        price_label="占位购买",
        description="适合少量 JD 分析与润色",
    ),
    TokenPurchaseOption(
        id="tokens_500k",
        label="500k tokens",
        tokens=500_000,
        price_label="占位购买",
        description="适合连续整理多份简历",
    ),
    TokenPurchaseOption(
        id="tokens_1m",
        label="1M tokens",
        tokens=1_000_000,
        price_label="占位购买",
        description="适合高频 AI 助理与 Agent API",
    ),
)

SIGNUP_BONUS_TOKENS = 200_000
SIGNUP_BONUS_SOURCE = "signup_bonus"
SIGNUP_BONUS_OPTION_ID = "signup_bonus_200k"
SIGNUP_BONUS_LABEL = "新用户注册赠送"
SIGNUP_BONUS_STATUS = "signup_bonus_granted"


@dataclass
class BillingContext:
    session: AsyncSession
    user_id: str
    entrypoint: str
    metadata: Dict[str, Any] = field(default_factory=dict)


_billing_context: ContextVar[BillingContext | None] = ContextVar(
    "ai_token_billing_context",
    default=None,
)


def get_purchase_options() -> list[TokenPurchaseOption]:
    return [option.model_copy() for option in PURCHASE_OPTIONS]


def _find_purchase_option(option_id: str) -> TokenPurchaseOption:
    for option in PURCHASE_OPTIONS:
        if option.id == option_id:
            return option
    raise HTTPException(
        status_code=400,
        detail={
            "code": "invalid_token_purchase_option",
            "message": "未知的额度套餐。",
        },
    )


def _remaining_percent(wallet: AITokenWallet) -> float:
    if wallet.token_limit <= 0:
        return 0.0
    return round(max(wallet.remaining_tokens, 0) / wallet.token_limit * 100, 2)


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _is_unlimited_active(wallet: AITokenWallet, now: datetime | None = None) -> bool:
    expires_at = _normalize_utc(wallet.unlimited_tokens_expires_at)
    if expires_at is None:
        return False
    current_time = _normalize_utc(now or utc_now())
    assert current_time is not None
    return expires_at > current_time


def _can_query_billing_tables(session: Any) -> bool:
    return callable(getattr(session, "execute", None))


def _unmetered_summary(user_id: str) -> TokenQuotaSummary:
    return TokenQuotaSummary(
        user_id=user_id,
        token_limit=0,
        remaining_tokens=0,
        used_tokens=0,
        remaining_percent=0,
    )


def _to_summary(wallet: AITokenWallet) -> TokenQuotaSummary:
    is_unlimited = _is_unlimited_active(wallet)
    return TokenQuotaSummary(
        user_id=wallet.user_id,
        token_limit=max(int(wallet.token_limit or 0), 0),
        remaining_tokens=max(int(wallet.remaining_tokens or 0), 0),
        used_tokens=max(int(wallet.used_tokens or 0), 0),
        remaining_percent=_remaining_percent(wallet),
        is_unlimited=is_unlimited,
        unlimited_expires_at=wallet.unlimited_tokens_expires_at if is_unlimited else None,
        unlimited_plan_name=(wallet.unlimited_tokens_plan_name or "") if is_unlimited else None,
        last_purchase_tokens=max(int(wallet.last_purchase_tokens or 0), 0),
        last_purchase_at=wallet.last_purchase_at,
        updated_at=wallet.updated_at,
    )


def _to_purchase_read(purchase: AITokenPurchaseEvent) -> TokenPurchaseEventRead:
    return TokenPurchaseEventRead(
        id=str(purchase.id),
        option_id=purchase.option_id,
        label=purchase.label,
        tokens=purchase.tokens,
        status=purchase.status,
        before_remaining_tokens=purchase.before_remaining_tokens,
        after_remaining_tokens=purchase.after_remaining_tokens,
        before_token_limit=purchase.before_token_limit,
        after_token_limit=purchase.after_token_limit,
        created_at=purchase.created_at,
    )


def _to_usage_read(event: AITokenUsageEvent) -> TokenUsageEventRead:
    return TokenUsageEventRead(
        id=str(event.id),
        entrypoint=event.entrypoint,
        request_label=event.request_label,
        provider=event.provider,
        model=event.model,
        status=event.status,
        prompt_tokens=event.prompt_tokens,
        completion_tokens=event.completion_tokens,
        total_tokens=event.total_tokens,
        metadata=event.metadata_json or {},
        created_at=event.created_at,
    )


async def _maybe_commit(session: AsyncSession) -> None:
    commit = getattr(session, "commit", None)
    if callable(commit):
        result = commit()
        if inspect.isawaitable(result):
            await result


async def _maybe_flush(session: AsyncSession) -> None:
    flush = getattr(session, "flush", None)
    if callable(flush):
        result = flush()
        if inspect.isawaitable(result):
            await result


async def _maybe_refresh(session: AsyncSession, value: Any) -> None:
    refresh = getattr(session, "refresh", None)
    if callable(refresh):
        result = refresh(value)
        if inspect.isawaitable(result):
            await result


async def _get_wallet(
    session: AsyncSession,
    user_id: str,
    *,
    create: bool = True,
    for_update: bool = False,
) -> AITokenWallet | None:
    statement = select(AITokenWallet).where(AITokenWallet.user_id == user_id)
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    wallet = result.scalars().first()
    if wallet is not None or not create:
        return wallet
    wallet = AITokenWallet(user_id=user_id)
    session.add(wallet)
    await _maybe_flush(session)
    return wallet


async def grant_signup_bonus(session: AsyncSession, user_id: str) -> TokenQuotaSummary:
    wallet = await _get_wallet(session, user_id, create=True, for_update=True)
    assert wallet is not None

    now = utc_now()
    before_remaining = max(int(wallet.remaining_tokens or 0), 0)
    before_limit = max(int(wallet.token_limit or 0), 0)
    after_remaining = before_remaining + SIGNUP_BONUS_TOKENS
    after_limit = before_limit + SIGNUP_BONUS_TOKENS

    purchase = AITokenPurchaseEvent(
        user_id=user_id,
        option_id=SIGNUP_BONUS_OPTION_ID,
        label=SIGNUP_BONUS_LABEL,
        tokens=SIGNUP_BONUS_TOKENS,
        status=SIGNUP_BONUS_STATUS,
        before_remaining_tokens=before_remaining,
        after_remaining_tokens=after_remaining,
        before_token_limit=before_limit,
        after_token_limit=after_limit,
        source=SIGNUP_BONUS_SOURCE,
        created_at=now,
    )
    session.add(purchase)

    wallet.token_limit = after_limit
    wallet.remaining_tokens = after_remaining
    wallet.last_purchase_id = purchase.id
    wallet.last_purchase_tokens = SIGNUP_BONUS_TOKENS
    wallet.last_purchase_at = now
    wallet.updated_at = now

    await _maybe_flush(session)
    return _to_summary(wallet)


async def get_summary(session: AsyncSession, user_id: str) -> TokenQuotaSummary:
    if not _can_query_billing_tables(session):
        return _unmetered_summary(user_id)
    wallet = await _get_wallet(session, user_id, create=True)
    assert wallet is not None
    return _to_summary(wallet)


async def ensure_quota_available(session: AsyncSession, user_id: str) -> TokenQuotaSummary:
    if not _can_query_billing_tables(session):
        return _unmetered_summary(user_id)
    wallet = await _get_wallet(session, user_id, create=True)
    assert wallet is not None
    if _is_unlimited_active(wallet):
        return _to_summary(wallet)
    if int(wallet.remaining_tokens or 0) <= 0:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "ai_token_quota_exhausted",
                "message": "AI token 额度已用完，请打开额度入口兑换卡密或联系管理员。",
            },
        )
    return _to_summary(wallet)


async def _create_placeholder_purchase_record(
    session: AsyncSession,
    user_id: str,
    option_id: str,
) -> tuple[TokenQuotaSummary, AITokenPurchaseEvent]:
    option = _find_purchase_option(option_id)
    wallet = await _get_wallet(session, user_id, create=True, for_update=True)
    assert wallet is not None

    now = utc_now()
    before_remaining = max(int(wallet.remaining_tokens or 0), 0)
    before_limit = max(int(wallet.token_limit or 0), 0)
    after_limit = before_remaining + option.tokens

    purchase = AITokenPurchaseEvent(
        user_id=user_id,
        option_id=option.id,
        label=option.label,
        tokens=option.tokens,
        status="placeholder_succeeded",
        before_remaining_tokens=before_remaining,
        after_remaining_tokens=after_limit,
        before_token_limit=before_limit,
        after_token_limit=after_limit,
        created_at=now,
    )
    session.add(purchase)

    wallet.token_limit = after_limit
    wallet.remaining_tokens = after_limit
    wallet.used_tokens = 0
    wallet.last_purchase_id = purchase.id
    wallet.last_purchase_tokens = option.tokens
    wallet.last_purchase_at = now
    wallet.updated_at = now

    await _maybe_commit(session)
    await _maybe_refresh(session, wallet)
    await _maybe_refresh(session, purchase)
    return _to_summary(wallet), purchase


async def create_placeholder_purchase(
    session: AsyncSession,
    user_id: str,
    option_id: str,
) -> TokenQuotaSummary:
    summary, _purchase = await _create_placeholder_purchase_record(session, user_id, option_id)
    return summary


async def create_placeholder_purchase_response(
    session: AsyncSession,
    user_id: str,
    option_id: str,
) -> TokenPurchaseResponse:
    summary, purchase = await _create_placeholder_purchase_record(session, user_id, option_id)
    return TokenPurchaseResponse(summary=summary, purchase=_to_purchase_read(purchase))


async def record_usage_event(
    session: AsyncSession,
    *,
    user_id: str,
    entrypoint: str,
    request_label: str,
    provider: str,
    model: str,
    status: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    metadata: Dict[str, Any] | None = None,
    commit: bool = False,
) -> TokenQuotaSummary:
    if not _can_query_billing_tables(session):
        return _unmetered_summary(user_id)
    wallet = await _get_wallet(session, user_id, create=True, for_update=True)
    assert wallet is not None
    prompt_tokens = max(int(prompt_tokens or 0), 0)
    completion_tokens = max(int(completion_tokens or 0), 0)
    total_tokens = max(int(total_tokens or prompt_tokens + completion_tokens or 0), 0)
    now = utc_now()
    is_unlimited = _is_unlimited_active(wallet, now)
    event_metadata = dict(metadata or {})
    if is_unlimited:
        event_metadata.setdefault("billing_mode", "unlimited_time")
        event_metadata.setdefault("unlimited_plan_name", wallet.unlimited_tokens_plan_name or "")
        if wallet.unlimited_tokens_expires_at:
            event_metadata.setdefault(
                "unlimited_expires_at",
                wallet.unlimited_tokens_expires_at.isoformat(),
            )

    event = AITokenUsageEvent(
        user_id=user_id,
        entrypoint=entrypoint or "unknown",
        request_label=request_label or "ai_request",
        provider=provider or "unknown",
        model=model or "",
        status=status or "success",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        metadata_json=event_metadata,
        created_at=now,
    )
    session.add(event)

    if event.status == "success" and total_tokens > 0 and not is_unlimited:
        wallet.remaining_tokens = max(int(wallet.remaining_tokens or 0) - total_tokens, 0)
        wallet.used_tokens = max(int(wallet.used_tokens or 0), 0) + total_tokens
        wallet.updated_at = now
    elif event.status != "success" or is_unlimited:
        wallet.updated_at = now

    await _maybe_flush(session)
    if commit:
        await _maybe_commit(session)
    await _maybe_refresh(session, wallet)
    return _to_summary(wallet)


def _aggregate_usage(events: Iterable[AITokenUsageEvent], key_factory) -> list[TokenUsageAggregate]:
    grouped: dict[str, dict[str, int]] = {}
    for event in events:
        key = str(key_factory(event) or "unknown")
        bucket = grouped.setdefault(
            key,
            {"total_tokens": 0, "prompt_tokens": 0, "completion_tokens": 0, "count": 0},
        )
        bucket["total_tokens"] += int(event.total_tokens or 0)
        bucket["prompt_tokens"] += int(event.prompt_tokens or 0)
        bucket["completion_tokens"] += int(event.completion_tokens or 0)
        bucket["count"] += 1
    return [
        TokenUsageAggregate(key=key, **values)
        for key, values in sorted(grouped.items(), key=lambda item: item[0])
    ]


async def list_usage_events(
    session: AsyncSession,
    user_id: str,
    *,
    limit: int = 50,
) -> TokenUsageListResponse:
    if not _can_query_billing_tables(session):
        return TokenUsageListResponse(events=[], usage_by_day=[], usage_by_entrypoint=[])
    bounded_limit = max(1, min(int(limit or 50), 200))
    result = await session.execute(
        select(AITokenUsageEvent)
        .where(AITokenUsageEvent.user_id == user_id)
        .order_by(desc(AITokenUsageEvent.created_at))
        .limit(bounded_limit)
    )
    events = list(result.scalars().all())
    return TokenUsageListResponse(
        events=[_to_usage_read(event) for event in events],
        usage_by_day=_aggregate_usage(events, lambda event: event.created_at.date().isoformat()),
        usage_by_entrypoint=_aggregate_usage(events, lambda event: event.entrypoint),
    )


@asynccontextmanager
async def ai_billing_context(
    session: AsyncSession,
    user_id: str,
    *,
    entrypoint: str,
    metadata: Dict[str, Any] | None = None,
):
    token = _billing_context.set(
        BillingContext(
            session=session,
            user_id=user_id,
            entrypoint=entrypoint,
            metadata=metadata or {},
        )
    )
    try:
        yield
    finally:
        _billing_context.reset(token)


def get_current_billing_context() -> BillingContext | None:
    return _billing_context.get()


async def ensure_current_quota() -> None:
    context = get_current_billing_context()
    if context is None:
        return
    await ensure_quota_available(context.session, context.user_id)


async def emit_usage_callback(
    usage_callback: UsageCallback,
    payload: Dict[str, Any],
) -> None:
    if not usage_callback:
        return
    result = usage_callback(payload)
    if inspect.isawaitable(result):
        await result


async def record_current_usage(payload: Dict[str, Any]) -> None:
    context = get_current_billing_context()
    if context is None:
        return
    if not _can_query_billing_tables(context.session):
        return
    metadata = {**context.metadata}
    payload_metadata = payload.get("metadata")
    if isinstance(payload_metadata, dict):
        metadata.update(payload_metadata)
    async with AsyncSessionFactory() as usage_session:
        await record_usage_event(
            usage_session,
            user_id=context.user_id,
            entrypoint=context.entrypoint,
            request_label=str(payload.get("request_label") or "ai_request"),
            provider=str(payload.get("provider") or "unknown"),
            model=str(payload.get("model") or ""),
            status=str(payload.get("status") or "success"),
            prompt_tokens=int(payload.get("prompt_tokens") or 0),
            completion_tokens=int(payload.get("completion_tokens") or 0),
            total_tokens=int(payload.get("total_tokens") or 0),
            metadata=metadata,
            commit=True,
        )
