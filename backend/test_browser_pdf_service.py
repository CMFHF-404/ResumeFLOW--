from __future__ import annotations

import asyncio
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.domain.export import browser_pdf_service
from app.domain.export.browser_pdf_service import (
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
    _build_page_url_for_path,
    _launch_browser,
    _route_export_page_request,
)


class BrowserPdfServiceTests(unittest.IsolatedAsyncioTestCase):
    def _settings(self):
        return SimpleNamespace(
            frontend_origin="https://app.example.test",
            public_api_origin="https://api.example.test",
        )

    def test_render_page_url_contains_only_export_id(self) -> None:
        with patch.object(browser_pdf_service, "load_settings", return_value=self._settings()):
            url = _build_page_url_for_path("snapshot-1", "/print/resume-export")

        self.assertEqual(
            url,
            "https://app.example.test/print/resume-export?exportId=snapshot-1",
        )
        self.assertNotIn("token", url)
        self.assertNotIn("fileName", url)

    async def test_route_injects_snapshot_token_only_into_exact_snapshot_api_request(self) -> None:
        request = SimpleNamespace(
            url="https://api.example.test/exports/render-snapshots/snapshot-1",
            headers={"accept": "application/json"},
        )
        route = SimpleNamespace(
            request=request,
            continue_=AsyncMock(),
            abort=AsyncMock(),
        )

        with patch.object(browser_pdf_service, "load_settings", return_value=self._settings()):
            await _route_export_page_request(
                route,
                snapshot_id="snapshot-1",
                token="snapshot-secret",
                page_path="/print/resume-export",
                page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
            )

        route.continue_.assert_awaited_once_with(
            headers={
                "accept": "application/json",
                "authorization": "Bearer snapshot-secret",
            }
        )
        route.abort.assert_not_awaited()

    async def test_route_derives_snapshot_allowlist_from_public_api_mount_prefix(self) -> None:
        endpoint = "/exports/render-snapshots/snapshot-1"
        for public_api_origin, request_url in (
            ("https://api.example.test", f"https://api.example.test{endpoint}"),
            ("https://api.example.test/api", f"https://api.example.test/api{endpoint}"),
            ("https://api.example.test/gateway", f"https://api.example.test/gateway{endpoint}"),
        ):
            with self.subTest(public_api_origin=public_api_origin):
                request = SimpleNamespace(url=request_url, headers={})
                route = SimpleNamespace(
                    request=request,
                    continue_=AsyncMock(),
                    abort=AsyncMock(),
                )
                settings = self._settings()
                settings.public_api_origin = public_api_origin

                with patch.object(browser_pdf_service, "load_settings", return_value=settings):
                    await _route_export_page_request(
                        route,
                        snapshot_id="snapshot-1",
                        token="snapshot-secret",
                        page_path="/print/resume-export",
                        page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
                    )

                route.continue_.assert_awaited_once_with(
                    headers={"authorization": "Bearer snapshot-secret"}
                )
                route.abort.assert_not_awaited()

    async def test_route_canonicalizes_snapshot_origin_like_chromium(self) -> None:
        route = SimpleNamespace(
            request=SimpleNamespace(
                url="https://api.example.test/api/exports/render-snapshots/snapshot-1",
                headers={"accept": "application/json"},
            ),
            continue_=AsyncMock(),
            abort=AsyncMock(),
        )
        settings = self._settings()
        settings.public_api_origin = "https://API.EXAMPLE.TEST:443/api"

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            await _route_export_page_request(
                route,
                snapshot_id="snapshot-1",
                token="snapshot-secret",
                page_path="/print/resume-export",
                page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
            )

        route.continue_.assert_awaited_once_with(
            headers={
                "accept": "application/json",
                "authorization": "Bearer snapshot-secret",
            }
        )
        route.abort.assert_not_awaited()

    async def test_route_canonicalizes_export_page_origin_like_chromium(self) -> None:
        route = SimpleNamespace(
            request=SimpleNamespace(
                url="https://app.example.test/print/resume-export?exportId=snapshot-1",
                headers={},
            ),
            continue_=AsyncMock(),
            abort=AsyncMock(),
        )
        settings = self._settings()
        settings.frontend_origin = "https://APP.EXAMPLE.TEST:443"

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            await _route_export_page_request(
                route,
                snapshot_id="snapshot-1",
                token="snapshot-secret",
                page_path="/print/resume-export",
                page_url=(
                    "https://APP.EXAMPLE.TEST:443/print/resume-export"
                    "?exportId=snapshot-1"
                ),
            )

        route.continue_.assert_awaited_once_with()
        route.abort.assert_not_awaited()

    async def test_route_does_not_equate_distinct_non_default_ports(self) -> None:
        route = SimpleNamespace(
            request=SimpleNamespace(
                url="https://api.example.test:444/api/exports/render-snapshots/snapshot-1",
                headers={},
            ),
            continue_=AsyncMock(),
            abort=AsyncMock(),
        )
        settings = self._settings()
        settings.public_api_origin = "https://API.EXAMPLE.TEST:443/api"

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            await _route_export_page_request(
                route,
                snapshot_id="snapshot-1",
                token="snapshot-secret",
                page_path="/print/resume-export",
                page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
            )

        route.continue_.assert_not_awaited()
        route.abort.assert_awaited_once_with("blockedbyclient")

    async def test_route_does_not_apply_non_browser_idna_aliases(self) -> None:
        settings = self._settings()
        settings.frontend_origin = "https://faß.example.test"

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            allowed = browser_pdf_service._is_allowed_export_page_request(
                "https://fass.example.test/assets/app.js",
                "https://faß.example.test/print/resume-export?exportId=snapshot-1",
            )

        self.assertFalse(allowed)

    async def test_route_blocks_snapshot_url_outside_configured_public_api_mount(self) -> None:
        route = SimpleNamespace(
            request=SimpleNamespace(
                url="https://api.example.test/exports/render-snapshots/snapshot-1",
                headers={},
            ),
            continue_=AsyncMock(),
            abort=AsyncMock(),
        )
        settings = self._settings()
        settings.public_api_origin = "https://api.example.test/gateway"

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            await _route_export_page_request(
                route,
                snapshot_id="snapshot-1",
                token="snapshot-secret",
                page_path="/print/resume-export",
                page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
            )

        route.continue_.assert_not_awaited()
        route.abort.assert_awaited_once_with("blockedbyclient")

    async def test_route_allows_local_assets_without_forwarding_snapshot_token(self) -> None:
        allowed_urls = (
            "https://app.example.test/assets/app-123.js",
            "https://app.example.test/resume-templates/deephire/band.png",
            "https://app.example.test/index.tsx?t=123",
            "https://app.example.test/@vite/client",
            "https://app.example.test/views/ResumePdfExportPage.tsx?t=123",
            "https://app.example.test/assets/font%20subset.woff2",
        )

        for allowed_url in allowed_urls:
            with self.subTest(url=allowed_url):
                request = SimpleNamespace(
                    url=allowed_url,
                    headers={"accept": "application/octet-stream"},
                )
                route = SimpleNamespace(request=request, continue_=AsyncMock(), abort=AsyncMock())

                with patch.object(browser_pdf_service, "load_settings", return_value=self._settings()):
                    await _route_export_page_request(
                        route,
                        snapshot_id="snapshot-1",
                        token="snapshot-secret",
                        page_path="/print/resume-export",
                        page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
                    )

                route.continue_.assert_awaited_once_with()
                route.abort.assert_not_awaited()

    async def test_route_blocks_avatar_ssrf_and_unlisted_network_requests(self) -> None:
        blocked_urls = (
            "http://127.0.0.1:8000/private.png",
            "http://169.254.169.254/latest/meta-data/",
            "https://cdn.example.test/tracker.png",
            "https://app.example.test/api/health",
            "https://api.example.test/exports/render-snapshots/other-snapshot",
            "https://api.example.test/exports/render-snapshots/snapshot-1?next=private",
            "https://app.example.test/assets/%2e%2e%2fapi/private",
            "https://app.example.test/assets/%252e%252e%252fapi/private",
            "https://app.example.test/assets//../api/private",
            "https://app.example.test/assets/%255c..%255capi/private",
            "https://app.example.test/assets/%00private.js",
        )

        for blocked_url in blocked_urls:
            with self.subTest(url=blocked_url):
                route = SimpleNamespace(
                    request=SimpleNamespace(url=blocked_url, headers={}),
                    continue_=AsyncMock(),
                    abort=AsyncMock(),
                )
                with patch.object(browser_pdf_service, "load_settings", return_value=self._settings()):
                    await _route_export_page_request(
                        route,
                        snapshot_id="snapshot-1",
                        token="snapshot-secret",
                        page_path="/print/resume-export",
                        page_url="https://app.example.test/print/resume-export?exportId=snapshot-1",
                    )
                route.continue_.assert_not_awaited()
                route.abort.assert_awaited_once_with("blockedbyclient")

    async def test_launch_browser_falls_back_to_system_chrome(self) -> None:
        browser = object()
        launch = AsyncMock(
            side_effect=[
                PlaywrightError("bundled Chromium is missing"),
                browser,
            ]
        )
        playwright = SimpleNamespace(chromium=SimpleNamespace(launch=launch))

        result = await _launch_browser(playwright, launch_timeout_seconds=45)

        self.assertIs(result, browser)
        self.assertEqual(launch.await_count, 2)
        self.assertNotIn("channel", launch.await_args_list[0].kwargs)
        self.assertEqual(launch.await_args_list[1].kwargs["channel"], "chrome")

    async def test_launch_browser_reports_supported_recovery_after_all_failures(self) -> None:
        launch = AsyncMock(
            side_effect=[
                PlaywrightError("bundled Chromium is missing"),
                PlaywrightError("Chrome is missing"),
                PlaywrightError("Edge is missing"),
            ]
        )
        playwright = SimpleNamespace(chromium=SimpleNamespace(launch=launch))

        with self.assertRaisesRegex(
            BrowserPdfRenderError,
            "Playwright Chromium.*Chrome/Edge",
        ):
            await _launch_browser(playwright, launch_timeout_seconds=45)

        self.assertEqual(
            [call.kwargs.get("channel") for call in launch.await_args_list],
            [None, "chrome", "msedge"],
        )

    async def test_launch_browser_shares_timeout_budget_and_preserves_timeout_type(self) -> None:
        launch = AsyncMock(
            side_effect=[
                PlaywrightTimeoutError("bundled Chromium timed out"),
                PlaywrightTimeoutError("Chrome timed out"),
                PlaywrightTimeoutError("Edge timed out"),
            ]
        )
        playwright = SimpleNamespace(chromium=SimpleNamespace(launch=launch))

        with patch.object(
            browser_pdf_service.time,
            "monotonic",
            side_effect=[0.0, 0.0, 15.0, 30.0, 45.0],
        ):
            with self.assertRaisesRegex(
                BrowserPdfRenderTimeoutError,
                "浏览器启动超时",
            ):
                await _launch_browser(playwright, launch_timeout_seconds=45)

        self.assertEqual(launch.await_count, 3)
        self.assertEqual(
            [call.kwargs["timeout"] for call in launch.await_args_list],
            [45000.0, 30000.0, 15000.0],
        )

    async def test_total_deadline_includes_waiting_for_process_slot(self) -> None:
        settings = self._settings()
        settings.export_render_timeout_seconds = 0.02
        blocked_semaphore = asyncio.Semaphore(0)

        with (
            patch.object(browser_pdf_service, "load_settings", return_value=settings),
            patch.object(
                browser_pdf_service,
                "_get_render_semaphore",
                return_value=blocked_semaphore,
            ),
            patch.object(
                browser_pdf_service,
                "_render_pdf_shared_browser",
                new=AsyncMock(),
            ) as renderer,
        ):
            with self.assertRaises(BrowserPdfRenderTimeoutError):
                await browser_pdf_service.render_export_pdf(
                    "snapshot-1",
                    "token",
                    "/print/resume-export",
                )

        renderer.assert_not_awaited()

    async def test_process_semaphore_bounds_concurrent_renderers(self) -> None:
        settings = self._settings()
        settings.export_render_timeout_seconds = 1
        active = 0
        max_active = 0

        async def renderer(*_args, **_kwargs) -> bytes:
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            active -= 1
            return b"%PDF-1.7"

        with (
            patch.object(browser_pdf_service, "load_settings", return_value=settings),
            patch.object(browser_pdf_service, "MAX_CONCURRENT_EXPORT_RENDERS", 2),
            patch.object(browser_pdf_service, "_render_semaphore", None),
            patch.object(browser_pdf_service, "_render_semaphore_loop", None),
            patch.object(
                browser_pdf_service,
                "_should_use_threaded_render_fallback",
                return_value=False,
            ),
            patch.object(
                browser_pdf_service,
                "_render_pdf_shared_browser",
                new=renderer,
            ),
        ):
            results = await asyncio.gather(
                *(
                    browser_pdf_service.render_export_pdf(
                        f"snapshot-{index}",
                        "token",
                        "/print/resume-export",
                    )
                    for index in range(6)
                )
            )

        self.assertEqual(results, [b"%PDF-1.7"] * 6)
        self.assertEqual(max_active, 2)

    async def test_threaded_timeout_holds_slots_until_workers_really_finish(self) -> None:
        settings = self._settings()
        settings.export_render_timeout_seconds = 0.2
        release_workers = threading.Event()
        four_started = threading.Event()
        started: list[str] = []
        started_lock = threading.Lock()

        def threaded_renderer(snapshot_id, *_args) -> bytes:
            with started_lock:
                started.append(snapshot_id)
                if len(started) == 4:
                    four_started.set()
            release_workers.wait(timeout=2)
            return b"%PDF-threaded"

        with (
            patch.object(browser_pdf_service, "load_settings", return_value=settings),
            patch.object(browser_pdf_service, "MAX_CONCURRENT_EXPORT_RENDERS", 4),
            patch.object(browser_pdf_service, "_render_semaphore", None),
            patch.object(browser_pdf_service, "_render_semaphore_loop", None),
            patch.object(
                browser_pdf_service,
                "_should_use_threaded_render_fallback",
                return_value=True,
            ),
            patch.object(
                browser_pdf_service,
                "_render_pdf_in_worker_thread",
                new=threaded_renderer,
            ),
        ):
            initial_tasks = [
                asyncio.create_task(
                    browser_pdf_service.render_export_pdf(
                        f"snapshot-{index}",
                        "token",
                        "/print/resume-export",
                    )
                )
                for index in range(4)
            ]
            self.assertTrue(
                await asyncio.to_thread(four_started.wait, 1),
                "four worker threads should start before their request deadlines",
            )
            results = await asyncio.gather(*initial_tasks, return_exceptions=True)
            self.assertTrue(
                all(isinstance(result, BrowserPdfRenderTimeoutError) for result in results)
            )

            fifth = asyncio.create_task(
                browser_pdf_service.render_export_pdf(
                    "snapshot-5",
                    "token",
                    "/print/resume-export",
                )
            )
            await asyncio.sleep(0.03)
            with started_lock:
                self.assertEqual(len(started), 4)

            release_workers.set()
            self.assertEqual(await fifth, b"%PDF-threaded")
            with started_lock:
                self.assertEqual(len(started), 5)

    async def test_threaded_cancellation_defers_release_and_consumes_late_errors(self) -> None:
        settings = self._settings()
        settings.export_render_timeout_seconds = 1
        release_workers = threading.Event()
        four_started = threading.Event()
        started: list[str] = []
        started_lock = threading.Lock()
        loop_errors: list[dict] = []
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()

        def threaded_renderer(snapshot_id, *_args) -> bytes:
            with started_lock:
                started.append(snapshot_id)
                ordinal = len(started)
                if ordinal == 4:
                    four_started.set()
            if ordinal <= 4:
                release_workers.wait(timeout=2)
                raise RuntimeError("late worker failure")
            return b"%PDF-threaded"

        loop.set_exception_handler(lambda _loop, context: loop_errors.append(context))
        try:
            with (
                patch.object(browser_pdf_service, "load_settings", return_value=settings),
                patch.object(browser_pdf_service, "MAX_CONCURRENT_EXPORT_RENDERS", 4),
                patch.object(browser_pdf_service, "_render_semaphore", None),
                patch.object(browser_pdf_service, "_render_semaphore_loop", None),
                patch.object(
                    browser_pdf_service,
                    "_should_use_threaded_render_fallback",
                    return_value=True,
                ),
                patch.object(
                    browser_pdf_service,
                    "_render_pdf_in_worker_thread",
                    new=threaded_renderer,
                ),
            ):
                initial_tasks = [
                    asyncio.create_task(
                        browser_pdf_service.render_export_pdf(
                            f"snapshot-{index}",
                            "token",
                            "/print/resume-export",
                        )
                    )
                    for index in range(4)
                ]
                self.assertTrue(await asyncio.to_thread(four_started.wait, 1))
                for task in initial_tasks:
                    task.cancel()
                results = await asyncio.gather(
                    *initial_tasks,
                    return_exceptions=True,
                )
                self.assertTrue(
                    all(isinstance(result, asyncio.CancelledError) for result in results)
                )

                fifth = asyncio.create_task(
                    browser_pdf_service.render_export_pdf(
                        "snapshot-5",
                        "token",
                        "/print/resume-export",
                    )
                )
                await asyncio.sleep(0.03)
                with started_lock:
                    self.assertEqual(len(started), 4)

                release_workers.set()
                self.assertEqual(await fifth, b"%PDF-threaded")
                await asyncio.sleep(0.03)
                self.assertEqual(loop_errors, [])
        finally:
            release_workers.set()
            loop.set_exception_handler(previous_handler)

    async def test_browser_runtime_start_failure_maps_to_stable_render_error(self) -> None:
        runtime = SimpleNamespace(
            start=AsyncMock(side_effect=PlaywrightError("runtime missing"))
        )
        with (
            patch.object(browser_pdf_service, "_playwright", None),
            patch.object(browser_pdf_service, "_browser", None),
            patch.object(
                browser_pdf_service,
                "async_playwright",
                return_value=runtime,
            ),
        ):
            with self.assertRaisesRegex(
                BrowserPdfRenderError,
                "浏览器运行时无法启动",
            ):
                await browser_pdf_service._get_browser()

    async def test_context_routing_blocks_websockets_and_closes_after_render(self) -> None:
        page = SimpleNamespace(
            set_default_timeout=Mock(),
            goto=AsyncMock(),
            wait_for_selector=AsyncMock(),
            wait_for_function=AsyncMock(),
            evaluate=AsyncMock(side_effect=["", None]),
            emulate_media=AsyncMock(),
            wait_for_timeout=AsyncMock(),
            pdf=AsyncMock(return_value=b"%PDF-1.7"),
        )
        context = SimpleNamespace(
            route=AsyncMock(),
            route_web_socket=AsyncMock(),
            new_page=AsyncMock(return_value=page),
            close=AsyncMock(),
        )
        browser = SimpleNamespace(
            new_context=AsyncMock(return_value=context),
            close=AsyncMock(),
        )
        settings = self._settings()
        settings.export_render_timeout_seconds = 1

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            result = await browser_pdf_service._render_pdf_with_browser(
                browser,
                "snapshot-1",
                "token",
                "/print/resume-export",
                deadline=time.monotonic() + 1,
            )

        self.assertEqual(result, b"%PDF-1.7")
        context.route.assert_awaited_once()
        context.route_web_socket.assert_awaited_once()
        context.close.assert_awaited_once()
        browser.close.assert_not_awaited()

    async def test_page_creation_failure_closes_context(self) -> None:
        context = SimpleNamespace(
            route=AsyncMock(),
            new_page=AsyncMock(side_effect=PlaywrightError("new page failed")),
            close=AsyncMock(),
        )
        browser = SimpleNamespace(
            new_context=AsyncMock(return_value=context),
            close=AsyncMock(),
        )
        settings = self._settings()
        settings.export_render_timeout_seconds = 1

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            with self.assertRaises(BrowserPdfRenderError):
                await browser_pdf_service._render_pdf_with_browser(
                    browser,
                    "snapshot-1",
                    "token",
                    "/print/resume-export",
                    deadline=time.monotonic() + 1,
                )

        context.close.assert_awaited_once()

    async def test_context_close_failure_invalidates_browser(self) -> None:
        context = SimpleNamespace(
            route=AsyncMock(),
            new_page=AsyncMock(side_effect=PlaywrightError("new page failed")),
            close=AsyncMock(side_effect=PlaywrightError("close failed")),
        )
        browser = SimpleNamespace(
            new_context=AsyncMock(return_value=context),
            close=AsyncMock(),
        )
        settings = self._settings()
        settings.export_render_timeout_seconds = 1

        with patch.object(browser_pdf_service, "load_settings", return_value=settings):
            with self.assertRaises(BrowserPdfRenderError):
                await browser_pdf_service._render_pdf_with_browser(
                    browser,
                    "snapshot-1",
                    "token",
                    "/print/resume-export",
                    deadline=time.monotonic() + 1,
                )

        browser.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
