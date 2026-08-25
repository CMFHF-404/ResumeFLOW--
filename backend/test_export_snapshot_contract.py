from __future__ import annotations

import base64
from datetime import datetime, timezone
import io
import math
import unittest
from unittest.mock import patch

from PIL import Image
from PIL.PngImagePlugin import PngImageFile
from pydantic import ValidationError

from app.domain.export.schemas import (
    ExperienceBankPdfExportRequest,
    ExperienceBankPdfRenderSnapshot,
    RenderSnapshotRead,
    ResumeEditorProfileSnapshot,
    ResumePdfExportRequest,
    ResumePdfRenderSnapshot,
)
from app.domain.export.download_contract import MAX_EXPORT_FILE_NAME_CHARACTERS
from app.domain.export.limits import (
    MAX_EXPORT_SECTION_ORDER_ITEMS,
    MAX_EXPORT_SHORT_TEXT_CHARACTERS,
)


class ExportSnapshotContractTests(unittest.TestCase):
    @staticmethod
    def _image_data_url(
        image_format: str,
        mime_type: str,
        size: tuple[int, int] = (2, 2),
    ) -> str:
        buffer = io.BytesIO()
        Image.new("RGB", size, (12, 34, 56)).save(buffer, format=image_format)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    @staticmethod
    def _animated_image_data_url(image_format: str, mime_type: str) -> str:
        buffer = io.BytesIO()
        first_frame = Image.new("RGB", (2, 2), (255, 0, 0))
        second_frame = Image.new("RGB", (2, 2), (0, 255, 0))
        first_frame.save(
            buffer,
            format=image_format,
            save_all=True,
            append_images=[second_frame],
            duration=100,
            loop=0,
        )
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

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

    def test_export_request_file_names_have_a_shared_bounded_contract(self) -> None:
        bounded_name = "a" * MAX_EXPORT_FILE_NAME_CHARACTERS
        resume_request = ResumePdfExportRequest(
            snapshot=ResumePdfRenderSnapshot(
                resumeName="bounded",
                profile=ResumeEditorProfileSnapshot(),
                lineHeight=1.4,
                fontSize=13,
                listSpacingValue="0.3em",
                bulletSpacingValue="0.15em",
                topPaddingPx=42,
                sectionSpacingClass="mb-3",
                listSpacingClass="space-y-2",
            ),
            fileName=bounded_name,
        )
        bank_request = ExperienceBankPdfExportRequest(
            snapshot=ExperienceBankPdfRenderSnapshot(),
            fileName=bounded_name,
        )
        self.assertEqual(resume_request.fileName, bounded_name)
        self.assertEqual(bank_request.fileName, bounded_name)

        oversized_name = "a" * (MAX_EXPORT_FILE_NAME_CHARACTERS + 1)
        for request_model, snapshot in (
            (ResumePdfExportRequest, resume_request.snapshot),
            (ExperienceBankPdfExportRequest, bank_request.snapshot),
        ):
            with self.subTest(request_model=request_model.__name__):
                with self.assertRaises(ValidationError):
                    request_model(snapshot=snapshot, fileName=oversized_name)

    def test_resume_snapshot_rejects_unbounded_text_lists_and_numbers(self) -> None:
        base_payload = {
            "resumeName": "bounded",
            "profile": {},
            "lineHeight": 1.4,
            "fontSize": 13,
            "listSpacingValue": "0.3em",
            "bulletSpacingValue": "0.15em",
            "topPaddingPx": 42,
            "sectionSpacingClass": "mb-3",
            "listSpacingClass": "space-y-2",
        }
        invalid_payloads = (
            {**base_payload, "resumeName": "x" * (MAX_EXPORT_SHORT_TEXT_CHARACTERS + 1)},
            {
                **base_payload,
                "sectionOrder": [
                    f"section-{index}"
                    for index in range(MAX_EXPORT_SECTION_ORDER_ITEMS + 1)
                ],
            },
            {**base_payload, "lineHeight": math.nan},
            {**base_payload, "fontSize": math.inf},
            {**base_payload, "topPaddingPx": 501},
            {**base_payload, "resumeName": "bad\x00name"},
            {**base_payload, "resumeName": "\ud800"},
            {**base_payload, "resumeName": "\udfff"},
        )

        for payload in invalid_payloads:
            with self.subTest(field_values=payload), self.assertRaises(ValidationError):
                ResumePdfRenderSnapshot.model_validate(payload)

        astral = ResumePdfRenderSnapshot.model_validate(
            {**base_payload, "resumeName": "工程师😀"}
        )
        self.assertEqual(astral.resumeName, "工程师😀")

    def test_experience_bank_rejects_non_json_nested_values_and_depth(self) -> None:
        profile_base = {
            "user_id": "user-1",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        nested_too_deep: object = "leaf"
        for _ in range(14):
            nested_too_deep = {"child": nested_too_deep}

        invalid_values = (
            math.nan,
            math.inf,
            "bad\x00value",
            "\ud800",
            nested_too_deep,
        )
        for value in invalid_values:
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(ValidationError):
                    ExperienceBankPdfRenderSnapshot.model_validate(
                        {
                            "profile": {
                                **profile_base,
                                "extra_json": {"nested": value},
                            }
                        }
                    )

    def test_avatar_accepts_small_real_png_jpeg_and_webp_data_urls(self) -> None:
        fixtures = (
            self._image_data_url("PNG", "image/png"),
            self._image_data_url("JPEG", "image/jpeg"),
            self._image_data_url("WEBP", "image/webp"),
        )

        for fixture in fixtures:
            with self.subTest(prefix=fixture[:30]):
                profile = ResumeEditorProfileSnapshot(avatarDataUrl=fixture)
                self.assertEqual(profile.avatarDataUrl, fixture)

    def test_avatar_rejects_network_file_svg_and_malformed_data_urls(self) -> None:
        unsafe_values = (
            "http://127.0.0.1:8000/internal.png",
            "https://example.com/avatar.png",
            "file:///etc/passwd",
            "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
            "data:image/png;base64,not-valid-@@",
        )

        for value in unsafe_values:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    ResumeEditorProfileSnapshot(avatarDataUrl=value)

    def test_avatar_rejects_mime_mismatch_oversized_bytes_and_dimensions(self) -> None:
        png_as_jpeg = self._image_data_url("PNG", "image/jpeg")
        png_as_webp = self._image_data_url("PNG", "image/webp")
        oversized_bytes = "data:image/png;base64," + base64.b64encode(
            b"x" * (2 * 1024 * 1024 + 1)
        ).decode("ascii")
        oversized_dimensions = self._image_data_url("PNG", "image/png", (2049, 1))

        for value in (png_as_jpeg, png_as_webp, oversized_bytes, oversized_dimensions):
            with self.subTest(prefix=value[:30]):
                with self.assertRaises(ValidationError):
                    ResumeEditorProfileSnapshot(avatarDataUrl=value)

    def test_avatar_rejects_animated_webp_and_apng_before_rendering(self) -> None:
        fixtures = (
            self._animated_image_data_url("WEBP", "image/webp"),
            self._animated_image_data_url("PNG", "image/png"),
        )

        for fixture in fixtures:
            with self.subTest(prefix=fixture[:30]):
                payload = base64.b64decode(fixture.split(",", 1)[1], validate=True)
                with Image.open(io.BytesIO(payload)) as image:
                    self.assertTrue(image.is_animated)
                    self.assertEqual(image.n_frames, 2)
                    image.seek(0)
                    first_pixel = image.convert("RGB").getpixel((0, 0))
                    self.assertGreater(first_pixel[0], first_pixel[1])
                    self.assertGreater(first_pixel[0], first_pixel[2])
                    image.seek(1)
                    second_pixel = image.convert("RGB").getpixel((0, 0))
                    self.assertGreater(second_pixel[1], second_pixel[0])
                    self.assertGreater(second_pixel[1], second_pixel[2])

                with self.assertRaisesRegex(
                    ValidationError,
                    "头像 data URI 不包含可安全使用的有效图片。",
                ):
                    ResumeEditorProfileSnapshot(avatarDataUrl=fixture)

    def test_avatar_dimension_gate_runs_before_pillow_verify(self) -> None:
        oversized_dimensions = self._image_data_url("PNG", "image/png", (2049, 1))

        with patch.object(
            PngImageFile,
            "verify",
            side_effect=AssertionError("verify must not run for oversized headers"),
        ) as verify:
            with self.assertRaises(ValidationError):
                ResumeEditorProfileSnapshot(avatarDataUrl=oversized_dimensions)

        verify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
