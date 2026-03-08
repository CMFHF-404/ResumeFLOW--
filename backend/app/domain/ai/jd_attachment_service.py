"""
JD 附件处理服务

职责：根据上传文件类型，分发到不同的 JD 内容提取路径：
  - 图像（jpg/png/webp）→ base64 编码，供 vision 模型直接分析
  - 文档（pdf/docx）   → 提取纯文本，沿用现有文字分析路径

对外暴露：
  extract_jd_from_attachment(file) -> JDAttachmentResult
"""
import base64
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from docx import Document
from pypdf import PdfReader

# ── 支持的文件类型常量 ────────────────────────────────────────────
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

SUPPORTED_DOC_EXTENSIONS = {".pdf", ".docx"}
SUPPORTED_PDF_MIME_TYPES = {"application/pdf"}
SUPPORTED_DOCX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}

# 图像按 MIME type 映射到标准 MIME（统一格式给模型）
_EXTENSION_TO_MIME: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

MIN_DOCUMENT_TEXT_LENGTH = 20


# ── 数据结构 ──────────────────────────────────────────────────────

@dataclass(frozen=True)
class JDAttachmentResult:
    """
    附件处理结果，两条路径互斥：
      - 图像路径：image_b64 + mime_type 非空，text 为 None
      - 文档路径：text 非空，image_b64 / mime_type 为 None
    """
    text: Optional[str]
    image_b64: Optional[str]
    mime_type: Optional[str]

    @property
    def is_image(self) -> bool:
        return self.image_b64 is not None

    @property
    def is_text(self) -> bool:
        return self.text is not None


# ── 文件种类解析 ──────────────────────────────────────────────────

def _resolve_extension(file: UploadFile) -> str:
    """从 filename 解析扩展名（小写），若无 filename 返回空字符串。"""
    return Path(file.filename or "").suffix.lower()


def _resolve_mime(file: UploadFile) -> str:
    """返回小写 content_type，若缺失返回空字符串。"""
    return (file.content_type or "").lower()


def _is_image_file(ext: str, mime: str) -> bool:
    return ext in SUPPORTED_IMAGE_EXTENSIONS or mime in SUPPORTED_IMAGE_MIME_TYPES


def _is_pdf_file(ext: str, mime: str) -> bool:
    return ext == ".pdf" or mime in SUPPORTED_PDF_MIME_TYPES


def _is_docx_file(ext: str, mime: str) -> bool:
    return ext == ".docx" or mime in SUPPORTED_DOCX_MIME_TYPES


def _resolve_image_mime(ext: str, raw_mime: str) -> str:
    """
    优先从扩展名映射标准 MIME，其次用请求头中的 MIME。
    保证返回值是模型可接受的标准格式。
    """
    return _EXTENSION_TO_MIME.get(ext) or raw_mime


# ── 字节读取 ──────────────────────────────────────────────────────

async def _read_upload_bytes(file: UploadFile) -> bytes:
    """读取上传文件全部字节，读后重置游标。"""
    data = await file.read()
    await file.seek(0)
    return data


# ── 图像处理 ──────────────────────────────────────────────────────

def _encode_image_b64(data: bytes) -> str:
    """将原始字节编码为 base64 字符串。"""
    return base64.b64encode(data).decode("ascii")


# ── 文档处理 ──────────────────────────────────────────────────────

def _extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages)


def _extract_docx_text(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
    return "\n".join(paragraphs)


def _validate_extracted_text(text: str, filename: str) -> str:
    cleaned = text.strip()
    if len(cleaned) < MIN_DOCUMENT_TEXT_LENGTH:
        raise ValueError(
            f"文件「{filename}」内容过短或无法解析，请确认 JD 文件内容完整。"
        )
    return cleaned


# ── 主入口 ───────────────────────────────────────────────────────

async def extract_jd_from_attachment(file: UploadFile) -> JDAttachmentResult:
    """
    读取上传文件，按类型分发处理路径：
      - 图像 → base64 编码，返回 image_b64 + mime_type
      - PDF/DOCX → 提取纯文本，返回 text

    抛出 ValueError 表示格式不支持或内容无效。
    """
    ext = _resolve_extension(file)
    mime = _resolve_mime(file)

    if _is_image_file(ext, mime):
        return await _process_image(file, ext, mime)

    if _is_pdf_file(ext, mime):
        return await _process_pdf(file)

    if _is_docx_file(ext, mime):
        return await _process_docx(file)

    supported = ", ".join(
        sorted(SUPPORTED_IMAGE_EXTENSIONS | SUPPORTED_DOC_EXTENSIONS)
    )
    raise ValueError(
        f"不支持的文件类型（扩展名：{ext or '未知'}），"
        f"请上传以下格式之一：{supported}"
    )


async def _process_image(
    file: UploadFile, ext: str, raw_mime: str
) -> JDAttachmentResult:
    data = await _read_upload_bytes(file)
    image_b64 = _encode_image_b64(data)
    mime_type = _resolve_image_mime(ext, raw_mime)
    return JDAttachmentResult(text=None, image_b64=image_b64, mime_type=mime_type)


async def _process_pdf(file: UploadFile) -> JDAttachmentResult:
    data = await _read_upload_bytes(file)
    filename = file.filename or "PDF"
    try:
        raw_text = _extract_pdf_text(data)
    except Exception as exc:
        raise ValueError(
            f"文件「{filename}」无法解析，请确认它是未损坏且未加密的 PDF 文件。"
        ) from exc
    text = _validate_extracted_text(raw_text, filename)
    return JDAttachmentResult(text=text, image_b64=None, mime_type=None)


async def _process_docx(file: UploadFile) -> JDAttachmentResult:
    data = await _read_upload_bytes(file)
    filename = file.filename or "DOCX"
    try:
        raw_text = _extract_docx_text(data)
    except Exception as exc:
        raise ValueError(
            f"文件「{filename}」无法解析，请确认它是有效且未损坏的 DOCX 文件。"
        ) from exc
    text = _validate_extracted_text(raw_text, filename)
    return JDAttachmentResult(text=text, image_b64=None, mime_type=None)
