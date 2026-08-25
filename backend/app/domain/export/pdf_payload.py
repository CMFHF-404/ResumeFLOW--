from __future__ import annotations

from .limits import MAX_RENDERED_PDF_BYTES


class RenderedPdfValidationError(ValueError):
    pass


def validate_rendered_pdf_bytes(value: bytes | bytearray | memoryview) -> bytes:
    pdf_bytes = bytes(value)
    if not pdf_bytes:
        raise RenderedPdfValidationError("PDF 渲染结果为空。")
    if len(pdf_bytes) > MAX_RENDERED_PDF_BYTES:
        raise RenderedPdfValidationError("PDF 渲染结果过大。")
    if not pdf_bytes.startswith(b"%PDF-"):
        raise RenderedPdfValidationError("PDF 渲染结果格式无效。")
    return pdf_bytes
