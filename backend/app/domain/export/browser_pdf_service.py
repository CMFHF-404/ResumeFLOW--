from __future__ import annotations

import asyncio
import sys
import time
from typing import Optional
from urllib.parse import unquote, urlencode, urlsplit

from playwright.async_api import (
    Browser,
    Error as PlaywrightError,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

from ...config import build_public_api_url, load_settings
from .limits import EXPORT_BROWSER_CLEANUP_GRACE_SECONDS, MAX_CONCURRENT_EXPORT_RENDERS
from .pdf_payload import RenderedPdfValidationError, validate_rendered_pdf_bytes

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
_render_semaphore_loop: asyncio.AbstractEventLoop | None = None
_render_semaphore: asyncio.Semaphore | None = None
_BROWSER_CHANNEL_FALLBACKS: tuple[str | None, ...] = (None, "chrome", "msedge")
_BROWSER_LAUNCH_ARGS = (
    "--disable-dev-shm-usage",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
)
_FRONTEND_STATIC_PATH_PREFIXES = (
    "/assets/",
    "/fonts/",
    "/resume-templates/",
    "/node_modules/",
    "/@vite/",
    "/@react-refresh",
    "/styles/",
    "/views/",
    "/components/",
    "/services/",
    "/utils/",
    "/constants/",
    "/types/",
    "/hooks/",
)
_FRONTEND_STATIC_EXACT_PATHS = {
    "/index.tsx",
    "/App.tsx",
    "/favicon.png",
    "/logo-mark-128.png",
}


class BrowserPdfRenderError(Exception):
    pass


class BrowserPdfRenderTimeoutError(BrowserPdfRenderError):
    pass


def _get_render_semaphore() -> asyncio.Semaphore:
    global _render_semaphore_loop, _render_semaphore

    loop = asyncio.get_running_loop()
    if _render_semaphore is None or _render_semaphore_loop is not loop:
        _render_semaphore_loop = loop
        _render_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXPORT_RENDERS)
    return _render_semaphore


def _release_threaded_render_slot(
    task: asyncio.Task[bytes],
    semaphore: asyncio.Semaphore,
) -> None:
    """Keep the process slot until the non-cancellable worker thread exits."""
    try:
        task.exception()
    except asyncio.CancelledError:
        pass
    finally:
        semaphore.release()


def _remaining_timeout_ms(deadline: float) -> float:
    return max(1.0, (deadline - time.monotonic()) * 1000)


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
            try:
                _playwright = await async_playwright().start()
            except PlaywrightError as exc:
                raise BrowserPdfRenderError(
                    "PDF 渲染浏览器运行时无法启动。"
                ) from exc

        _browser = await _launch_browser(_playwright)
        return _browser


async def _launch_browser(
    playwright: Playwright,
    launch_timeout_seconds: float | None = None,
) -> Browser:
    resolved_timeout_seconds = (
        float(launch_timeout_seconds)
        if launch_timeout_seconds is not None
        else float(load_settings().export_render_timeout_seconds)
    )
    deadline = time.monotonic() + max(0.001, resolved_timeout_seconds)
    last_error: PlaywrightError | None = None
    last_timeout_error: PlaywrightTimeoutError | None = None

    for channel in _BROWSER_CHANNEL_FALLBACKS:
        remaining_timeout_ms = max(0.0, (deadline - time.monotonic()) * 1000)
        if remaining_timeout_ms <= 0:
            break
        attempt_timeout_ms = max(1.0, remaining_timeout_ms)
        try:
            if channel is None:
                return await playwright.chromium.launch(
                    headless=True,
                    args=list(_BROWSER_LAUNCH_ARGS),
                    timeout=attempt_timeout_ms,
                )
            return await playwright.chromium.launch(
                channel=channel,
                headless=True,
                args=list(_BROWSER_LAUNCH_ARGS),
                timeout=attempt_timeout_ms,
            )
        except PlaywrightTimeoutError as exc:
            last_error = exc
            last_timeout_error = exc
        except PlaywrightError as exc:
            last_error = exc

    if last_timeout_error is not None or time.monotonic() >= deadline:
        raise BrowserPdfRenderTimeoutError("PDF 渲染浏览器启动超时。") from (
            last_timeout_error or last_error
        )

    raise BrowserPdfRenderError(
        "PDF 渲染浏览器不可用，请安装 Playwright Chromium 或系统 Chrome/Edge。"
    ) from last_error


def _build_page_url_for_path(snapshot_id: str, page_path: str) -> str:
    settings = load_settings()
    query = urlencode({"exportId": snapshot_id})
    normalized_page_path = page_path if page_path.startswith("/") else f"/{page_path}"
    return f"{settings.frontend_origin}{normalized_page_path}?{query}"


def _canonical_http_url(value: str) -> tuple[str, str, int, str, str, str] | None:
    """Return the browser-equivalent authority and exact URL components.

    Chromium lowercases ASCII DNS names and removes an explicitly configured
    default port before exposing ``request.url``. Compare those stable pieces
    while retaining the exact path, query, and fragment security boundary. Do
    not apply Python's legacy IDNA aliases: they can equate distinct WHATWG hosts.
    """
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname
    if (
        scheme not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None

    effective_port = port if port is not None else (443 if scheme == "https" else 80)
    return (
        scheme,
        hostname.lower(),
        effective_port,
        parsed.path or "/",
        parsed.query,
        parsed.fragment,
    )


def _snapshot_api_urls(snapshot_id: str, page_path: str) -> set[str]:
    settings = load_settings()
    endpoint = (
        "experience-bank-render-snapshots"
        if "experience-bank" in page_path
        else "render-snapshots"
    )
    path = f"/exports/{endpoint}/{snapshot_id}"
    return {
        build_public_api_url(settings.public_api_origin, path),
        # Vite development serves the public frontend at ``frontend_origin``
        # and exposes its backend proxy beneath /api. Keep that explicit local
        # route, but derive its path through the same trusted joining authority.
        build_public_api_url(f"{settings.frontend_origin.rstrip('/')}/api", path),
    }


def _is_snapshot_api_request(request_url: str, snapshot_id: str, page_path: str) -> bool:
    request_key = _canonical_http_url(request_url)
    if request_key is None:
        return False
    return request_key in {
        candidate_key
        for candidate in _snapshot_api_urls(snapshot_id, page_path)
        if (candidate_key := _canonical_http_url(candidate)) is not None
    }


def _is_allowed_export_page_request(request_url: str, page_url: str) -> bool:
    settings = load_settings()
    try:
        parsed = urlsplit(request_url)
    except ValueError:
        return False
    if parsed.scheme in {"data", "blob"}:
        return True
    request_key = _canonical_http_url(request_url)
    frontend_key = _canonical_http_url(settings.frontend_origin)
    if (
        request_key is None
        or frontend_key is None
        or request_key[:3] != frontend_key[:3]
    ):
        return False
    if request_key == _canonical_http_url(page_url):
        return True
    safe_path = _canonical_safe_frontend_path(parsed.path)
    if safe_path is None:
        return False
    return (
        safe_path in _FRONTEND_STATIC_EXACT_PATHS
        or any(safe_path.startswith(prefix) for prefix in _FRONTEND_STATIC_PATH_PREFIXES)
    )


def _canonical_safe_frontend_path(raw_path: str) -> str | None:
    current = raw_path or "/"
    for _ in range(3):
        lowered = current.lower()
        if "%2f" in lowered or "%5c" in lowered:
            return None
        try:
            decoded = unquote(current, errors="strict")
        except (UnicodeDecodeError, ValueError):
            return None
        if (
            not decoded.startswith("/")
            or "\\" in decoded
            or "//" in decoded
            or any(ord(character) < 32 for character in decoded)
            or any(segment in {".", ".."} for segment in decoded.split("/"))
        ):
            return None
        if decoded == current:
            return decoded
        current = decoded
    try:
        if unquote(current, errors="strict") != current:
            return None
    except (UnicodeDecodeError, ValueError):
        return None
    return current


async def _route_export_page_request(
    route,
    *,
    snapshot_id: str,
    token: str,
    page_path: str,
    page_url: str,
) -> None:
    request = route.request
    if _is_snapshot_api_request(request.url, snapshot_id, page_path):
        headers = dict(request.headers)
        headers["authorization"] = f"Bearer {token}"
        await route.continue_(headers=headers)
        return
    if _is_allowed_export_page_request(request.url, page_url):
        await route.continue_()
        return
    await route.abort("blockedbyclient")


async def _render_pdf_with_browser(
    browser: Browser,
    snapshot_id: str,
    token: str,
    page_path: str,
    *,
    deadline: float | None = None,
) -> bytes:
    settings = load_settings()
    page_url = _build_page_url_for_path(snapshot_id, page_path)
    resolved_deadline = deadline or (
        time.monotonic() + float(settings.export_render_timeout_seconds)
    )
    timeout_ms = _remaining_timeout_ms(resolved_deadline)
    context = None
    page = None

    try:
        context = await browser.new_context(
            color_scheme="light",
            locale="zh-CN",
            viewport={"width": 1280, "height": 1810},
            device_scale_factor=1,
            service_workers="block",
        )
        await context.route(
            "**/*",
            lambda route: _route_export_page_request(
                route,
                snapshot_id=snapshot_id,
                token=token,
                page_path=page_path,
                page_url=page_url,
            ),
        )
        route_web_socket = getattr(context, "route_web_socket", None)
        if callable(route_web_socket):
            await route_web_socket(
                "**/*",
                lambda web_socket_route: web_socket_route.close(),
            )
        page = await context.new_page()
        page.set_default_timeout(timeout_ms)
        await page.goto(
            page_url,
            wait_until="domcontentloaded",
            timeout=_remaining_timeout_ms(resolved_deadline),
        )
        await page.wait_for_selector(
            EXPORT_ROOT_SELECTOR,
            timeout=_remaining_timeout_ms(resolved_deadline),
        )
        await page.wait_for_function(
            READY_OR_ERROR_EXPRESSION,
            timeout=_remaining_timeout_ms(resolved_deadline),
        )

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
        if page is not None:
            try:
                error_message = await page.evaluate(READ_ERROR_EXPRESSION)
            except PlaywrightError:
                error_message = ""
        detail = error_message or "导出页面渲染超时。"
        raise BrowserPdfRenderTimeoutError(detail) from exc
    except PlaywrightError as exc:
        raise BrowserPdfRenderError("Chromium PDF 渲染失败。") from exc
    finally:
        if context is not None:
            context_close_failed = False
            try:
                await asyncio.wait_for(
                    context.close(),
                    timeout=EXPORT_BROWSER_CLEANUP_GRACE_SECONDS,
                )
            except (asyncio.TimeoutError, PlaywrightError):
                context_close_failed = True
            if context_close_failed:
                try:
                    await asyncio.wait_for(
                        browser.close(),
                        timeout=EXPORT_BROWSER_CLEANUP_GRACE_SECONDS,
                    )
                except (asyncio.TimeoutError, PlaywrightError):
                    pass


async def _render_pdf_shared_browser(
    snapshot_id: str,
    token: str,
    page_path: str,
    *,
    deadline: float,
) -> bytes:
    browser = await _get_browser()
    return await _render_pdf_with_browser(
        browser,
        snapshot_id,
        token,
        page_path,
        deadline=deadline,
    )


async def _render_pdf_ephemeral_browser(
    snapshot_id: str,
    token: str,
    page_path: str,
    *,
    deadline: float,
) -> bytes:
    try:
        playwright = await async_playwright().start()
    except PlaywrightError as exc:
        raise BrowserPdfRenderError("PDF 渲染浏览器运行时无法启动。") from exc
    browser: Optional[Browser] = None
    try:
        browser = await _launch_browser(
            playwright,
            launch_timeout_seconds=max(0.001, deadline - time.monotonic()),
        )
        return await _render_pdf_with_browser(
            browser,
            snapshot_id,
            token,
            page_path,
            deadline=deadline,
        )
    finally:
        if browser is not None:
            try:
                await asyncio.wait_for(
                    browser.close(),
                    timeout=EXPORT_BROWSER_CLEANUP_GRACE_SECONDS,
                )
            except (asyncio.TimeoutError, PlaywrightError):
                pass
        try:
            await asyncio.wait_for(
                playwright.stop(),
                timeout=EXPORT_BROWSER_CLEANUP_GRACE_SECONDS,
            )
        except (asyncio.TimeoutError, PlaywrightError):
            pass


def _render_pdf_in_worker_thread(
    snapshot_id: str,
    token: str,
    page_path: str,
    timeout_seconds: float,
) -> bytes:
    loop = _create_worker_event_loop()
    deadline = time.monotonic() + timeout_seconds

    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(
            asyncio.wait_for(
                _render_pdf_ephemeral_browser(
                    snapshot_id,
                    token,
                    page_path,
                    deadline=deadline,
                ),
                timeout=timeout_seconds,
            )
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
    timeout_seconds = float(load_settings().export_render_timeout_seconds)
    deadline = time.monotonic() + timeout_seconds

    async def render_with_process_slot() -> bytes:
        semaphore = _get_render_semaphore()
        await semaphore.acquire()
        if _should_use_threaded_render_fallback():
            # Cancelling ``await asyncio.to_thread(...)`` does not stop its
            # worker. Transfer ownership of the slot to the task's done
            # callback so timed-out/cancelled callers cannot oversubscribe
            # ephemeral Chromium processes while old workers are still alive.
            worker_task = asyncio.create_task(
                asyncio.to_thread(
                    _render_pdf_in_worker_thread,
                    snapshot_id,
                    token,
                    page_path,
                    max(0.001, deadline - time.monotonic()),
                )
            )
            worker_task.add_done_callback(
                lambda task: _release_threaded_render_slot(task, semaphore)
            )
            return await asyncio.shield(worker_task)
        try:
            return await _render_pdf_shared_browser(
                snapshot_id,
                token,
                page_path,
                deadline=deadline,
            )
        finally:
            semaphore.release()

    try:
        async with asyncio.timeout_at(deadline):
            pdf_bytes = await render_with_process_slot()
            try:
                return validate_rendered_pdf_bytes(pdf_bytes)
            except RenderedPdfValidationError as exc:
                raise BrowserPdfRenderError(str(exc)) from exc
    except TimeoutError as exc:
        raise BrowserPdfRenderTimeoutError("PDF 渲染总时限已到。") from exc
