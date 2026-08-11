from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import text

from ...config import load_settings
from ...database import AsyncSessionFactory


logger = logging.getLogger(__name__)

MAX_CONCURRENT_UNLIMITED_REQUESTS = 3
MAX_UNLIMITED_REQUESTS_PER_HOUR = 120
UNLIMITED_DAILY_ALERT_TOKENS = 2_000_000
MIN_LEASE_TTL_SECONDS = 15 * 60
LEASE_HISTORY_DAYS = 7


@dataclass
class UnlimitedRequestLease:
    id: uuid.UUID
    user_id: str
    entrypoint: str
    lease_ttl_seconds: int = MIN_LEASE_TTL_SECONDS
    _released: bool = field(default=False, init=False, repr=False)
    _heartbeat_task: asyncio.Task[None] | None = field(default=None, init=False, repr=False)

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None and not self._released:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _heartbeat_loop(self) -> None:
        interval_seconds = max(min(self.lease_ttl_seconds // 3, 60), 10)
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                await renew_unlimited_request(self.id, self.lease_ttl_seconds)
            except Exception:  # pragma: no cover - defensive cross-instance lease renewal
                logger.exception(
                    "Failed to renew unlimited AI request lease",
                    extra={"lease_id": str(self.id), "user_id": self.user_id},
                )

    async def release(self) -> None:
        """Release the slot without allowing cleanup failures to mask AI results."""
        if self._released:
            return
        heartbeat_task = self._heartbeat_task
        self._heartbeat_task = None
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task
        try:
            await release_unlimited_request(self.id)
        except Exception:  # pragma: no cover - defensive cleanup path
            logger.exception(
                "Failed to release unlimited AI request lease",
                extra={"lease_id": str(self.id), "user_id": self.user_id},
            )
            return
        self._released = True


def _limit_error(*, code: str, message: str, retry_after_seconds: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={
            "code": code,
            "message": message,
            "retry_after_seconds": max(int(retry_after_seconds), 1),
        },
        headers={"Retry-After": str(max(int(retry_after_seconds), 1))},
    )


async def acquire_unlimited_request(
    *,
    user_id: str,
    entrypoint: str,
) -> UnlimitedRequestLease:
    """Atomically enforce rolling-hour and cross-instance concurrency limits."""
    settings = load_settings()
    lease_ttl_seconds = max(
        int(settings.ai_timeout_seconds or 0) + 60,
        MIN_LEASE_TTL_SECONDS,
    )
    lease_id = uuid.uuid4()

    async with AsyncSessionFactory() as session:
        async with session.begin():
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:user_id, 0))"),
                {"user_id": user_id},
            )
            await session.execute(
                text(
                    """
                    UPDATE ai_unlimited_request_leases
                    SET released_at = expires_at
                    WHERE user_id = :user_id
                      AND released_at IS NULL
                      AND expires_at <= now()
                    """
                ),
                {"user_id": user_id},
            )
            await session.execute(
                text(
                    """
                    DELETE FROM ai_unlimited_request_leases
                    WHERE user_id = :user_id
                      AND acquired_at < now() - (:history_days * interval '1 day')
                    """
                ),
                {"user_id": user_id, "history_days": LEASE_HISTORY_DAYS},
            )
            counts_result = await session.execute(
                text(
                    """
                    SELECT
                        count(*) FILTER (
                            WHERE acquired_at >= now() - interval '1 hour'
                        ) AS hourly_count,
                        count(*) FILTER (
                            WHERE released_at IS NULL AND expires_at > now()
                        ) AS active_count,
                        min(acquired_at) FILTER (
                            WHERE acquired_at >= now() - interval '1 hour'
                        ) AS oldest_hourly_at
                    FROM ai_unlimited_request_leases
                    WHERE user_id = :user_id
                    """
                ),
                {"user_id": user_id},
            )
            counts = counts_result.mappings().one()
            hourly_count = int(counts.get("hourly_count") or 0)
            active_count = int(counts.get("active_count") or 0)

            if hourly_count >= MAX_UNLIMITED_REQUESTS_PER_HOUR:
                oldest = counts.get("oldest_hourly_at")
                retry_after = 60
                if isinstance(oldest, datetime):
                    if oldest.tzinfo is None:
                        oldest = oldest.replace(tzinfo=timezone.utc)
                    retry_after = max(
                        int((oldest + timedelta(hours=1) - datetime.now(timezone.utc)).total_seconds()),
                        1,
                    )
                raise _limit_error(
                    code="ai_unlimited_hourly_limit_reached",
                    message="不限量套餐每小时最多发起 120 次 AI 请求，请稍后再试。",
                    retry_after_seconds=retry_after,
                )

            if active_count >= MAX_CONCURRENT_UNLIMITED_REQUESTS:
                raise _limit_error(
                    code="ai_unlimited_concurrency_limited",
                    message="不限量套餐最多同时处理 3 个 AI 请求，请等待当前请求完成。",
                    retry_after_seconds=5,
                )

            await session.execute(
                text(
                    """
                    INSERT INTO ai_unlimited_request_leases (
                        id, user_id, entrypoint, acquired_at, expires_at
                    ) VALUES (
                        :lease_id,
                        :user_id,
                        :entrypoint,
                        now(),
                        now() + (:lease_ttl_seconds * interval '1 second')
                    )
                    """
                ),
                {
                    "lease_id": lease_id,
                    "user_id": user_id,
                    "entrypoint": entrypoint or "unknown",
                    "lease_ttl_seconds": lease_ttl_seconds,
                },
            )

    lease = UnlimitedRequestLease(
        id=lease_id,
        user_id=user_id,
        entrypoint=entrypoint or "unknown",
        lease_ttl_seconds=lease_ttl_seconds,
    )
    lease.start_heartbeat()
    return lease


async def renew_unlimited_request(lease_id: uuid.UUID, lease_ttl_seconds: int) -> None:
    async with AsyncSessionFactory() as session:
        await session.execute(
            text(
                """
                UPDATE ai_unlimited_request_leases
                SET expires_at = now() + (:lease_ttl_seconds * interval '1 second')
                WHERE id = :lease_id
                  AND released_at IS NULL
                """
            ),
            {
                "lease_id": lease_id,
                "lease_ttl_seconds": max(int(lease_ttl_seconds), MIN_LEASE_TTL_SECONDS),
            },
        )
        await session.commit()


async def release_unlimited_request(lease_id: uuid.UUID) -> None:
    async with AsyncSessionFactory() as session:
        await session.execute(
            text(
                """
                UPDATE ai_unlimited_request_leases
                SET released_at = COALESCE(released_at, now())
                WHERE id = :lease_id
                """
            ),
            {"lease_id": lease_id},
        )
        await session.commit()


async def _claim_daily_usage_alert(
    *,
    user_id: str,
    observed_at: datetime,
) -> tuple[int, str] | None:
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    observed_at = observed_at.astimezone(timezone.utc)
    day_start = datetime.combine(observed_at.date(), time.min, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    async with AsyncSessionFactory() as session:
        total_result = await session.execute(
            text(
                """
                SELECT COALESCE(sum(total_tokens), 0) AS total_tokens
                FROM ai_token_usage_events
                WHERE user_id = :user_id
                  AND created_at >= :day_start
                  AND created_at < :day_end
                  AND status = 'success'
                  AND metadata_json ->> 'billing_mode' = 'unlimited_time'
                """
            ),
            {
                "user_id": user_id,
                "day_start": day_start,
                "day_end": day_end,
            },
        )
        total_tokens = int(total_result.scalar_one() or 0)
        if total_tokens < UNLIMITED_DAILY_ALERT_TOKENS:
            return None

        claim_result = await session.execute(
            text(
                """
                INSERT INTO ai_unlimited_usage_alerts (
                    user_id,
                    usage_day,
                    threshold_tokens,
                    observed_tokens,
                    claimed_at
                ) VALUES (
                    :user_id,
                    :usage_day,
                    :threshold_tokens,
                    :observed_tokens,
                    now()
                )
                ON CONFLICT (user_id, usage_day, threshold_tokens) DO NOTHING
                RETURNING user_id
                """
            ),
            {
                "user_id": user_id,
                "usage_day": observed_at.date(),
                "threshold_tokens": UNLIMITED_DAILY_ALERT_TOKENS,
                "observed_tokens": total_tokens,
            },
        )
        claimed_user_id = claim_result.scalar_one_or_none()
        await session.commit()
        if not claimed_user_id:
            return None
        return total_tokens, observed_at.date().isoformat()


async def _mark_alert_delivery(
    *,
    user_id: str,
    usage_day: str,
    error: str | None,
) -> None:
    async with AsyncSessionFactory() as session:
        if error is None:
            statement = text(
                """
                UPDATE ai_unlimited_usage_alerts
                SET notified_at = now(),
                    delivery_error = NULL
                WHERE user_id = :user_id
                  AND usage_day = CAST(:usage_day AS date)
                  AND threshold_tokens = :threshold_tokens
                """
            )
            parameters = {
                "user_id": user_id,
                "usage_day": usage_day,
                "threshold_tokens": UNLIMITED_DAILY_ALERT_TOKENS,
            }
        else:
            statement = text(
                """
                UPDATE ai_unlimited_usage_alerts
                SET delivery_error = :error
                WHERE user_id = :user_id
                  AND usage_day = CAST(:usage_day AS date)
                  AND threshold_tokens = :threshold_tokens
                """
            )
            parameters = {
                "user_id": user_id,
                "usage_day": usage_day,
                "threshold_tokens": UNLIMITED_DAILY_ALERT_TOKENS,
                "error": error,
            }
        await session.execute(
            statement,
            parameters,
        )
        await session.commit()


async def _send_daily_usage_alert(
    *,
    user_id: str,
    usage_day: str,
    total_tokens: int,
    plan_name: str,
    expires_at: datetime | None,
) -> str | None:
    webhook_url = load_settings().feishu_webhook_url
    if not webhook_url:
        return "FEISHU_WEBHOOK_URL is not configured"

    expiry_text = expires_at.isoformat() if expires_at else "unknown"
    payload: dict[str, Any] = {
        "msg_type": "text",
        "content": {
            "text": "\n".join(
                [
                    "ResumeFLOW 不限量套餐异常用量提醒",
                    f"用户: {user_id}",
                    f"日期(UTC): {usage_day}",
                    f"累计 Token: {total_tokens}",
                    f"套餐: {plan_name or '未命名无限套餐'}",
                    f"到期: {expiry_text}",
                ]
            )
        },
    }
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(webhook_url, json=payload)
            response.raise_for_status()
            try:
                response_payload = response.json()
            except ValueError:
                response_payload = None
            if isinstance(response_payload, dict):
                result_code = response_payload.get("code", response_payload.get("StatusCode", 0))
                if result_code not in (0, "0", None):
                    return f"Feishu webhook rejected the alert with code {result_code}"[:500]
        return None
    except httpx.HTTPStatusError as exc:  # pragma: no cover - external notification path
        status_code = exc.response.status_code
        logger.warning("Unlimited usage alert delivery failed with HTTP %s", status_code)
        return f"HTTPStatusError: HTTP {status_code}"
    except Exception as exc:  # pragma: no cover - external notification path
        logger.warning("Unlimited usage alert delivery failed: %s", type(exc).__name__)
        return type(exc).__name__


async def maybe_send_daily_usage_alert(
    *,
    user_id: str,
    observed_at: datetime,
    plan_name: str,
    expires_at: datetime | None,
) -> None:
    """Claim and deliver the once-per-day alert without affecting AI responses."""
    try:
        claim = await _claim_daily_usage_alert(user_id=user_id, observed_at=observed_at)
        if claim is None:
            return
        total_tokens, usage_day = claim
        error = await _send_daily_usage_alert(
            user_id=user_id,
            usage_day=usage_day,
            total_tokens=total_tokens,
            plan_name=plan_name,
            expires_at=expires_at,
        )
        await _mark_alert_delivery(
            user_id=user_id,
            usage_day=usage_day,
            error=error,
        )
    except Exception:  # pragma: no cover - guard alert must stay non-blocking
        logger.exception("Failed to process unlimited usage alert", extra={"user_id": user_id})
