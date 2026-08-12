"""Background maintenance for payment orders which were never paid."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

from ...database import AsyncSessionFactory
from .payment_service import expire_pending_orders


logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Any]
ExpirePendingOrders = Callable[[Any], Awaitable[int]]


class PaymentExpiryWorker:
    """Periodically expire pending orders using an isolated database session."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory = AsyncSessionFactory,
        expire_orders: ExpirePendingOrders = expire_pending_orders,
        interval_seconds: float = 60,
    ) -> None:
        self._session_factory = session_factory
        self._expire_orders = expire_orders
        self._interval_seconds = interval_seconds
        self._task: asyncio.Task[None] | None = None

    async def run_once(self) -> int:
        """Expire all due orders once, using a fresh session for this pass."""
        async with self._session_factory() as session:
            return await self._expire_orders(session)

    async def _run_safely(self) -> None:
        try:
            await self.run_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Failed to expire pending payment orders")

    async def _run(self) -> None:
        while True:
            await self._run_safely()
            await asyncio.sleep(self._interval_seconds)

    async def start(self) -> None:
        """Schedule an immediate pass without delaying application readiness."""
        if self._task is None:
            self._task = asyncio.create_task(
                self._run(),
                name="payment-order-expiry-worker",
            )

    async def stop(self) -> None:
        """Cancel and await the worker without leaking its cancellation."""
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
