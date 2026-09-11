from __future__ import annotations

from io import BytesIO
from pypdf import PdfReader

from .limits import MAX_RENDERED_PDF_BYTES


class RenderedPdfValidationError(ValueError):
    pass


class PdfPageCountMismatchError(RenderedPdfValidationError):
    def __init__(self, actual_pages: int, max_pages: int):
        self.actual_pages = actual_pages
        self.max_pages = max_pages
        super().__init__(f"单页校验失败：PDF 实际为 {actual_pages} 页，期望最多 {max_pages} 页。请重新调整排版或采用多页导出。")


def inspect_resume_pdf_page_count(value: bytes) -> int:
    validated = validate_rendered_pdf_bytes(value)
    try:
        reader = PdfReader(BytesIO(validated))
        count = len(reader.pages)
        if count < 1:
            raise ValueError("empty page tree")
        return count
    except Exception as exc:
        raise RenderedPdfValidationError("PDF 页数读取失败。") from exc


def enforce_resume_pdf_page_limit(value: bytes, max_pages: int | None) -> int:
    count = inspect_resume_pdf_page_count(value)
    if max_pages is not None and count > max_pages:
        raise PdfPageCountMismatchError(count, max_pages)
    return count


def validate_rendered_pdf_bytes(value: bytes | bytearray | memoryview) -> bytes:
    pdf_bytes = bytes(value)
    if not pdf_bytes:
        raise RenderedPdfValidationError("PDF 渲染结果为空。")
    if len(pdf_bytes) > MAX_RENDERED_PDF_BYTES:
        raise RenderedPdfValidationError("PDF 渲染结果过大。")
    if not pdf_bytes.startswith(b"%PDF-"):
        raise RenderedPdfValidationError("PDF 渲染结果格式无效。")
    return pdf_bytes
