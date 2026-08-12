import asyncio
import unittest
from contextlib import asynccontextmanager

from app.domain.billing.payment_expiry_worker import PaymentExpiryWorker


class PaymentExpiryWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_schedules_an_immediate_expiry_pass(self) -> None:
        calls: list[object] = []
        ran = asyncio.Event()

        @asynccontextmanager
        async def session_factory():
            session = object()
            yield session

        async def expire_orders(session: object) -> int:
            calls.append(session)
            ran.set()
            return 1

        worker = PaymentExpiryWorker(
            session_factory=session_factory,
            expire_orders=expire_orders,
            interval_seconds=60,
        )
        await worker.start()
        await asyncio.wait_for(ran.wait(), timeout=1)
        await worker.stop()

        self.assertEqual(len(calls), 1)

    async def test_start_does_not_wait_for_the_initial_pass(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        @asynccontextmanager
        async def session_factory():
            yield object()

        async def expire_orders(session: object) -> int:
            entered.set()
            await release.wait()
            return 0

        worker = PaymentExpiryWorker(
            session_factory=session_factory,
            expire_orders=expire_orders,
            interval_seconds=60,
        )

        await asyncio.wait_for(worker.start(), timeout=0.1)
        await asyncio.wait_for(entered.wait(), timeout=1)
        release.set()
        await worker.stop()

    async def test_worker_recovers_from_a_failed_pass(self) -> None:
        calls = 0
        recovered = asyncio.Event()

        @asynccontextmanager
        async def session_factory():
            yield object()

        async def expire_orders(session: object) -> int:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("temporary database failure")
            recovered.set()
            return 0

        worker = PaymentExpiryWorker(
            session_factory=session_factory,
            expire_orders=expire_orders,
            interval_seconds=0.001,
        )
        with self.assertLogs(
            "app.domain.billing.payment_expiry_worker", level="ERROR"
        ):
            await worker.start()
            await asyncio.wait_for(recovered.wait(), timeout=1)
        await worker.stop()

        self.assertGreaterEqual(calls, 2)

    async def test_stop_cancels_an_in_flight_pass(self) -> None:
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        @asynccontextmanager
        async def session_factory():
            yield object()

        calls = 0

        async def expire_orders(session: object) -> int:
            nonlocal calls
            calls += 1
            if calls == 1:
                return 0
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
            return 0

        worker = PaymentExpiryWorker(
            session_factory=session_factory,
            expire_orders=expire_orders,
            interval_seconds=0.001,
        )
        await worker.start()
        await asyncio.wait_for(entered.wait(), timeout=1)
        await worker.stop()

        self.assertTrue(cancelled.is_set())


if __name__ == "__main__":
    unittest.main()
