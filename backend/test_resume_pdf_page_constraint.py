from io import BytesIO
import unittest
from pypdf import PdfWriter
from app.domain.export.pdf_payload import enforce_resume_pdf_page_limit, PdfPageCountMismatchError, RenderedPdfValidationError

def make_pdf(page_count):
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=595, height=842)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()

class ResumePdfPageConstraintTests(unittest.TestCase):
    def test_constraint_is_optional_persisted_and_limited_to_one(self):
        from pydantic import ValidationError
        from app.domain.export.schemas import ResumePdfPageConstraint, ResumePdfRenderSnapshot
        from test_export_http_compatibility import _snapshot
        snapshot = _snapshot()
        self.assertIsNone(snapshot.pageConstraint)
        snapshot.pageConstraint = ResumePdfPageConstraint(maxPages=1)
        restored = ResumePdfRenderSnapshot.model_validate(snapshot.model_dump(mode='json'))
        self.assertEqual(restored.pageConstraint.maxPages, 1)
        for count in (0, 2, -1, '1'):
            with self.assertRaises(ValidationError):
                ResumePdfPageConstraint(maxPages=count)

    def test_real_page_counts(self):
        self.assertEqual(enforce_resume_pdf_page_limit(make_pdf(1), 1), 1)
        self.assertEqual(enforce_resume_pdf_page_limit(make_pdf(2), None), 2)
        with self.assertRaises(PdfPageCountMismatchError):
            enforce_resume_pdf_page_limit(make_pdf(2), 1)

    def test_malformed_pdf_is_controlled(self):
        for value in (b'', b'%PDF-invalid', make_pdf(0)):
            with self.assertRaises(RenderedPdfValidationError):
                enforce_resume_pdf_page_limit(value, 1)
