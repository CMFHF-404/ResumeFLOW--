"""Periodic cleanup for expired export snapshots and cached PDF bytes."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
import logging
from typing import Any

from ...database import AsyncSessionFactory
from .limits import EXPORT_SNAPSHOT_CLEANUP_INTERVAL_SECONDS
from .snapshot_service import cleanup_expired_snapshots


logger = logging.getLogger(__name__)
SessionFactory = Callable[[], Any]
CleanupSnapshots = Callable[[Any], Awaitable[None]]


class ExportSnapshotCleanupWorker:
    """Run export retention cleanup immediately and then at a bounded cadence."""

    def __init__(
        self,
        *,
        session_factory: SessionFactory = AsyncSessionFactory,
        cleanup_snapshots: CleanupSnapshots = cleanup_expired_snapshots,
        interval_seconds: float = EXPORT_SNAPSHOT_CLEANUP_INTERVAL_SECONDS,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be greater than zero")
        self._session_factory = session_factory
        self._cleanup_snapshots = cleanup_snapshots
        self._interval_seconds = interval_seconds
        self._task: asyncio.Task[None] | None = None

    async def run_once(self) -> None:
        async with self._session_factory() as session:
            await self._cleanup_snapshots(session)

    async def _run_safely(self) -> None:
        try:
            await self.run_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Failed to clean expired export snapshots")

    async def _run(self) -> None:
        while True:
            await self._run_safely()
            await asyncio.sleep(self._interval_seconds)

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(
                self._run(),
                name="export-snapshot-cleanup-worker",
            )

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
