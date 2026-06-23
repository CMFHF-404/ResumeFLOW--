import re
import unicodedata
from typing import Iterable, List, Optional

CHUNK_MAX_CHARS = 3_200
CHUNK_MIN_CHARS = 800
LONG_RESUME_TEXT_THRESHOLD = 6_000
CJK_CHAR_PATTERN = r"\u4e00-\u9fff\u3400-\u4dbf"
CJK_PUNCT_PATTERN = r"\u3000-\u303f\uff00-\uffef·•"
CJK_INLINE_PATTERN = f"{CJK_CHAR_PATTERN}{CJK_PUNCT_PATTERN}"
CJK_PUNCT_ADJACENT_PATTERN = r"\(\)\[\]（）【】《》<>·•"
WHITESPACE_PATTERN = re.compile(r"\s+")
PARA_SPLIT_PATTERN = re.compile(r"\n\s*\n+")
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[。！？!?;；.])\s+")


def _normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKC", value)
    compact = WHITESPACE_PATTERN.sub(" ", normalized).strip().lower()
    compact = re.sub(
        rf"(?<=[{CJK_INLINE_PATTERN}])\s+(?=[{CJK_INLINE_PATTERN}])",
        "",
        compact,
    )
    compact = re.sub(
        rf"(?<=[{CJK_CHAR_PATTERN}])\s+(?=[{CJK_PUNCT_ADJACENT_PATTERN}])",
        "",
        compact,
    )
    compact = re.sub(
        rf"(?<=[{CJK_PUNCT_ADJACENT_PATTERN}])\s+(?=[{CJK_CHAR_PATTERN}])",
        "",
        compact,
    )
    return compact


def _split_into_paragraphs(text: str) -> List[str]:
    stripped = text.strip()
    if not stripped:
        return []
    parts = [
        part.strip()
        for part in PARA_SPLIT_PATTERN.split(stripped)
        if part.strip()
    ]
    return parts if parts else [stripped]


def _hard_split_text(text: str, max_chars: int) -> List[str]:
    chunks: List[str] = []
    for index in range(0, len(text), max_chars):
        piece = text[index : index + max_chars].strip()
        if piece:
            chunks.append(piece)
    return chunks


def _chunk_units(units: Iterable[str], joiner: str) -> List[str]:
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0
    joiner_len = len(joiner)
    for unit in units:
        cleaned = unit.strip()
        if not cleaned:
            continue
        if len(cleaned) > CHUNK_MAX_CHARS:
            if current:
                chunks.append(joiner.join(current).strip())
                current = []
                current_len = 0
            chunks.extend(_hard_split_text(cleaned, CHUNK_MAX_CHARS))
            continue
        projected = current_len + len(cleaned) + (joiner_len if current else 0)
        if projected <= CHUNK_MAX_CHARS:
            current.append(cleaned)
            current_len = projected
            continue
        if current:
            chunks.append(joiner.join(current).strip())
        current = [cleaned]
        current_len = len(cleaned)
    if current:
        chunks.append(joiner.join(current).strip())
    return chunks


def _split_long_paragraph(paragraph: str) -> List[str]:
    if len(paragraph) <= CHUNK_MAX_CHARS:
        return [paragraph]
    lines = [line.strip() for line in paragraph.splitlines() if line.strip()]
    if len(lines) > 1:
        line_chunks = _chunk_units(lines, "\n")
        if line_chunks:
            return line_chunks
    sentences = [
        item.strip()
        for item in SENTENCE_SPLIT_PATTERN.split(paragraph)
        if item.strip()
    ]
    if len(sentences) > 1:
        return _chunk_units(sentences, " ")
    return _hard_split_text(paragraph, CHUNK_MAX_CHARS)


def _chunk_paragraphs(paragraphs: Iterable[str]) -> List[str]:
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0
    for paragraph in paragraphs:
        parts = _split_long_paragraph(paragraph)
        for part in parts:
            projected = current_len + len(part) + (1 if current else 0)
            if projected <= CHUNK_MAX_CHARS:
                current.append(part)
                current_len = projected
                continue
            if current:
                chunks.append("\n".join(current).strip())
            current = [part]
            current_len = len(part)
    if current:
        chunks.append("\n".join(current).strip())
    return chunks


def _merge_small_chunks(chunks: List[str]) -> List[str]:
    if not chunks:
        return []
    merged: List[str] = []
    buffer = ""
    for chunk in chunks:
        if not buffer:
            buffer = chunk
            continue
        if (
            len(buffer) < CHUNK_MIN_CHARS
            and len(buffer) + len(chunk) + 1 <= CHUNK_MAX_CHARS
        ):
            buffer = f"{buffer}\n{chunk}".strip()
            continue
        merged.append(buffer)
        buffer = chunk
    if buffer:
        merged.append(buffer)
    return merged


def _split_resume_text(text: str) -> List[str]:
    paragraphs = _split_into_paragraphs(text)
    if not paragraphs:
        return [text] if text.strip() else []
    chunks = _chunk_paragraphs(paragraphs)
    chunks = [chunk for chunk in _merge_small_chunks(chunks) if chunk]
    return chunks or [text]


def _should_use_chunking(text: str) -> bool:
    return len(text) > LONG_RESUME_TEXT_THRESHOLD
