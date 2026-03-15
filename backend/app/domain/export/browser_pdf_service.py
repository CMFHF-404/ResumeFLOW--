from __future__ import annotations

import asyncio
import sys
from typing import Optional
from urllib.parse import urlencode

from playwright.async_api import (
    Browser,
    Error as PlaywrightError,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from ...config import load_settings

EXPORT_ROOT_SELECTOR = '[data-rf-export-root="true"]'
READY_OR_ERROR_EXPRESSION = """
() => {
    const body = document.body;
    if (!body) {
        return false;
    }
    return body.dataset.rfExportReady === 'true' || Boolean(body.dataset.rfExportError);
}
"""
READ_ERROR_EXPRESSION = "() => document.body?.dataset?.rfExportError ?? ''"

_browser_lock = asyncio.Lock()
_playwright: Optional[Playwright] = None
_browser: Optional[Browser] = None


class BrowserPdfRenderError(Exception):
    pass


class BrowserPdfRenderTimeoutError(BrowserPdfRenderError):
    pass


def _should_use_threaded_render_fallback() -> bool:
    if sys.platform != "win32":
        return False

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False

    selector_loop_type = getattr(asyncio, "SelectorEventLoop", None)
    if selector_loop_type and isinstance(loop, selector_loop_type):
        return True

    return "selector" in loop.__class__.__name__.lower()


def _create_worker_event_loop() -> asyncio.AbstractEventLoop:
    """
    在工作线程中创建事件循环。

    Windows 上 Playwright 需要启动浏览器子进程（create_subprocess_exec），
    而只有 ProactorEventLoop 支持此操作，SelectorEventLoop（默认）不支持。
    因此在 Windows 上必须强制使用 WindowsProactorEventLoopPolicy。
    """
    if sys.platform == "win32" and hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
        return asyncio.WindowsProactorEventLoopPolicy().new_event_loop()
    return asyncio.new_event_loop()


async def _get_browser() -> Browser:
    global _playwright, _browser

    if _browser and _browser.is_connected():
        return _browser

    async with _browser_lock:
        if _browser and _browser.is_connected():
            return _browser

        if _playwright is None:
            _playwright = await async_playwright().start()

        _browser = await _playwright.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage"],
        )
        return _browser


async def _launch_browser(playwright: Playwright) -> Browser:
    return await playwright.chromium.launch(
        headless=True,
        args=["--disable-dev-shm-usage"],
    )


def _build_page_url_for_path(snapshot_id: str, token: str, page_path: str) -> str:
    settings = load_settings()
    query = urlencode({"exportId": snapshot_id, "token": token})
    normalized_page_path = page_path if page_path.startswith("/") else f"/{page_path}"
    return f"{settings.frontend_origin}{normalized_page_path}?{query}"


async def _render_pdf_with_browser(
    browser: Browser,
    snapshot_id: str,
    token: str,
    page_path: str,
) -> bytes:
    settings = load_settings()
    page_url = _build_page_url_for_path(snapshot_id, token, page_path)
    timeout_ms = settings.export_render_timeout_seconds * 1000
    context = await browser.new_context(
        color_scheme="light",
        locale="zh-CN",
        viewport={"width": 1280, "height": 1810},
        device_scale_factor=1,
    )
    page = await context.new_page()
    page.set_default_timeout(timeout_ms)

    try:
        await page.goto(page_url, wait_until="domcontentloaded", timeout=timeout_ms)
        await page.wait_for_selector(EXPORT_ROOT_SELECTOR, timeout=timeout_ms)
        await page.wait_for_function(READY_OR_ERROR_EXPRESSION, timeout=timeout_ms)

        error_message = await page.evaluate(READ_ERROR_EXPRESSION)
        if error_message:
            raise BrowserPdfRenderError(str(error_message))

        await page.evaluate(
            """
            async () => {
                if (document.fonts?.ready) {
                    await document.fonts.ready;
                }
            }
            """
        )
        await page.emulate_media(media="print")
        await page.wait_for_timeout(50)

        return await page.pdf(
            format="A4",
            print_background=True,
            prefer_css_page_size=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
    except PlaywrightTimeoutError as exc:
        error_message = ""
        try:
            error_message = await page.evaluate(READ_ERROR_EXPRESSION)
        except PlaywrightError:
            error_message = ""
        detail = error_message or "导出页面渲染超时。"
        raise BrowserPdfRenderTimeoutError(detail) from exc
    except PlaywrightError as exc:
        raise BrowserPdfRenderError("Chromium PDF 渲染失败。") from exc
    finally:
        await context.close()


async def _render_pdf_shared_browser(
    snapshot_id: str,
    token: str,
    page_path: str,
) -> bytes:
    browser = await _get_browser()
    return await _render_pdf_with_browser(browser, snapshot_id, token, page_path)


async def _render_pdf_ephemeral_browser(
    snapshot_id: str,
    token: str,
    page_path: str,
) -> bytes:
    playwright = await async_playwright().start()
    browser: Optional[Browser] = None
    try:
        browser = await _launch_browser(playwright)
        return await _render_pdf_with_browser(browser, snapshot_id, token, page_path)
    finally:
        if browser is not None:
            await browser.close()
        await playwright.stop()


def _render_pdf_in_worker_thread(snapshot_id: str, token: str, page_path: str) -> bytes:
    loop = _create_worker_event_loop()

    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(
            _render_pdf_ephemeral_browser(snapshot_id, token, page_path)
        )
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        asyncio.set_event_loop(None)
        loop.close()


async def close_browser() -> None:
    global _playwright, _browser

    async with _browser_lock:
        if _browser is not None:
            await _browser.close()
            _browser = None

        if _playwright is not None:
            await _playwright.stop()
            _playwright = None


async def render_resume_pdf(snapshot_id: str, token: str) -> bytes:
    return await render_export_pdf(snapshot_id, token, "/print/resume-export")


async def render_experience_bank_pdf(snapshot_id: str, token: str) -> bytes:
    return await render_export_pdf(
        snapshot_id,
        token,
        "/print/experience-bank-export",
    )


async def render_export_pdf(snapshot_id: str, token: str, page_path: str) -> bytes:
    if _should_use_threaded_render_fallback():
        return await asyncio.to_thread(
            _render_pdf_in_worker_thread,
            snapshot_id,
            token,
            page_path,
        )

    return await _render_pdf_shared_browser(snapshot_id, token, page_path)
