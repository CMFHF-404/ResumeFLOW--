from __future__ import annotations

from contextlib import contextmanager
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot
from app.domain.export.snapshot_service import (
    SnapshotClaimedError,
    SnapshotCapacityExceededError,
    SnapshotConsumedError,
    SnapshotRenderedPdfError,
    SnapshotTokenError,
    RenderSnapshotClaim,
    RenderSnapshotState,
    _acquire_export_user_advisory_lock,
    build_render_snapshot_token,
    claim_render_snapshot_by_owner,
    claim_render_snapshot_by_token,
    cleanup_expired_snapshots,
    create_render_snapshot,
    delete_temporary_render_snapshot,
    finalize_render_snapshot_claim,
    get_render_snapshot_by_owner,
    renew_render_snapshot_claim,
    release_render_snapshot_claim,
)
from app.domain.export.limits import (
    MAX_ACTIVE_EXPORT_RENDER_CLAIMS_PER_USER,
    MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER,
    MAX_EXPORT_PERSISTED_BYTES_PER_USER,
    MAX_EXPORT_SNAPSHOT_PAYLOAD_BYTES_PER_USER,
    MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS,
)


class _ScalarResult:
    def __init__(self, value) -> None:
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def one(self):
        return self._value

    def one_or_none(self):
        return self._value


def _snapshot() -> ResumePdfRenderSnapshot:
    return ResumePdfRenderSnapshot(
        resumeName="claim-test",
        profile=ResumeEditorProfileSnapshot(),
        lineHeight=1.4,
        fontSize=13,
        listSpacingValue="0.3em",
        bulletSpacingValue="0.15em",
        topPaddingPx=42,
        sectionSpacingClass="mb-3",
        listSpacingClass="space-y-2",
    )


def _record(
    *,
    claim_id: uuid.UUID | None = None,
    claim_expires_at: datetime | None = None,
    consumed: bool = False,
):
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id="user-1",
        payload_json=_snapshot().model_dump(mode="json"),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        consumed_at=datetime.now(timezone.utc) if consumed else None,
        render_claim_id=claim_id,
        render_claim_expires_at=claim_expires_at,
        rendered_pdf=None,
        rendered_pdf_expires_at=None,
        snapshot_expired=False,
    )


class ExportSnapshotClaimTests(unittest.IsolatedAsyncioTestCase):
    @contextmanager
    def _claim_budget(self, active_claim_count: int = 1):
        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            patch(
                "app.domain.export.snapshot_service._read_user_active_claim_count",
                new=AsyncMock(return_value=active_claim_count),
            ),
        ):
            yield

    async def test_create_commits_without_refresh_or_post_commit_database_work(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[_ScalarResult(None), _ScalarResult(None)]
            ),
            add=Mock(),
            flush=AsyncMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )

        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            patch(
                "app.domain.export.snapshot_service._read_user_snapshot_budget_usage",
                new=AsyncMock(return_value=(1, 1024, 0)),
            ),
        ):
            record, token = await create_render_snapshot(
                session,
                "user-1",
                _snapshot(),
            )

        self.assertEqual(record.user_id, "user-1")
        self.assertTrue(token)
        self.assertEqual(session.execute.await_count, 2)
        self.assertEqual(session.commit.await_count, 1)
        session.flush.assert_awaited_once()
        session.refresh.assert_not_awaited()

    async def test_create_rolls_back_each_per_user_budget_overflow(self) -> None:
        overages = (
            (MAX_ACTIVE_EXPORT_SNAPSHOTS_PER_USER + 1, 1024, 0),
            (1, MAX_EXPORT_SNAPSHOT_PAYLOAD_BYTES_PER_USER + 1, 0),
            (1, 1024, MAX_EXPORT_PERSISTED_BYTES_PER_USER),
        )
        for usage in overages:
            with self.subTest(usage=usage):
                session = SimpleNamespace(
                    execute=AsyncMock(
                        side_effect=[_ScalarResult(None), _ScalarResult(None)]
                    ),
                    add=Mock(),
                    flush=AsyncMock(),
                    commit=AsyncMock(),
                    rollback=AsyncMock(),
                )
                with (
                    patch(
                        "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                        new=AsyncMock(),
                    ),
                    patch(
                        "app.domain.export.snapshot_service._read_user_snapshot_budget_usage",
                        new=AsyncMock(return_value=usage),
                    ),
                    self.assertRaises(SnapshotCapacityExceededError),
                ):
                    await create_render_snapshot(session, "user-1", _snapshot())

                session.flush.assert_awaited_once()
                session.rollback.assert_awaited_once()
                session.commit.assert_not_awaited()

    async def test_advisory_lock_is_transaction_scoped_and_user_keyed(self) -> None:
        session = SimpleNamespace(execute=AsyncMock(return_value=_ScalarResult(None)))

        await _acquire_export_user_advisory_lock(session, "user-1")

        statement_sql = str(session.execute.await_args.args[0]).lower()
        self.assertIn("pg_advisory_xact_lock", statement_sql)
        self.assertIn("hashtextextended", statement_sql)

    async def test_lookup_detaches_immutable_state_before_session_cleanup(self) -> None:
        record = _record()
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _ScalarResult(record.expires_at),
                    _ScalarResult(None),
                    _ScalarResult(None),
                    _ScalarResult(record),
                ]
            ),
            commit=AsyncMock(),
        )

        state, snapshot = await get_render_snapshot_by_owner(
            session,
            str(record.id),
            "user-1",
            ResumePdfRenderSnapshot,
        )

        self.assertIsInstance(state, RenderSnapshotState)
        self.assertIsNot(state, record)
        self.assertEqual(state.id, record.id)
        self.assertEqual(snapshot.resumeName, "claim-test")
        with self.assertRaises(FrozenInstanceError):
            state.consumed_at = datetime.now(timezone.utc)

    async def test_claim_commits_persisted_lease_without_holding_row_lock(self) -> None:
        record = _record()
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(record)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self._claim_budget():
            claimed_record, snapshot, claim_id = await claim_render_snapshot_by_owner(
                session,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )
        claim_statement = session.execute.await_args_list[0].args[0]

        self.assertIsInstance(claimed_record, RenderSnapshotClaim)
        self.assertIsNot(claimed_record, record)
        self.assertEqual(claimed_record.id, record.id)
        self.assertEqual(claimed_record.user_id, record.user_id)
        self.assertEqual(claimed_record.expires_at, record.expires_at)
        with self.assertRaises(FrozenInstanceError):
            claimed_record.id = uuid.uuid4()
        self.assertEqual(snapshot.resumeName, "claim-test")
        self.assertIsInstance(claim_id, uuid.UUID)
        self.assertEqual(claim_statement.__class__.__name__, "Update")
        claim_sql = str(claim_statement).lower()
        self.assertNotIn("for update", claim_sql)
        self.assertIn("consumed_at is null", claim_sql)
        self.assertIn("expires_at > now()", claim_sql)
        self.assertIn("render_claim_expires_at <= now()", claim_sql)
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()

    async def test_active_lease_maps_to_stable_claimed_error(self) -> None:
        record = _record(
            claim_id=uuid.uuid4(),
            claim_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        )
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[_ScalarResult(None), _ScalarResult(record)]
            ),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self._claim_budget(), self.assertRaises(SnapshotClaimedError):
            await claim_render_snapshot_by_owner(
                session,
                str(uuid.uuid4()),
                "user-1",
                ResumePdfRenderSnapshot,
            )

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()

    async def test_claim_rolls_back_when_user_active_claim_budget_is_full(self) -> None:
        record = _record()
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(record)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self._claim_budget(MAX_ACTIVE_EXPORT_RENDER_CLAIMS_PER_USER + 1):
            with self.assertRaises(SnapshotCapacityExceededError):
                await claim_render_snapshot_by_owner(
                    session,
                    str(record.id),
                    "user-1",
                    ResumePdfRenderSnapshot,
                )

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()

    async def test_expired_lease_can_be_reclaimed_with_a_new_claim_id(self) -> None:
        previous_claim_id = uuid.uuid4()
        record = _record(
            claim_id=previous_claim_id,
            claim_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(record)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self._claim_budget():
            _, _, claim_id = await claim_render_snapshot_by_owner(
                session,
                str(record.id),
                "user-1",
                ResumePdfRenderSnapshot,
            )

        self.assertNotEqual(claim_id, previous_claim_id)
        session.commit.assert_awaited_once()

    async def test_token_claim_commits_the_same_persisted_lease_contract(self) -> None:
        record = _record()
        token = build_render_snapshot_token(record)
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(record)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self._claim_budget():
            claimed_record, snapshot, claim_id = await claim_render_snapshot_by_token(
                session,
                str(record.id),
                token,
                ResumePdfRenderSnapshot,
            )

        self.assertIsInstance(claimed_record, RenderSnapshotClaim)
        self.assertIsNot(claimed_record, record)
        self.assertEqual(claimed_record.id, record.id)
        self.assertEqual(snapshot.resumeName, "claim-test")
        self.assertIsInstance(claim_id, uuid.UUID)
        self.assertIn("user_id", str(session.execute.await_args.args[0]).lower())
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()

    async def test_token_claim_rejects_missing_uid_before_touching_database(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        snapshot_id = str(uuid.uuid4())

        with (
            patch(
                "app.domain.export.snapshot_service._decode_snapshot_token",
                return_value={"sub": snapshot_id},
            ),
            self.assertRaises(SnapshotTokenError),
        ):
            await claim_render_snapshot_by_token(
                session,
                snapshot_id,
                "signed-without-uid",
                ResumePdfRenderSnapshot,
            )

        session.execute.assert_not_awaited()

    async def test_oversized_token_is_rejected_before_jwt_decode(self) -> None:
        with (
            patch("app.domain.export.snapshot_service.jwt.decode") as decode,
            self.assertRaises(SnapshotTokenError),
        ):
            await claim_render_snapshot_by_token(
                SimpleNamespace(execute=AsyncMock()),
                str(uuid.uuid4()),
                "x" * (MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS + 1),
                ResumePdfRenderSnapshot,
            )

        decode.assert_not_called()

    async def test_renew_extends_only_a_current_matching_claim(self) -> None:
        claim_id = uuid.uuid4()
        renewed_until = datetime.now(timezone.utc) + timedelta(seconds=60)
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(renewed_until)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        result = await renew_render_snapshot_claim(
            session,
            str(uuid.uuid4()),
            claim_id,
        )
        renew_statement = session.execute.await_args.args[0]
        renew_sql = str(renew_statement).lower()

        self.assertEqual(result, renewed_until)
        self.assertIn("render_claim_id", renew_sql)
        self.assertIn("render_claim_expires_at > now()", renew_sql)
        self.assertNotIn("export_render_snapshots.expires_at > now()", renew_sql)
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()

    async def test_renew_rejects_a_lost_or_expired_claim(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(None)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with self.assertRaises(SnapshotClaimedError):
            await renew_render_snapshot_claim(
                session,
                str(uuid.uuid4()),
                uuid.uuid4(),
            )

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()

    async def test_finalize_persists_pdf_only_for_a_current_live_claim(self) -> None:
        claim_id = uuid.uuid4()
        record = _record(
            claim_id=claim_id,
            claim_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        )
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(record.id)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            patch(
                "app.domain.export.snapshot_service._read_user_snapshot_budget_usage",
                new=AsyncMock(return_value=(1, 1024, 1024)),
            ),
        ):
            await finalize_render_snapshot_claim(
                session,
                str(record.id),
                claim_id,
                b"%PDF-persisted",
                retry_ttl_seconds=15,
            )
        finalize_statement = session.execute.await_args.args[0]
        finalize_sql = str(finalize_statement).lower()

        self.assertIn("consumed_at is null", finalize_sql)
        self.assertIn("render_claim_id", finalize_sql)
        self.assertIn("render_claim_expires_at > now()", finalize_sql)
        self.assertIn("least(export_render_snapshots.expires_at", finalize_sql)
        self.assertIn(b"%PDF-persisted", finalize_statement.compile().params.values())
        self.assertIsNone(record.rendered_pdf)
        self.assertIsNone(record.rendered_pdf_expires_at)
        self.assertEqual(record.render_claim_id, claim_id)
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()

    async def test_finalize_rejects_invalid_pdf_before_touching_database(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        for payload in (b"", b"not-a-pdf"):
            with self.subTest(payload=payload), self.assertRaises(
                SnapshotRenderedPdfError
            ):
                await finalize_render_snapshot_claim(
                    session,
                    str(uuid.uuid4()),
                    uuid.uuid4(),
                    payload,
                )

        session.execute.assert_not_awaited()
        session.commit.assert_not_awaited()
        session.rollback.assert_not_awaited()

    async def test_finalize_rejects_stale_claim_and_consumed_snapshot(self) -> None:
        stale_session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _ScalarResult("user-1"),
                    _ScalarResult(None),
                    _ScalarResult(_record(claim_id=uuid.uuid4())),
                ]
            ),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            self.assertRaises(SnapshotClaimedError),
        ):
            await finalize_render_snapshot_claim(
                stale_session,
                str(_record().id),
                uuid.uuid4(),
                b"%PDF-stale",
            )
        stale_session.rollback.assert_awaited_once()

        consumed_record = _record(consumed=True)
        consumed_session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _ScalarResult("user-1"),
                    _ScalarResult(None),
                    _ScalarResult(consumed_record),
                ]
            ),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            self.assertRaises(SnapshotConsumedError),
        ):
            await finalize_render_snapshot_claim(
                consumed_session,
                str(consumed_record.id),
                uuid.uuid4(),
                b"%PDF-consumed",
            )
        consumed_session.rollback.assert_awaited_once()

    async def test_finalize_rejects_an_expired_claim_even_before_takeover(self) -> None:
        expired_claim = uuid.uuid4()
        expired_record = _record(
            claim_id=expired_claim,
            claim_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _ScalarResult("user-1"),
                    _ScalarResult(None),
                    _ScalarResult(expired_record),
                ]
            ),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with (
            patch(
                "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
                new=AsyncMock(),
            ),
            self.assertRaises(SnapshotClaimedError),
        ):
            await finalize_render_snapshot_claim(
                session,
                str(expired_record.id),
                expired_claim,
                b"%PDF-expired-claim",
            )

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()

    async def test_release_is_conditional_and_does_not_rollback_a_render_transaction(self) -> None:
        snapshot_id = uuid.uuid4()
        claim_id = uuid.uuid4()
        session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(snapshot_id)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        released = await release_render_snapshot_claim(
            session,
            str(snapshot_id),
            claim_id,
        )
        release_statement = session.execute.await_args.args[0]

        self.assertTrue(released)
        self.assertIn("render_claim_id", str(release_statement).lower())
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()

        stale_session = SimpleNamespace(
            execute=AsyncMock(return_value=_ScalarResult(None)),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )
        released = await release_render_snapshot_claim(
            stale_session,
            str(snapshot_id),
            uuid.uuid4(),
        )
        self.assertFalse(released)
        stale_session.rollback.assert_awaited_once()
        stale_session.commit.assert_not_awaited()

    async def test_temporary_delete_is_owner_bound_idempotent_and_claim_safe(self) -> None:
        snapshot_id = uuid.uuid4()
        claim_id = uuid.uuid4()
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _ScalarResult(snapshot_id),
                    _ScalarResult(None),
                ]
            ),
            commit=AsyncMock(),
            rollback=AsyncMock(),
        )

        with patch(
            "app.domain.export.snapshot_service._acquire_export_user_advisory_lock",
            new=AsyncMock(),
        ):
            deleted = await delete_temporary_render_snapshot(
                session,
                str(snapshot_id),
                "user-1",
                claim_id=claim_id,
            )
            deleted_again = await delete_temporary_render_snapshot(
                session,
                str(snapshot_id),
                "user-1",
                claim_id=claim_id,
            )

        delete_statement = session.execute.await_args_list[0].args[0]
        delete_sql = str(delete_statement).lower()
        self.assertTrue(deleted)
        self.assertFalse(deleted_again)
        self.assertIn("user_id", delete_sql)
        self.assertIn("render_claim_id", delete_sql)
        self.assertIn("render_claim_expires_at <= now()", delete_sql)
        self.assertEqual(session.commit.await_count, 1)
        self.assertEqual(session.rollback.await_count, 1)

    async def test_cleanup_skips_unexpired_active_claims(self) -> None:
        session = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[_ScalarResult(None), _ScalarResult(None)]
            ),
            commit=AsyncMock(),
        )

        await cleanup_expired_snapshots(session)
        clear_result_statement = session.execute.await_args_list[0].args[0]
        delete_statement = session.execute.await_args_list[1].args[0]
        clear_sql = str(clear_result_statement).lower()
        delete_sql = str(delete_statement).lower()

        self.assertEqual(clear_result_statement.__class__.__name__, "Update")
        self.assertEqual(delete_statement.__class__.__name__, "Delete")
        self.assertIn("rendered_pdf is not null", clear_sql)
        self.assertIn("rendered_pdf_expires_at <= now()", clear_sql)
        self.assertIn("render_claim_id is null", delete_sql)
        self.assertIn("render_claim_expires_at <= now()", delete_sql)
        session.commit.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
