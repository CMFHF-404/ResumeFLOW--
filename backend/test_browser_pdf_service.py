from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.domain.export import browser_pdf_service
from app.domain.export.browser_pdf_service import (
    BrowserPdfRenderError,
    BrowserPdfRenderTimeoutError,
    _launch_browser,
)


class BrowserPdfServiceTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
