from __future__ import annotations

import asyncio
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.domain.export import snapshot_download_service as downloads
from app.domain.export.schemas import ResumePdfRenderSnapshot
from app.domain.export.snapshot_service import SnapshotClaimedError, SnapshotConsumedError
from test_export_http_compatibility import _snapshot


class ExportDownloadImportBoundaryTests(unittest.TestCase):
    def test_leaf_and_agent_imports_do_not_load_export_router(self) -> None:
        env = os.environ.copy()
        env.update({
            "DATABASE_URL": "postgresql+asyncpg://user:password@localhost:5432/resumeflow",
            "LOGTO_ISSUER": "https://example.logto.app/oidc",
            "LOGTO_APP_ID": "resume-spa-app-id",
            "RESUMEFLOW_DEPLOYMENT_MODE": "local",
        })
        for module in (
            "app.domain.export.download_http",
            "app.domain.export.snapshot_download_service",
            "app.domain.agent.agent_router",
        ):
            with self.subTest(module=module):
                result = subprocess.run(
                    [sys.executable, "-B", "-c", f"""
import importlib
import sys
importlib.import_module({module!r})
assert 'app.domain.export.export_router' not in sys.modules
from app.domain.export import router
from app.domain.export.export_router import router as registered_router
assert router is registered_router
"""],
                    cwd=Path(__file__).resolve().parent,
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class _SessionContext:
    def __init__(self, sessions):
        self.session = SimpleNamespace(active=False)
        sessions.append(self.session)

    async def __aenter__(self):
        self.session.active = True
        return self.session

    async def __aexit__(self, *_args):
        self.session.active = False
        return False


class ExportDownloadDefaultServiceTests(unittest.IsolatedAsyncioTestCase):
    def _fixture(self, mode):
        snapshot = _snapshot()
        record = SimpleNamespace(
            id="snapshot-1", consumed_at=None, rendered_pdf=None,
            rendered_pdf_expires_at=None,
        )
        sessions = []
        lookup = AsyncMock(return_value=(record, snapshot))
        claim = AsyncMock(return_value=(record, snapshot, "claim-1"))
        finalize = AsyncMock()
        release = AsyncMock()
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(
            downloads, "AsyncSessionFactory", side_effect=lambda: _SessionContext(sessions),
        ))
        suffix = "owner" if mode == "owned" else "token"
        stack.enter_context(patch.object(downloads, f"get_render_snapshot_by_{suffix}", new=lookup))
        stack.enter_context(patch.object(downloads, f"claim_render_snapshot_by_{suffix}", new=claim))
        stack.enter_context(patch.object(downloads, "finalize_render_snapshot_claim", new=finalize))
        stack.enter_context(patch.object(downloads, "release_render_snapshot_claim", new=release))
        stack.enter_context(patch.object(downloads, "build_render_snapshot_token", return_value="signed-token"))
        download = (
            downloads.render_owned_snapshot_pdf_download_response
            if mode == "owned" else downloads.render_legacy_snapshot_pdf_download_response
        )

        async def run(renderer):
            return await download(
                "snapshot-1", "owner-1" if mode == "owned" else "signed-token",
                ResumePdfRenderSnapshot, renderer, None,
            )

        return SimpleNamespace(
            snapshot=snapshot, record=record, sessions=sessions,
            lookup=lookup, claim=claim, finalize=finalize, release=release, run=run,
        )

    async def test_default_download_releases_lookup_sessions_before_render_and_finalizes(self):
        for mode in ("owned", "legacy"):
            with self.subTest(mode=mode):
                fixture = self._fixture(mode)

                async def render(snapshot_id, token):
                    self.assertEqual((snapshot_id, token), ("snapshot-1", "signed-token"))
                    self.assertFalse(any(session.active for session in fixture.sessions))
                    return b"%PDF-service"

                response = await fixture.run(render)
                self.assertEqual(response.body, b"%PDF-service")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertIn("attachment;", response.headers["content-disposition"])
                self.assertEqual(len(fixture.sessions), 3)
                self.assertFalse(any(session.active for session in fixture.sessions))
                fixture.finalize.assert_awaited_once_with(
                    fixture.sessions[2], "snapshot-1", "claim-1", b"%PDF-service",
                    retry_ttl_seconds=downloads.RECENT_RENDERED_PDF_TTL_SECONDS,
                )
                fixture.release.assert_not_awaited()

    async def test_default_download_reuses_cache_after_consumption_and_claim_race(self):
        for mode in ("owned", "legacy"):
            for recovery in (False, True):
                with self.subTest(mode=mode, recovery=recovery):
                    fixture = self._fixture(mode)
                    cached_record = SimpleNamespace(
                        id="snapshot-1", consumed_at=datetime.now(timezone.utc),
                        rendered_pdf=b"%PDF-cached",
                        rendered_pdf_expires_at=datetime.now(timezone.utc) + timedelta(minutes=1),
                    )
                    if recovery:
                        fixture.lookup.side_effect = [
                            (fixture.record, fixture.snapshot),
                            (cached_record, fixture.snapshot),
                        ]
                        fixture.claim.side_effect = SnapshotConsumedError("consumed")
                    else:
                        fixture.lookup.return_value = (cached_record, fixture.snapshot)
                    renderer = AsyncMock()
                    response = await fixture.run(renderer)
                    self.assertEqual(response.body, b"%PDF-cached")
                    self.assertEqual(fixture.lookup.await_count, 2 if recovery else 1)
                    renderer.assert_not_awaited()
                    fixture.finalize.assert_not_awaited()
                    fixture.release.assert_not_awaited()

    async def test_default_render_failure_and_cancellation_release_the_claim(self):
        for failure, status in (
            (downloads.BrowserPdfRenderError("render failed"), 502),
            (downloads.BrowserPdfRenderTimeoutError("render timed out"), 504),
            (asyncio.CancelledError(), None),
        ):
            for mode in ("owned", "legacy"):
                with self.subTest(mode=mode, failure=type(failure).__name__):
                    fixture = self._fixture(mode)
                    with self.assertRaises(HTTPException if status else asyncio.CancelledError) as caught:
                        await fixture.run(AsyncMock(side_effect=failure))
                    if status:
                        self.assertEqual(caught.exception.status_code, status)
                        self.assertEqual(caught.exception.headers["Cache-Control"], "no-store")
                    fixture.finalize.assert_not_awaited()
                    fixture.release.assert_awaited_once_with(
                        fixture.sessions[-1], "snapshot-1", "claim-1",
                    )
                    self.assertFalse(any(session.active for session in fixture.sessions))

    async def test_default_heartbeat_failure_cancels_renderer_and_releases_claim(self):
        fixture = self._fixture("owned")
        cancelled = asyncio.Event()

        async def render(_snapshot_id, _token):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        renew = AsyncMock(side_effect=SnapshotClaimedError("claim expired"))
        with (
            patch.object(downloads, "RENDER_CLAIM_HEARTBEAT_INTERVAL_SECONDS", 0),
            patch.object(downloads, "renew_render_snapshot_claim", new=renew),
        ):
            with self.assertRaises(HTTPException) as caught:
                await asyncio.wait_for(fixture.run(render), timeout=1)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertTrue(cancelled.is_set())
        renew.assert_awaited_once()
        fixture.finalize.assert_not_awaited()
        fixture.release.assert_awaited_once()
        self.assertFalse(any(session.active for session in fixture.sessions))

    async def test_default_temporary_download_cleans_up_on_success_and_failure(self):
        for failure in (None, downloads.BrowserPdfRenderError("render failed")):
            with self.subTest(failure=bool(failure)):
                fixture = self._fixture("owned")
                session = SimpleNamespace(active=True)
                renderer = AsyncMock(return_value=b"%PDF-direct", side_effect=failure)
                delete = AsyncMock()
                with (
                    patch.object(downloads, "create_render_snapshot", new=AsyncMock(
                        return_value=(fixture.record, "signed-token"),
                    )),
                    patch.object(downloads, "delete_temporary_render_snapshot", new=delete),
                ):
                    if failure is None:
                        response = await downloads._render_snapshot_pdf_response(
                            session, "owner-1", fixture.snapshot, renderer, "direct.pdf",
                        )
                        self.assertEqual(response.body, b"%PDF-direct")
                        fixture.finalize.assert_awaited_once()
                    else:
                        with self.assertRaises(HTTPException) as caught:
                            await downloads._render_snapshot_pdf_response(
                                session, "owner-1", fixture.snapshot, renderer, "direct.pdf",
                            )
                        self.assertEqual(caught.exception.status_code, 502)
                        fixture.release.assert_awaited_once_with(session, "snapshot-1", "claim-1")
                    delete.assert_awaited_once_with(
                        session, "snapshot-1", "owner-1", claim_id="claim-1",
                    )
                self.assertEqual(fixture.sessions, [])
