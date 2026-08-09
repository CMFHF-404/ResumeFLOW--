from __future__ import annotations

import unittest

from app.domain.export.schemas import (
    RenderSnapshotRead,
    ResumeEditorProfileSnapshot,
    ResumePdfExportRequest,
    ResumePdfRenderSnapshot,
)


class ExportSnapshotContractTests(unittest.TestCase):
    def test_resume_pdf_target_role_survives_request_and_response_round_trip(self) -> None:
        snapshot = ResumePdfRenderSnapshot(
            resumeName="内部简历标题",
            targetRole="AI 产品经理",
            profile=ResumeEditorProfileSnapshot(name="林澈"),
            lineHeight=1.4,
            fontSize=13,
            listSpacingValue="0.3em",
            bulletSpacingValue="0.15em",
            topPaddingPx=42,
            sectionSpacingClass="mb-3",
            listSpacingClass="space-y-2",
        )

        request_payload = ResumePdfExportRequest(snapshot=snapshot).model_dump(mode="json")
        response = RenderSnapshotRead.model_validate({"snapshot": request_payload["snapshot"]})

        self.assertEqual(request_payload["snapshot"]["targetRole"], "AI 产品经理")
        self.assertEqual(response.snapshot.targetRole, "AI 产品经理")

    def test_legacy_resume_pdf_snapshot_defaults_target_role_to_empty(self) -> None:
        snapshot = ResumePdfRenderSnapshot(
            resumeName="旧快照",
            profile=ResumeEditorProfileSnapshot(name="林澈"),
            lineHeight=1.4,
            fontSize=13,
            listSpacingValue="0.3em",
            bulletSpacingValue="0.15em",
            topPaddingPx=42,
            sectionSpacingClass="mb-3",
            listSpacingClass="space-y-2",
        )

        self.assertEqual(snapshot.targetRole, "")


if __name__ == "__main__":
    unittest.main()
