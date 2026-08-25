from __future__ import annotations

import unittest
from unittest.mock import patch

from app.domain.export import pdf_payload
from app.domain.export.pdf_payload import RenderedPdfValidationError


class ExportPdfPayloadTests(unittest.TestCase):
    def test_accepts_a_nonempty_pdf_signature(self) -> None:
        payload = b"%PDF-1.7\n%%EOF"
        self.assertEqual(pdf_payload.validate_rendered_pdf_bytes(payload), payload)
        self.assertEqual(
            pdf_payload.validate_rendered_pdf_bytes(memoryview(payload)),
            payload,
        )

    def test_rejects_empty_non_pdf_and_oversized_payloads(self) -> None:
        with patch.object(pdf_payload, "MAX_RENDERED_PDF_BYTES", 16):
            invalid_payloads = (
                b"",
                b"not-a-pdf",
                b"%PDF-1.7" + (b"x" * 9),
            )
            for payload in invalid_payloads:
                with self.subTest(payload_prefix=payload[:12]):
                    with self.assertRaises(RenderedPdfValidationError):
                        pdf_payload.validate_rendered_pdf_bytes(payload)


if __name__ == "__main__":
    unittest.main()
