from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException

from app import auth_middleware
from app.domain.export import export_router
from app.domain.export.download_contract import MAX_EXPORT_FILE_NAME_CHARACTERS
from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot
from app.domain.export.snapshot_service import (
    SnapshotClaimedError,
    SnapshotConsumedError,
    SnapshotNotFoundError,
)


class _SessionContext:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _TrackingSessionContext:
    def __init__(self, session) -> None:
        self._session = session

    async def __aenter__(self):
        self._session.active = True
        return self._session

    async def __aexit__(self, exc_type, exc, traceback):
        self._session.active = False
        return False


def _snapshot() -> ResumePdfRenderSnapshot:
    return ResumePdfRenderSnapshot(
        resumeName="安全导出",
        profile=ResumeEditorProfileSnapshot(),
        lineHeight=1.4,
        fontSize=13,
        listSpacingValue="0.3em",
        bulletSpacingValue="0.15em",
        topPaddingPx=42,
        sectionSpacingClass="mb-3",
        listSpacingClass="space-y-2",
    )


class ExportDownloadSecurityTests(unittest.IsolatedAsyncioTestCase):
    def test_authenticated_v2_download_url_contains_snapshot_id_only(self) -> None:
        request = SimpleNamespace(
            app=SimpleNamespace(
                url_path_for=lambda _route_name, snapshot_id: f"/exports/download/resume-pdf/{snapshot_id}"
            )
        )

        url = export_router._build_download_url(
            request,
            "download_resume_pdf",
            "snapshot-1",
            "legacy-token",
            "resume.pdf",
            "authenticated-v2",
        )

        self.assertEqual(url, "/exports/download/resume-pdf/snapshot-1")
        self.assertNotIn("token", url)
        self.assertNotIn("fileName", url)

    def test_legacy_v1_download_url_keeps_signed_query_contract(self) -> None:
        request = SimpleNamespace(
            app=SimpleNamespace(
                url_path_for=lambda _route_name, snapshot_id: f"/exports/download/resume-pdf/{snapshot_id}"
            )
        )

        url = export_router._build_download_url(
            request,
            "download_resume_pdf",
            "snapshot-1",
            "legacy-token",
            "legacy file.pdf",
            "legacy-v1",
        )

        self.assertEqual(
            url,
            "/exports/download/resume-pdf/snapshot-1?token=legacy-token&fileName=legacy+file.pdf",
        )

    def test_legacy_url_and_download_header_bound_oversized_file_names(self) -> None:
        request = SimpleNamespace(
            app=SimpleNamespace(
                url_path_for=lambda _route_name, snapshot_id: f"/exports/download/resume-pdf/{snapshot_id}"
            )
        )
        oversized_name = f"{'文' * 500}.pdf"

        url = export_router._build_download_url(
            request,
            "download_resume_pdf",
            "snapshot-1",
            "legacy-token",
            oversized_name,
            "legacy-v1",
        )
        query_file_name = parse_qs(urlsplit(url).query)["fileName"][0]
        self.assertLessEqual(
            len(query_file_name),
            MAX_EXPORT_FILE_NAME_CHARACTERS,
        )

        sanitized_name = export_router._sanitize_download_filename(oversized_name)
        self.assertEqual(len(sanitized_name), MAX_EXPORT_FILE_NAME_CHARACTERS)
        self.assertTrue(sanitized_name.lower().endswith(".pdf"))
        response = export_router._build_pdf_download_response(b"%PDF-1.7", oversized_name)
        self.assertLess(len(response.headers["content-disposition"]), 3000)

    def test_persisted_pdf_is_used_only_before_its_retry_expiry(self) -> None:
        record = SimpleNamespace(
            rendered_pdf=b"%PDF-persisted",
            rendered_pdf_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        )
        self.assertEqual(
            export_router._get_persisted_rendered_pdf(record),
            b"%PDF-persisted",
        )

        record.rendered_pdf_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertIsNone(export_router._get_persisted_rendered_pdf(record))
        record.rendered_pdf_expires_at = None
        self.assertIsNone(export_router._get_persisted_rendered_pdf(record))

    def test_invalid_rendered_or_cached_pdf_fails_closed(self) -> None:
        invalid_cache = SimpleNamespace(
            rendered_pdf=b"<html>not a pdf</html>",
            rendered_pdf_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        )
        with self.assertRaises(HTTPException) as cached_error:
            export_router._get_persisted_rendered_pdf(invalid_cache)
        self.assertEqual(cached_error.exception.status_code, 502)

        with self.assertRaises(HTTPException) as response_error:
            export_router._build_pdf_download_response(b"", "empty.pdf")
        self.assertEqual(response_error.exception.status_code, 502)

    def test_snapshot_bearer_header_is_required(self) -> None:
        self.assertEqual(
            export_router._read_snapshot_bearer_token("Bearer snapshot-secret"),
            "snapshot-secret",
        )
        for value in (
            None,
            "",
            "Basic abc",
            "Bearer ",
            "Bearer "
            + ("x" * (export_router.MAX_EXPORT_SNAPSHOT_TOKEN_CHARACTERS + 1)),
        ):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException) as context:
                    export_router._read_snapshot_bearer_token(value)
                self.assertEqual(context.exception.status_code, 403)

    def test_download_filename_header_is_percent_decoded_off_url(self) -> None:
        self.assertEqual(
            export_router._decode_download_filename_header(
                "%E7%AE%80%E5%8E%86_%E5%BC%A0%E4%B8%89.pdf"
            ),
            "简历_张三.pdf",
        )

    def test_only_internal_snapshot_get_remains_public_to_logto_middleware(self) -> None:
        render_request = SimpleNamespace(
            method="GET",
            url=SimpleNamespace(path="/exports/render-snapshots/snapshot-1"),
            query_params=SimpleNamespace(getlist=lambda _name: []),
        )
        download_request = SimpleNamespace(
            method="GET",
            url=SimpleNamespace(path="/exports/download/resume-pdf/snapshot-1"),
            query_params=SimpleNamespace(getlist=lambda _name: []),
        )
        legacy_download_request = SimpleNamespace(
            method="GET",
            url=SimpleNamespace(path="/exports/download/resume-pdf/snapshot-1"),
            query_params=SimpleNamespace(getlist=lambda _name: ["legacy-token"]),
        )

        self.assertTrue(auth_middleware._is_public_request(render_request))
        self.assertFalse(auth_middleware._is_public_request(download_request))
        self.assertTrue(auth_middleware._is_public_request(legacy_download_request))

    def test_legacy_download_public_match_is_exact_and_requires_one_token(self) -> None:
        def request(path: str, tokens: list[str], method: str = "GET"):
            return SimpleNamespace(
                method=method,
                url=SimpleNamespace(path=path),
                query_params=SimpleNamespace(getlist=lambda _name: tokens),
            )

        valid_path = "/exports/download/resume-pdf/snapshot-1"
        self.assertTrue(auth_middleware._is_public_request(request(valid_path, ["token"])))
        self.assertFalse(auth_middleware._is_public_request(request(valid_path, [])))
        self.assertFalse(auth_middleware._is_public_request(request(valid_path, [""])))
        self.assertFalse(
            auth_middleware._is_public_request(request(valid_path, ["one", "two"]))
        )
        self.assertFalse(
            auth_middleware._is_public_request(request(f"{valid_path}/extra", ["token"]))
        )
        self.assertFalse(
            auth_middleware._is_public_request(request(valid_path, ["token"], "POST"))
        )

    def test_filename_sanitizer_removes_header_injection_controls(self) -> None:
        response = export_router._build_pdf_download_response(
            b"%PDF-1.7",
            "safe\r\nX-Injected: yes.pdf",
        )

        disposition = response.headers["content-disposition"]
        self.assertNotIn("\r", disposition)
        self.assertNotIn("\n", disposition)
        self.assertNotIn("X-Injected:", disposition)
        self.assertNotIn("x-injected", response.headers)

    async def test_consumed_downloads_return_unexpired_persisted_pdf_without_local_cache(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=datetime.now(timezone.utc),
            rendered_pdf=b"%PDF-persisted",
            rendered_pdf_expires_at=datetime.now(timezone.utc) + timedelta(seconds=30),
        )
        snapshot = _snapshot()

        cases = (
            (
                "owner",
                "get_render_snapshot_by_owner",
                lambda renderer: export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1",
                    "user-1",
                    ResumePdfRenderSnapshot,
                    renderer,
                    "owner.pdf",
                ),
            ),
            (
                "legacy",
                "get_render_snapshot_by_token",
                lambda renderer: export_router.render_legacy_snapshot_pdf_download_response(
                    "snapshot-1",
                    "legacy-token",
                    ResumePdfRenderSnapshot,
                    renderer,
                    "legacy.pdf",
                ),
            ),
        )

        for label, lookup_name, download in cases:
            with self.subTest(label=label):
                renderer = AsyncMock()
                with (
                    patch.object(
                        export_router,
                        "AsyncSessionFactory",
                        side_effect=lambda: _SessionContext(),
                    ),
                    patch.object(
                        export_router,
                        lookup_name,
                        new=AsyncMock(return_value=(record, snapshot)),
                    ),
                ):
                    response = await download(renderer)

                self.assertEqual(response.body, b"%PDF-persisted")
                renderer.assert_not_awaited()

    async def test_renderer_starts_only_after_claim_session_context_exits(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        lookup_session = SimpleNamespace(name="lookup", active=False)
        claim_session = SimpleNamespace(name="claim", active=False)
        finalize_session = SimpleNamespace(name="finalize", active=False)
        contexts = iter(
            (
                _TrackingSessionContext(lookup_session),
                _TrackingSessionContext(claim_session),
                _TrackingSessionContext(finalize_session),
            )
        )

        async def render_pdf(_snapshot_id: str, token: str) -> bytes:
            self.assertEqual(token, "internal-snapshot-token")
            self.assertFalse(lookup_session.active)
            self.assertFalse(
                claim_session.active,
                "renderer must not hold the persistent claim session/connection",
            )
            return b"%PDF-outside-claim-session"

        async def finalize_claim(*_args, **_kwargs) -> None:
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = b"%PDF-outside-claim-session"
            record.rendered_pdf_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=30
            )

        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: next(contexts),
            ),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot, "claim-1")),
            ),
            patch.object(
                export_router,
                "build_render_snapshot_token",
                return_value="internal-snapshot-token",
            ),
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=AsyncMock(side_effect=finalize_claim),
            ),
        ):
            response = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1",
                "user-1",
                ResumePdfRenderSnapshot,
                render_pdf,
                "resume.pdf",
            )

        self.assertEqual(response.body, b"%PDF-outside-claim-session")

    async def test_second_worker_reads_pdf_persisted_by_finalize_after_local_state_reset(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        renderer = AsyncMock(return_value=b"%PDF-persisted-by-worker-one")

        async def finalize_claim(*_args, **_kwargs) -> None:
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = b"%PDF-persisted-by-worker-one"
            record.rendered_pdf_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=30
            )

        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(),
            ),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot, "claim-1")),
            ),
            patch.object(
                export_router,
                "build_render_snapshot_token",
                return_value="internal-snapshot-token",
            ),
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=AsyncMock(side_effect=finalize_claim),
            ),
        ):
            first_response = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1",
                "user-1",
                ResumePdfRenderSnapshot,
                renderer,
                "worker-one.pdf",
            )

            second_response = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1",
                "user-1",
                ResumePdfRenderSnapshot,
                renderer,
                "worker-two.pdf",
            )

        self.assertEqual(first_response.body, b"%PDF-persisted-by-worker-one")
        self.assertEqual(second_response.body, b"%PDF-persisted-by-worker-one")
        renderer.assert_awaited_once()

    async def test_cancel_after_finalize_commit_keeps_pdf_recoverable_by_new_session(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        renderer = AsyncMock(return_value=b"%PDF-committed-before-cancel")

        async def finalize_then_cancel(
            _session,
            snapshot_id,
            _claim_id,
            pdf_bytes,
            **_kwargs,
        ) -> None:
            self.assertEqual(snapshot_id, "snapshot-1")
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = pdf_bytes
            record.rendered_pdf_expires_at = datetime.now(
                timezone.utc
            ) + timedelta(seconds=30)
            raise asyncio.CancelledError

        release = AsyncMock(return_value=False)
        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(),
            ),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot, "claim-1")),
            ),
            patch.object(
                export_router,
                "build_render_snapshot_token",
                return_value="internal-snapshot-token",
            ),
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=AsyncMock(side_effect=finalize_then_cancel),
            ),
            patch.object(
                export_router,
                "release_render_snapshot_claim",
                new=release,
            ),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1",
                    "user-1",
                    ResumePdfRenderSnapshot,
                    renderer,
                    "worker-one.pdf",
                )

            recovered = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1",
                "user-1",
                ResumePdfRenderSnapshot,
                renderer,
                "worker-two.pdf",
            )

        self.assertEqual(recovered.body, b"%PDF-committed-before-cancel")
        renderer.assert_awaited_once()
        release.assert_awaited_once()

    async def test_renderer_failure_releases_persistent_claim_by_snapshot_and_claim_id(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        lookup_session = SimpleNamespace(name="lookup", active=False)
        claim_session = SimpleNamespace(name="claim", active=False)
        release_session = SimpleNamespace(name="release", active=False)
        contexts = iter(
            (
                _TrackingSessionContext(lookup_session),
                _TrackingSessionContext(claim_session),
                _TrackingSessionContext(release_session),
            )
        )

        async def release_claim(session, snapshot_id: str, claim_id: str) -> None:
            self.assertIs(session, release_session)
            self.assertTrue(release_session.active)
            self.assertFalse(claim_session.active)
            self.assertEqual(snapshot_id, "snapshot-1")
            self.assertEqual(claim_id, "claim-1")

        release = AsyncMock(side_effect=release_claim)
        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: next(contexts),
            ),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot, "claim-1")),
            ),
            patch.object(
                export_router,
                "build_render_snapshot_token",
                return_value="internal-snapshot-token",
            ),
            patch.object(
                export_router,
                "release_render_snapshot_claim",
                new=release,
            ),
        ):
            with self.assertRaises(HTTPException) as failure:
                await export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1",
                    "user-1",
                    ResumePdfRenderSnapshot,
                    AsyncMock(side_effect=export_router.BrowserPdfRenderError("render failed")),
                    "resume.pdf",
                )

        self.assertEqual(failure.exception.status_code, 502)
        release.assert_awaited_once()

    async def test_heartbeat_claim_loss_cancels_renderer_and_never_finalizes(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        heartbeat_session = SimpleNamespace(name="heartbeat", active=False)
        release_session = SimpleNamespace(name="release", active=False)
        contexts = iter(
            (
                _TrackingSessionContext(heartbeat_session),
                _TrackingSessionContext(release_session),
            )
        )
        renderer_cancelled = asyncio.Event()

        async def blocked_renderer(_snapshot_id: str, _token: str) -> bytes:
            try:
                await asyncio.Event().wait()
            finally:
                renderer_cancelled.set()

        renew = AsyncMock(
            side_effect=SnapshotClaimedError("导出快照 claim 已失效。")
        )
        finalize = AsyncMock()
        release = AsyncMock()
        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: next(contexts),
            ),
            patch.object(
                export_router,
                "RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS",
                0,
                create=True,
            ),
            patch.object(
                export_router,
                "renew_render_snapshot_claim",
                new=renew,
                create=True,
            ),
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=finalize,
            ),
            patch.object(
                export_router,
                "release_render_snapshot_claim",
                new=release,
            ),
        ):
            with self.assertRaises(HTTPException) as failure:
                await asyncio.wait_for(
                    export_router._render_and_finalize_claimed_snapshot(
                        record,
                        "claim-1",
                        "internal-snapshot-token",
                        blocked_renderer,
                    ),
                    timeout=1,
                )

        self.assertEqual(failure.exception.status_code, 409)
        self.assertTrue(renderer_cancelled.is_set())
        renew.assert_awaited()
        release.assert_awaited_once()
        finalize.assert_not_awaited()

    async def test_owned_download_allows_only_one_concurrent_renderer_and_keeps_recent_retry(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        render_started = asyncio.Event()
        release_render = asyncio.Event()
        render_count = 0

        async def render_pdf(_snapshot_id: str, token: str) -> bytes:
            nonlocal render_count
            render_count += 1
            self.assertEqual(token, "internal-snapshot-token")
            render_started.set()
            await release_render.wait()
            return b"%PDF-secure"

        async def finalize_claim(
            _session,
            snapshot_id,
            claim_id,
            pdf_bytes,
            **_kwargs,
        ) -> None:
            self.assertEqual(snapshot_id, "snapshot-1")
            self.assertEqual(claim_id, "claim-1")
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = pdf_bytes
            record.rendered_pdf_expires_at = datetime.now(
                timezone.utc
            ) + timedelta(seconds=30)

        claim_count = 0

        async def claim_snapshot(*_args, **_kwargs):
            nonlocal claim_count
            claim_count += 1
            if claim_count == 1:
                return record, snapshot, "claim-1"
            raise SnapshotClaimedError("导出快照正在生成，请稍后重试。")

        with (
            patch.object(export_router, "AsyncSessionFactory", side_effect=lambda: _SessionContext()),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(side_effect=claim_snapshot),
            ),
            patch.object(
                export_router,
                "build_render_snapshot_token",
                return_value="internal-snapshot-token",
            ),
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=AsyncMock(side_effect=finalize_claim),
            ),
        ):
            first = asyncio.create_task(
                export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1", "user-1", ResumePdfRenderSnapshot, render_pdf, "one.pdf"
                )
            )
            await render_started.wait()
            with self.assertRaises(HTTPException) as conflict:
                await export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1", "user-1", ResumePdfRenderSnapshot, render_pdf, "two.pdf"
                )
            release_render.set()
            first_response = await first

            retry_response = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1", "user-1", ResumePdfRenderSnapshot, render_pdf, "retry.pdf"
            )

        self.assertEqual(render_count, 1)
        self.assertEqual(conflict.exception.status_code, 409)
        self.assertEqual(first_response.body, b"%PDF-secure")
        self.assertEqual(retry_response.body, b"%PDF-secure")
        self.assertEqual(retry_response.headers["cache-control"], "no-store")

    async def test_claim_race_recovers_pdf_persisted_by_the_winning_worker(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        renderer = AsyncMock()

        async def lose_claim_race(*_args, **_kwargs):
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = b"%PDF-winning-worker"
            record.rendered_pdf_expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=30
            )
            raise SnapshotConsumedError("导出快照已失效，请重新导出。")

        lookup = AsyncMock(return_value=(record, snapshot))
        with (
            patch.object(
                export_router,
                "AsyncSessionFactory",
                side_effect=lambda: _SessionContext(),
            ),
            patch.object(export_router, "get_render_snapshot_by_owner", new=lookup),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(side_effect=lose_claim_race),
            ),
        ):
            response = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1",
                "user-1",
                ResumePdfRenderSnapshot,
                renderer,
                "retry.pdf",
            )

        self.assertEqual(response.body, b"%PDF-winning-worker")
        self.assertEqual(lookup.await_count, 2)
        renderer.assert_not_awaited()

    async def test_owned_download_releases_claim_after_renderer_failure_for_retry(self) -> None:
        record = SimpleNamespace(
            id="snapshot-1",
            user_id="user-1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
            consumed_at=None,
            rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        snapshot = _snapshot()
        renderer = AsyncMock(
            side_effect=[
                export_router.BrowserPdfRenderError("render failed"),
                b"%PDF-retry",
            ]
        )

        async def finalize_claim(
            _session,
            snapshot_id,
            _claim_id,
            pdf_bytes,
            **_kwargs,
        ) -> None:
            self.assertEqual(snapshot_id, "snapshot-1")
            record.consumed_at = datetime.now(timezone.utc)
            record.rendered_pdf = pdf_bytes
            record.rendered_pdf_expires_at = datetime.now(
                timezone.utc
            ) + timedelta(seconds=30)

        with (
            patch.object(export_router, "AsyncSessionFactory", side_effect=lambda: _SessionContext()),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot)),
            ),
            patch.object(
                export_router,
                "claim_render_snapshot_by_owner",
                new=AsyncMock(return_value=(record, snapshot, "claim-1")),
            ),
            patch.object(export_router, "build_render_snapshot_token", return_value="token"),
            patch.object(
                export_router,
                "release_render_snapshot_claim",
                new=AsyncMock(),
            ) as release_claim,
            patch.object(
                export_router,
                "finalize_render_snapshot_claim",
                new=AsyncMock(side_effect=finalize_claim),
            ),
        ):
            with self.assertRaises(HTTPException) as failure:
                await export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-1", "user-1", ResumePdfRenderSnapshot, renderer, None
                )
            retry = await export_router.render_owned_snapshot_pdf_download_response(
                "snapshot-1", "user-1", ResumePdfRenderSnapshot, renderer, None
            )

        self.assertEqual(failure.exception.status_code, 502)
        release_claim.assert_awaited_once()
        self.assertEqual(retry.body, b"%PDF-retry")

    async def test_owned_download_does_not_render_another_users_snapshot(self) -> None:
        renderer = AsyncMock()
        with (
            patch.object(export_router, "AsyncSessionFactory", side_effect=lambda: _SessionContext()),
            patch.object(
                export_router,
                "get_render_snapshot_by_owner",
                new=AsyncMock(side_effect=SnapshotNotFoundError("导出快照不存在。")),
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                await export_router.render_owned_snapshot_pdf_download_response(
                    "snapshot-a", "user-b", ResumePdfRenderSnapshot, renderer, None
                )

        self.assertEqual(context.exception.status_code, 404)
        renderer.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
