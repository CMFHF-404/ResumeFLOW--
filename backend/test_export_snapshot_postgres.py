"""Opt-in two-session PostgreSQL coverage for export render claims.

Run only with both ``RUN_EXPORT_SNAPSHOT_POSTGRES_TESTS=1`` and an isolated
``EXPORT_SNAPSHOT_TEST_DATABASE_URL``. The test never falls back to DATABASE_URL.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import os
import unittest
import uuid
from unittest.mock import AsyncMock, patch

import asyncpg
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.domain.export import export_router, snapshot_service
from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot
from app.domain.export.snapshot_service import (
    SnapshotClaimedError,
    SnapshotCapacityExceededError,
    SnapshotConsumedError,
    build_render_snapshot_token,
    claim_render_snapshot_by_owner,
    claim_render_snapshot_by_token,
    cleanup_expired_snapshots,
    create_render_snapshot,
    delete_temporary_render_snapshot,
    finalize_render_snapshot_claim,
    get_render_snapshot_by_token,
    renew_render_snapshot_claim,
    release_render_snapshot_claim,
)
from app.domain.export.snapshot_cleanup_worker import ExportSnapshotCleanupWorker
from app.models import ExportRenderSnapshot


RUN_ENV = "RUN_EXPORT_SNAPSHOT_POSTGRES_TESTS"
DATABASE_URL_ENV = "EXPORT_SNAPSHOT_TEST_DATABASE_URL"


def _normalize_async_url(value: str) -> str:
    if value.startswith("postgresql+asyncpg://"):
        return value
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    if value.startswith("postgres://"):
        return value.replace("postgres://", "postgresql+asyncpg://", 1)
    raise AssertionError(f"{DATABASE_URL_ENV} must use PostgreSQL")


def _normalize_asyncpg_url(value: str) -> str:
    return _normalize_async_url(value).replace(
        "postgresql+asyncpg://", "postgresql://", 1
    )


def _snapshot() -> ResumePdfRenderSnapshot:
    return ResumePdfRenderSnapshot(
        resumeName="postgres-claim",
        profile=ResumeEditorProfileSnapshot(),
        lineHeight=1.4,
        fontSize=13,
        listSpacingValue="0.3em",
        bulletSpacingValue="0.15em",
        topPaddingPx=42,
        sectionSpacingClass="mb-3",
        listSpacingClass="space-y-2",
    )


@unittest.skipUnless(
    os.environ.get(RUN_ENV) == "1" and os.environ.get(DATABASE_URL_ENV),
    f"requires {RUN_ENV}=1 and isolated {DATABASE_URL_ENV}",
)
class ExportSnapshotPostgresClaimTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.database_url = _normalize_async_url(os.environ[DATABASE_URL_ENV])
        self.schema_name = f"rf_export_claim_{uuid.uuid4().hex}"
        connection = await asyncpg.connect(_normalize_asyncpg_url(self.database_url))
        try:
            await connection.execute(f'CREATE SCHEMA "{self.schema_name}"')
            await connection.execute(
                f'''
                CREATE TABLE "{self.schema_name}".export_render_snapshots (
                    id UUID PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    payload_json JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    consumed_at TIMESTAMPTZ,
                    render_claim_id UUID,
                    render_claim_expires_at TIMESTAMPTZ,
                    rendered_pdf BYTEA,
                    rendered_pdf_expires_at TIMESTAMPTZ
                )
                '''
            )
        finally:
            await connection.close()

        self.engine = create_async_engine(
            self.database_url,
            connect_args={
                "statement_cache_size": 0,
                "server_settings": {"search_path": self.schema_name},
            },
            pool_size=1,
            max_overflow=0,
            pool_timeout=2,
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.concurrent_engine = create_async_engine(
            self.database_url,
            connect_args={
                "statement_cache_size": 0,
                "server_settings": {"search_path": self.schema_name},
            },
            pool_size=2,
            max_overflow=0,
            pool_timeout=2,
        )
        self.concurrent_sessions = async_sessionmaker(
            self.concurrent_engine,
            expire_on_commit=False,
        )

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()
        await self.concurrent_engine.dispose()
        connection = await asyncpg.connect(_normalize_asyncpg_url(self.database_url))
        try:
            await connection.execute(
                f'DROP SCHEMA IF EXISTS "{self.schema_name}" CASCADE'
            )
        finally:
            await connection.close()

    async def _insert_snapshot(
        self,
        *,
        ttl_seconds: int = 5 * 60,
    ) -> ExportRenderSnapshot:
        record = ExportRenderSnapshot(
            user_id="user-1",
            payload_json=_snapshot().model_dump(mode="json"),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds),
        )
        async with self.sessions() as session:
            session.add(record)
            await session.commit()
        return record

    async def _run_two_concurrent_creates(self):
        release_competitors = asyncio.Event()
        readiness_lock = asyncio.Lock()
        ready_count = 0
        backend_pids: list[int] = []

        async def create_after_barrier():
            nonlocal ready_count
            async with self.concurrent_sessions() as session:
                backend_pid = (
                    await session.execute(text("SELECT pg_backend_pid()"))
                ).scalar_one()
                async with readiness_lock:
                    backend_pids.append(backend_pid)
                    ready_count += 1
                    if ready_count == 2:
                        release_competitors.set()
                await release_competitors.wait()
                try:
                    reference, _ = await create_render_snapshot(
                        session,
                        "user-1",
                        _snapshot(),
                    )
                except SnapshotCapacityExceededError:
                    return None
                return reference

        results = await asyncio.wait_for(
            asyncio.gather(create_after_barrier(), create_after_barrier()),
            timeout=5,
        )
        self.assertEqual(len(set(backend_pids)), 2)
        return results

    async def _delete_reference(self, reference) -> None:
        async with self.sessions() as session:
            self.assertTrue(
                await delete_temporary_render_snapshot(
                    session,
                    str(reference.id),
                    reference.user_id,
                )
            )

    async def test_direct_render_releases_pool_connection_and_deletes_temporary_snapshot(self) -> None:
        rendered_snapshot_id: uuid.UUID | None = None

        async with self.sessions() as outer_session:
            async def renderer(snapshot_id: str, token: str) -> bytes:
                nonlocal rendered_snapshot_id
                self.assertFalse(
                    outer_session.in_transaction(),
                    "create must return its only pooled connection before rendering",
                )
                rendered_snapshot_id = uuid.UUID(snapshot_id)
                async with self.sessions() as inner_session:
                    detached_state, parsed = await get_render_snapshot_by_token(
                        inner_session,
                        snapshot_id,
                        token,
                        ResumePdfRenderSnapshot,
                    )
                    self.assertEqual(parsed.resumeName, "postgres-claim")
                self.assertEqual(detached_state.id, rendered_snapshot_id)
                self.assertEqual(detached_state.user_id, "user-1")
                return b"%PDF-pool-size-one"

            response = await export_router._render_snapshot_pdf_response(
                outer_session,
                "user-1",
                _snapshot(),
                renderer,
                "pool-size-one.pdf",
            )
            self.assertEqual(response.body, b"%PDF-pool-size-one")
            self.assertFalse(outer_session.in_transaction())

        self.assertIsNotNone(rendered_snapshot_id)
        async with self.sessions() as verify:
            persisted = await verify.get(
                ExportRenderSnapshot,
                rendered_snapshot_id,
            )
            self.assertIsNone(persisted)

    async def test_two_connections_compete_for_one_claim_atomically(self) -> None:
        record = await self._insert_snapshot()
        release_competitors = asyncio.Event()
        readiness_lock = asyncio.Lock()
        ready_count = 0
        backend_pids: list[int] = []

        async def compete():
            nonlocal ready_count
            async with self.concurrent_sessions() as session:
                backend_pid = (
                    await session.execute(text("SELECT pg_backend_pid()"))
                ).scalar_one()
                async with readiness_lock:
                    backend_pids.append(backend_pid)
                    ready_count += 1
                    if ready_count == 2:
                        release_competitors.set()
                await release_competitors.wait()
                try:
                    claim, _, claim_id = await claim_render_snapshot_by_owner(
                        session,
                        str(record.id),
                        "user-1",
                        ResumePdfRenderSnapshot,
                    )
                except SnapshotClaimedError:
                    return None
                return claim, claim_id

        results = await asyncio.wait_for(
            asyncio.gather(compete(), compete()),
            timeout=5,
        )
        winners = [result for result in results if result is not None]
        self.assertEqual(len(set(backend_pids)), 2)
        self.assertEqual(len(winners), 1)

        winning_claim, winning_claim_id = winners[0]
        async with self.sessions() as release_session:
            self.assertTrue(
                await release_render_snapshot_claim(
                    release_session,
                    str(winning_claim.id),
                    winning_claim_id,
                )
            )

    async def test_concurrent_snapshot_count_budget_is_atomic(self) -> None:
        with patch.object(
            snapshot_service,
            "MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER",
            1,
        ):
            results = await self._run_two_concurrent_creates()

        winners = [result for result in results if result is not None]
        self.assertEqual(len(winners), 1)
        await self._delete_reference(winners[0])

        async with self.sessions() as verify:
            remaining = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM export_render_snapshots "
                        "WHERE user_id = 'user-1'"
                    )
                )
            ).scalar_one()
        self.assertEqual(remaining, 0)

    async def test_concurrent_snapshot_payload_budget_is_atomic(self) -> None:
        async with self.sessions() as probe_session:
            probe, _ = await create_render_snapshot(
                probe_session,
                "user-1",
                _snapshot(),
            )
        async with self.sessions() as measure_session:
            single_payload_bytes = (
                await measure_session.execute(
                    text(
                        "SELECT octet_length(payload_json::text) "
                        "FROM export_render_snapshots WHERE id = :snapshot_id"
                    ),
                    {"snapshot_id": probe.id},
                )
            ).scalar_one()
        await self._delete_reference(probe)

        with (
            patch.object(
                snapshot_service,
                "MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER",
                20,
            ),
            patch.object(
                snapshot_service,
                "MAX_EXPORT_SNAPSHOT_PAYLOAD_BYTES_PER_USER",
                (single_payload_bytes * 2) - 1,
            ),
        ):
            results = await self._run_two_concurrent_creates()

        winners = [result for result in results if result is not None]
        self.assertEqual(len(winners), 1)
        await self._delete_reference(winners[0])

    async def test_concurrent_claim_budget_and_error_priority_are_atomic(self) -> None:
        first_record = await self._insert_snapshot()
        second_record = await self._insert_snapshot()
        release_competitors = asyncio.Event()
        readiness_lock = asyncio.Lock()
        ready_count = 0
        backend_pids: list[int] = []

        async def compete(record: ExportRenderSnapshot):
            nonlocal ready_count
            async with self.concurrent_sessions() as session:
                backend_pid = (
                    await session.execute(text("SELECT pg_backend_pid()"))
                ).scalar_one()
                async with readiness_lock:
                    backend_pids.append(backend_pid)
                    ready_count += 1
                    if ready_count == 2:
                        release_competitors.set()
                await release_competitors.wait()
                try:
                    return await claim_render_snapshot_by_owner(
                        session,
                        str(record.id),
                        "user-1",
                        ResumePdfRenderSnapshot,
                    )
                except SnapshotCapacityExceededError:
                    return None

        with patch.object(
            snapshot_service,
            "MAX_ACTIVE_EXPORT_RENDER_CLAIMS_PER_USER",
            1,
        ):
            results = await asyncio.wait_for(
                asyncio.gather(compete(first_record), compete(second_record)),
                timeout=5,
            )
            self.assertEqual(len(set(backend_pids)), 2)
            winners = [result for result in results if result is not None]
            self.assertEqual(len(winners), 1)
            winning_claim, _, winning_claim_id = winners[0]
            losing_record = (
                second_record
                if winning_claim.id == first_record.id
                else first_record
            )

            async with self.sessions() as priority_session:
                with self.assertRaises(SnapshotClaimedError):
                    await claim_render_snapshot_by_owner(
                        priority_session,
                        str(winning_claim.id),
                        "user-1",
                        ResumePdfRenderSnapshot,
                    )
                with self.assertRaises(SnapshotCapacityExceededError):
                    await claim_render_snapshot_by_owner(
                        priority_session,
                        str(losing_record.id),
                        "user-1",
                        ResumePdfRenderSnapshot,
                    )

        async with self.sessions() as release_session:
            self.assertTrue(
                await release_render_snapshot_claim(
                    release_session,
                    str(winning_claim.id),
                    winning_claim_id,
                )
            )

    async def test_concurrent_finalize_pdf_budget_is_atomic(self) -> None:
        first_record = await self._insert_snapshot()
        second_record = await self._insert_snapshot()
        claims: list[tuple[ExportRenderSnapshot, uuid.UUID]] = []
        for record in (first_record, second_record):
            async with self.sessions() as claim_session:
                claim, _, claim_id = await claim_render_snapshot_by_owner(
                    claim_session,
                    str(record.id),
                    "user-1",
                    ResumePdfRenderSnapshot,
                )
                claims.append((claim, claim_id))

        async with self.sessions() as measure_session:
            payload_bytes = (
                await measure_session.execute(
                    text(
                        "SELECT sum(octet_length(payload_json::text)) "
                        "FROM export_render_snapshots WHERE user_id = 'user-1'"
                    )
                )
            ).scalar_one()

        pdf_bytes = b"%PDF-concurrent-budget"
        release_competitors = asyncio.Event()
        readiness_lock = asyncio.Lock()
        ready_count = 0
        backend_pids: list[int] = []

        async def finalize_after_barrier(claim, claim_id):
            nonlocal ready_count
            async with self.concurrent_sessions() as session:
                backend_pid = (
                    await session.execute(text("SELECT pg_backend_pid()"))
                ).scalar_one()
                async with readiness_lock:
                    backend_pids.append(backend_pid)
                    ready_count += 1
                    if ready_count == 2:
                        release_competitors.set()
                await release_competitors.wait()
                try:
                    await finalize_render_snapshot_claim(
                        session,
                        str(claim.id),
                        claim_id,
                        pdf_bytes,
                    )
                except SnapshotCapacityExceededError:
                    return False
                return True

        with patch.object(
            snapshot_service,
            "MAX_EXPORT_PERSISTED_BYTES_PER_USER",
            payload_bytes + len(pdf_bytes),
        ):
            results = await asyncio.wait_for(
                asyncio.gather(
                    *(finalize_after_barrier(claim, claim_id) for claim, claim_id in claims)
                ),
                timeout=5,
            )

        self.assertEqual(len(set(backend_pids)), 2)
        self.assertEqual(results.count(True), 1)
        self.assertEqual(results.count(False), 1)
        async with self.sessions() as verify:
            rows = (
                await verify.execute(
                    text(
                        "SELECT id, rendered_pdf, render_claim_id "
                        "FROM export_render_snapshots ORDER BY id"
                    )
                )
            ).all()
        self.assertEqual(sum(row.rendered_pdf is not None for row in rows), 1)
        loser_row = next(row for row in rows if row.rendered_pdf is None)
        loser_claim_id = next(
            claim_id for claim, claim_id in claims if claim.id == loser_row.id
        )
        async with self.sessions() as release_session:
            self.assertTrue(
                await release_render_snapshot_claim(
                    release_session,
                    str(loser_row.id),
                    loser_claim_id,
                )
            )

    async def test_many_direct_exports_leave_no_temporary_rows(self) -> None:
        renderer = AsyncMock(return_value=b"%PDF-direct-loop")
        with patch.object(export_router, "AsyncSessionFactory", new=self.sessions):
            async with self.sessions() as session:
                for index in range(25):
                    response = await export_router._render_snapshot_pdf_response(
                        session,
                        "user-1",
                        _snapshot(),
                        renderer,
                        f"direct-{index}.pdf",
                    )
                    self.assertEqual(response.body, b"%PDF-direct-loop")
                    self.assertFalse(session.in_transaction())

        async with self.sessions() as verify:
            remaining = (
                await verify.execute(
                    text("SELECT count(*) FROM export_render_snapshots")
                )
            ).scalar_one()
        self.assertEqual(remaining, 0)
        self.assertEqual(renderer.await_count, 25)

    async def test_owner_download_returns_gone_for_expired_snapshot(self) -> None:
        record = await self._insert_snapshot(ttl_seconds=-1)
        renderer = AsyncMock(return_value=b"%PDF-should-not-render")

        with (
            patch.object(export_router, "AsyncSessionFactory", new=self.sessions),
            self.assertRaises(HTTPException) as context,
        ):
            await export_router.render_owned_snapshot_pdf_download_response(
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
                renderer,
                "expired.pdf",
            )

        self.assertEqual(context.exception.status_code, 410)
        renderer.assert_not_awaited()

    async def test_cleanup_worker_runs_without_traffic_and_preserves_active_lease(self) -> None:
        future_pdf_record = await self._insert_snapshot()
        expired_record = await self._insert_snapshot(ttl_seconds=-1)
        active_lease_record = await self._insert_snapshot(ttl_seconds=-1)
        active_claim_id = uuid.uuid4()
        async with self.sessions() as setup_session:
            await setup_session.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET rendered_pdf = :pdf,
                        rendered_pdf_expires_at = now() - interval '1 second'
                    WHERE id = :snapshot_id
                    """
                ),
                {"snapshot_id": future_pdf_record.id, "pdf": b"%PDF-expired"},
            )
            await setup_session.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET render_claim_id = :claim_id,
                        render_claim_expires_at = now() + interval '60 seconds'
                    WHERE id = :snapshot_id
                    """
                ),
                {
                    "snapshot_id": active_lease_record.id,
                    "claim_id": active_claim_id,
                },
            )
            await setup_session.commit()

        worker = ExportSnapshotCleanupWorker(session_factory=self.sessions)
        await worker.run_once()

        async with self.sessions() as verify:
            future_row = await verify.get(
                ExportRenderSnapshot,
                future_pdf_record.id,
            )
            self.assertIsNotNone(future_row)
            self.assertIsNone(future_row.rendered_pdf)
            self.assertIsNone(
                await verify.get(ExportRenderSnapshot, expired_record.id)
            )
            active_row = await verify.get(
                ExportRenderSnapshot,
                active_lease_record.id,
            )
            self.assertIsNotNone(active_row)
            self.assertEqual(active_row.render_claim_id, active_claim_id)

    async def test_temporary_delete_is_idempotent_owner_bound_and_claim_safe(self) -> None:
        record = await self._insert_snapshot()
        async with self.sessions() as claim_session:
            claim, _, claim_id = await claim_render_snapshot_by_owner(
                claim_session,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )

        async with self.sessions() as delete_session:
            self.assertFalse(
                await delete_temporary_render_snapshot(
                    delete_session,
                    str(record.id),
                    "wrong-user",
                    claim_id=claim_id,
                )
            )
            self.assertFalse(
                await delete_temporary_render_snapshot(
                    delete_session,
                    str(record.id),
                    "user-1",
                )
            )
            self.assertTrue(
                await delete_temporary_render_snapshot(
                    delete_session,
                    str(claim.id),
                    "user-1",
                    claim_id=claim_id,
                )
            )
            self.assertFalse(
                await delete_temporary_render_snapshot(
                    delete_session,
                    str(claim.id),
                    "user-1",
                    claim_id=claim_id,
                )
            )

    async def test_retry_window_is_fifteen_seconds_ttl_bounded_and_then_gone(self) -> None:
        record = await self._insert_snapshot()
        token = build_render_snapshot_token(record)
        async with self.sessions() as session:
            claim, _, claim_id = await claim_render_snapshot_by_token(
                session,
                str(record.id),
                token,
                ResumePdfRenderSnapshot,
            )
            await finalize_render_snapshot_claim(
                session,
                str(claim.id),
                claim_id,
                b"%PDF-retry-window",
            )

        async with self.sessions() as verify:
            persisted = await verify.get(ExportRenderSnapshot, record.id)
            retry_seconds = (
                persisted.rendered_pdf_expires_at - persisted.consumed_at
            ).total_seconds()
            self.assertGreaterEqual(retry_seconds, 14.9)
            self.assertLessEqual(retry_seconds, 15.0)

        renderer = AsyncMock()
        with patch.object(export_router, "AsyncSessionFactory", new=self.sessions):
            retry_response = (
                await export_router.render_legacy_snapshot_pdf_download_response(
                    str(record.id),
                    token,
                    ResumePdfRenderSnapshot,
                    renderer,
                    "retry.pdf",
                )
            )
        self.assertEqual(retry_response.body, b"%PDF-retry-window")
        renderer.assert_not_awaited()

        async with self.sessions() as expire_session:
            await expire_session.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET rendered_pdf_expires_at = now() - interval '1 second'
                    WHERE id = :snapshot_id
                    """
                ),
                {"snapshot_id": record.id},
            )
            await expire_session.commit()

        with (
            patch.object(export_router, "AsyncSessionFactory", new=self.sessions),
            self.assertRaises(HTTPException) as expired,
        ):
            await export_router.render_legacy_snapshot_pdf_download_response(
                str(record.id),
                token,
                ResumePdfRenderSnapshot,
                renderer,
                "retry.pdf",
            )
        self.assertEqual(expired.exception.status_code, 410)

        short_record = await self._insert_snapshot(ttl_seconds=10)
        async with self.sessions() as short_session:
            short_claim, _, short_claim_id = await claim_render_snapshot_by_owner(
                short_session,
                str(short_record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            await finalize_render_snapshot_claim(
                short_session,
                str(short_claim.id),
                short_claim_id,
                b"%PDF-short-ttl",
            )
        async with self.sessions() as verify_short:
            persisted_short = await verify_short.get(
                ExportRenderSnapshot,
                short_record.id,
            )
            self.assertEqual(
                persisted_short.rendered_pdf_expires_at,
                short_record.expires_at,
            )
            self.assertLess(
                (
                    persisted_short.rendered_pdf_expires_at
                    - persisted_short.consumed_at
                ).total_seconds(),
                10,
            )

    async def test_two_sessions_allow_only_one_claim_and_finalize_once(self) -> None:
        record = await self._insert_snapshot()
        async with self.sessions() as first, self.sessions() as second:
            claimed_record, _, claim_id = await claim_render_snapshot_by_owner(
                first,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            self.assertFalse(first.in_transaction())

            # A one-connection pool proves claim committed and returned its
            # connection before the renderer/heartbeat phase begins.
            self.assertEqual((await second.execute(text("SELECT 1"))).scalar_one(), 1)
            with self.assertRaises(SnapshotClaimedError):
                await claim_render_snapshot_by_owner(
                    second,
                    str(record.id),
                    "user-1",
                    ResumePdfRenderSnapshot,
                )
            await finalize_render_snapshot_claim(
                first,
                str(claimed_record.id),
                claim_id,
                b"%PDF-postgres",
            )
            async with self.sessions() as verify:
                persisted = await verify.get(ExportRenderSnapshot, record.id)
                self.assertEqual(persisted.rendered_pdf, b"%PDF-postgres")
                self.assertIsNotNone(persisted.rendered_pdf_expires_at)
            with self.assertRaises(SnapshotConsumedError):
                await claim_render_snapshot_by_owner(
                    second,
                    str(record.id),
                    "user-1",
                    ResumePdfRenderSnapshot,
                )

    async def test_release_allows_retry_without_releasing_a_newer_claim(self) -> None:
        record = await self._insert_snapshot()
        async with self.sessions() as first, self.sessions() as second:
            _, _, first_claim_id = await claim_render_snapshot_by_owner(
                first,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            self.assertTrue(
                await release_render_snapshot_claim(
                    first,
                    str(record.id),
                    first_claim_id,
                )
            )
            claimed_record, _, second_claim_id = await claim_render_snapshot_by_owner(
                second,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            self.assertNotEqual(first_claim_id, second_claim_id)
            self.assertFalse(
                await release_render_snapshot_claim(
                    first,
                    str(record.id),
                    first_claim_id,
                )
            )
            await finalize_render_snapshot_claim(
                second,
                str(claimed_record.id),
                second_claim_id,
                b"%PDF-new-claim",
            )

    async def test_expired_lease_takeover_rejects_old_renew_finalize_and_release(self) -> None:
        record = await self._insert_snapshot()
        async with self.sessions() as first, self.sessions() as second:
            first_record, _, first_claim_id = await claim_render_snapshot_by_owner(
                first,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            await second.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET render_claim_expires_at = now() - interval '1 second'
                    WHERE id = :snapshot_id
                    """
                ),
                {"snapshot_id": record.id},
            )
            await second.commit()

            second_record, _, second_claim_id = await claim_render_snapshot_by_owner(
                second,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            self.assertNotEqual(first_claim_id, second_claim_id)

            with self.assertRaises(SnapshotClaimedError):
                await renew_render_snapshot_claim(
                    first,
                    str(record.id),
                    first_claim_id,
                )
            with self.assertRaises(SnapshotClaimedError):
                await finalize_render_snapshot_claim(
                    first,
                    str(first_record.id),
                    first_claim_id,
                    b"%PDF-stale-worker",
                )
            self.assertFalse(
                await release_render_snapshot_claim(
                    first,
                    str(record.id),
                    first_claim_id,
                )
            )

            await renew_render_snapshot_claim(
                second,
                str(record.id),
                second_claim_id,
            )
            await finalize_render_snapshot_claim(
                second,
                str(second_record.id),
                second_claim_id,
                b"%PDF-takeover",
            )
            async with self.sessions() as verify:
                persisted = await verify.get(ExportRenderSnapshot, record.id)
                self.assertEqual(persisted.rendered_pdf, b"%PDF-takeover")

    async def test_cleanup_retains_expired_snapshot_while_claim_lease_is_active(self) -> None:
        record = await self._insert_snapshot()
        async with self.sessions() as first, self.sessions() as second:
            _, _, claim_id = await claim_render_snapshot_by_owner(
                first,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
            await second.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET expires_at = now() - interval '1 second'
                    WHERE id = :snapshot_id
                    """
                ),
                {"snapshot_id": record.id},
            )
            await second.commit()

            await cleanup_expired_snapshots(second)
            async with self.sessions() as verify:
                self.assertIsNotNone(
                    await verify.get(ExportRenderSnapshot, record.id)
                )

            await second.execute(
                text(
                    """
                    UPDATE export_render_snapshots
                    SET render_claim_expires_at = now() - interval '1 second'
                    WHERE id = :snapshot_id
                    """
                ),
                {"snapshot_id": record.id},
            )
            await second.commit()
            await cleanup_expired_snapshots(second)
            async with self.sessions() as verify:
                self.assertIsNone(await verify.get(ExportRenderSnapshot, record.id))

            self.assertFalse(
                await release_render_snapshot_claim(
                    first,
                    str(record.id),
                    claim_id,
                )
            )


if __name__ == "__main__":
    unittest.main()
