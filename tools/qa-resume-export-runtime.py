"""Probe the real backend renderer against a running local Vite server.

Run from backend/: python -B ../tools/qa-resume-export-runtime.py
Only the synthetic snapshot response is intercepted; resource policy, Vite
modules, readiness, browser selection and PDF printing use production code.
No database records, account credentials or user resume content are used.
"""
import asyncio
from pathlib import Path
import sys
import time
from unittest.mock import patch
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.domain.export import browser_pdf_service as service
from app.domain.export.pdf_payload import enforce_resume_pdf_page_limit
from app.domain.export.schemas import ResumeEditorProfileSnapshot, ResumePdfRenderSnapshot


async def main():
    snapshot = ResumePdfRenderSnapshot(
        resumeName="Runtime probe",
        profile=ResumeEditorProfileSnapshot(name="Runtime probe"),
        lineHeight=1.35,
        fontSize=13,
        listSpacingValue="0.25em",
        bulletSpacingValue="0.1em",
        topPaddingPx=15,
        sectionSpacingClass="mb-2",
        listSpacingClass="space-y-2",
    )
    original_route = service._route_export_page_request
    module_requested = False
    snapshot_requested = False

    async def route(request_route, **kwargs):
        nonlocal module_requested, snapshot_requested
        url = request_route.request.url
        if service._is_snapshot_api_request(url, "runtime-probe", "/print/resume-export"):
            snapshot_requested = True
            await request_route.fulfill(json={"snapshot": snapshot.model_dump(mode="json")})
            return
        if urlsplit(url).path == "/types.ts":
            module_requested = True
        await original_route(request_route, **kwargs)

    started = time.monotonic()
    try:
        with patch.object(service, "_route_export_page_request", new=route):
            pdf = await service.render_resume_pdf("runtime-probe", "synthetic-probe-token")
        assert module_requested, "Expected Vite to request the root runtime types module"
        assert snapshot_requested, "Export page did not load the synthetic snapshot"
        assert enforce_resume_pdf_page_limit(pdf, 1) == 1
        print(f"PASS: Vite /types.ts loaded; backend rendered 1 PDF page in {time.monotonic() - started:.2f}s")
    finally:
        await service.close_browser()


if __name__ == "__main__":
    asyncio.run(main())
