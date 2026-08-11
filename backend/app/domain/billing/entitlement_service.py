from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ...models import AITokenPurchaseEvent, AITokenWallet
from ...utils.time_utils import utc_now_aware as utc_now
from . import billing_service


@dataclass(frozen=True)
class EntitlementGrant:
    option_id: str
    label: str
    benefit_type: str
    token_amount: int = 0
    unlimited_duration_days: int | None = None
    unlimited_duration_hours: int | None = None


@dataclass(frozen=True)
class EntitlementGrantResult:
    wallet: AITokenWallet
    purchase: AITokenPurchaseEvent
    created: bool


def _duration(grant: EntitlementGrant) -> timedelta:
    days = max(int(grant.unlimited_duration_days or 0), 0)
    hours = max(int(grant.unlimited_duration_hours or 0), 0)
    duration = timedelta(days=days, hours=hours)
    if duration <= timedelta(0):
        raise ValueError("unlimited entitlement duration must be positive")
    return duration


async def grant_entitlement(
    session: AsyncSession,
    *,
    user_id: str,
    grant: EntitlementGrant,
    source: str,
    source_id: str,
    status: str,
    metadata: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> EntitlementGrantResult:
    wallet = await billing_service._get_wallet(  # noqa: SLF001
        session,
        user_id,
        create=True,
        for_update=True,
    )
    assert wallet is not None
    existing_result = await session.execute(
        select(AITokenPurchaseEvent).where(
            AITokenPurchaseEvent.source == source,
            AITokenPurchaseEvent.source_id == source_id,
        )
    )
    existing = existing_result.scalars().first()
    if existing is not None:
        return EntitlementGrantResult(wallet=wallet, purchase=existing, created=False)

    granted_at = now or utc_now()
    before_remaining = max(int(wallet.remaining_tokens or 0), 0)
    before_limit = max(int(wallet.token_limit or 0), 0)
    token_amount = max(int(grant.token_amount or 0), 0)
    after_remaining = before_remaining
    after_limit = before_limit
    previous_expiry = wallet.unlimited_tokens_expires_at
    next_expiry = previous_expiry

    if grant.benefit_type == "tokens":
        if token_amount <= 0:
            raise ValueError("token entitlement amount must be positive")
        after_remaining += token_amount
        after_limit += token_amount
    elif grant.benefit_type == "unlimited_time":
        extension_base = (
            previous_expiry
            if billing_service._is_unlimited_active(wallet, granted_at)  # noqa: SLF001
            else granted_at
        )
        next_expiry = extension_base + _duration(grant)
    else:
        raise ValueError("unsupported entitlement benefit type")

    purchase_metadata = dict(metadata or {})
    purchase_metadata.update(
        {
            "benefit_type": grant.benefit_type,
            "unlimited_duration_days": grant.unlimited_duration_days,
            "unlimited_duration_hours": grant.unlimited_duration_hours,
            "previous_unlimited_expires_at": previous_expiry.isoformat() if previous_expiry else None,
            "next_unlimited_expires_at": next_expiry.isoformat() if next_expiry else None,
        }
    )
    purchase = AITokenPurchaseEvent(
        user_id=user_id,
        option_id=grant.option_id,
        label=grant.label,
        tokens=token_amount,
        status=status,
        before_remaining_tokens=before_remaining,
        after_remaining_tokens=after_remaining,
        before_token_limit=before_limit,
        after_token_limit=after_limit,
        source=source,
        source_id=source_id,
        metadata_json=purchase_metadata,
        created_at=granted_at,
    )
    session.add(purchase)

    wallet.token_limit = after_limit
    wallet.remaining_tokens = after_remaining
    last_purchase_at = billing_service._normalize_utc(wallet.last_purchase_at)  # noqa: SLF001
    normalized_granted_at = billing_service._normalize_utc(granted_at)  # noqa: SLF001
    is_latest_purchase = (
        last_purchase_at is None
        or normalized_granted_at is None
        or normalized_granted_at >= last_purchase_at
    )
    if grant.benefit_type == "unlimited_time":
        wallet.unlimited_tokens_expires_at = next_expiry
        if is_latest_purchase:
            wallet.unlimited_tokens_plan_name = grant.label
    if is_latest_purchase:
        wallet.last_purchase_id = purchase.id
        wallet.last_purchase_tokens = token_amount
        wallet.last_purchase_at = granted_at
    wallet.updated_at = utc_now()
    await billing_service._maybe_flush(session)  # noqa: SLF001
    return EntitlementGrantResult(wallet=wallet, purchase=purchase, created=True)
