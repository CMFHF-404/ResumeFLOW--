from __future__ import annotations

import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from app.domain.export.snapshot_cleanup_worker import ExportSnapshotCleanupWorker


class _SessionContext:
    def __init__(self, session) -> None:
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class ExportSnapshotCleanupWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_uses_an_isolated_session(self) -> None:
        session = SimpleNamespace(name="export-cleanup")
        cleanup = AsyncMock()
        worker = ExportSnapshotCleanupWorker(
            session_factory=lambda: _SessionContext(session),
            cleanup_snapshots=cleanup,
        )

        await worker.run_once()

        cleanup.assert_awaited_once_with(session)

    async def test_start_runs_immediately_and_stop_cancels_and_awaits(self) -> None:
        first_pass = asyncio.Event()

        async def cleanup(_session) -> None:
            first_pass.set()

        worker = ExportSnapshotCleanupWorker(
            session_factory=lambda: _SessionContext(object()),
            cleanup_snapshots=cleanup,
            interval_seconds=3600,
        )

        await worker.start()
        await asyncio.wait_for(first_pass.wait(), timeout=1)
        task = worker._task
        await worker.stop()

        self.assertIsNone(worker._task)
        self.assertIsNotNone(task)
        self.assertTrue(task.done())

    async def test_failure_is_isolated_and_next_pass_still_runs(self) -> None:
        calls = 0
        second_pass = asyncio.Event()

        async def cleanup(_session) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("transient database failure")
            second_pass.set()

        worker = ExportSnapshotCleanupWorker(
            session_factory=lambda: _SessionContext(object()),
            cleanup_snapshots=cleanup,
            interval_seconds=0.001,
        )

        await worker.start()
        await asyncio.wait_for(second_pass.wait(), timeout=1)
        await worker.stop()

        self.assertGreaterEqual(calls, 2)

    async def test_cancellation_during_cleanup_is_not_swallowed(self) -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def cleanup(_session) -> None:
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        worker = ExportSnapshotCleanupWorker(
            session_factory=lambda: _SessionContext(object()),
            cleanup_snapshots=cleanup,
            interval_seconds=3600,
        )

        await worker.start()
        await asyncio.wait_for(started.wait(), timeout=1)
        await worker.stop()

        self.assertTrue(cancelled.is_set())

    def test_non_positive_interval_is_rejected(self) -> None:
        for interval in (0, -1):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                ExportSnapshotCleanupWorker(interval_seconds=interval)


if __name__ == "__main__":
    unittest.main()
