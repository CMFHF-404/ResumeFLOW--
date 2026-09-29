"""Browser-compatible text and display-value normalization for optimization.

These pure helpers mirror the editor's rendering rules. They deliberately have
no dependency on optimization context, application transactions, or storage.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from typing import Any
import html as html_lib
import re
from urllib.parse import urljoin, urlsplit

from .normalizers import _is_action_ecmascript_whitespace, markdown_link_spans


@dataclass
class _FrontendHtmlSourceNode:
    tag: str | None
    text: str | None
    attrs: tuple[tuple[str, str | None], ...]
    children: list[_FrontendHtmlSourceNode]
    had_child_node: bool


@dataclass
class _FrontendSanitizedNode:
    tag: str | None
    text: str | None
    children: list[_FrontendSanitizedNode | object]


class _FrontendHtmlSourceParser(HTMLParser):
    _VOID_TAGS = frozenset(
        {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _FrontendHtmlSourceNode(None, None, (), [], False)
        self._stack = [self.root]

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.lower()
        node = _FrontendHtmlSourceNode(
            normalized_tag,
            None,
            tuple((name.lower(), value) for name, value in attrs),
            [],
            False,
        )
        self._stack[-1].had_child_node = True
        self._stack[-1].children.append(node)
        if normalized_tag not in self._VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.lower()
        self._stack[-1].had_child_node = True
        self._stack[-1].children.append(
            _FrontendHtmlSourceNode(
                normalized_tag,
                None,
                tuple((name.lower(), value) for name, value in attrs),
                [],
                False,
            )
        )

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == normalized_tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if data:
            self._stack[-1].had_child_node = True
            self._stack[-1].children.append(
                _FrontendHtmlSourceNode(None, data, (), [], False)
            )

    def handle_comment(self, data: str) -> None:
        self._stack[-1].had_child_node = True

    def handle_decl(self, decl: str) -> None:
        # In a fragment/body context Chromium ignores a doctype token instead
        # of creating a child node. An otherwise empty block therefore takes
        # the editor's explicit-break path.
        return None

    def handle_pi(self, data: str) -> None:
        self._stack[-1].had_child_node = True

    def unknown_decl(self, data: str) -> None:
        self._stack[-1].had_child_node = True


_FRONTEND_HTML_BREAK = object()
_FRONTEND_INLINE_TAGS = frozenset({"b", "strong", "i", "em", "u", "a"})
_FRONTEND_LIST_TAGS = frozenset({"ul", "ol", "li"})
_FRONTEND_BLOCK_TAGS = frozenset({"div", "p"})
_FRONTEND_MARKDOWN_TRIGGER_RE = re.compile(
    r"(?:\*\*|＊＊|__|\]\(|\*[^*\r\n]+\*)"
)
_FRONTEND_RICH_TEXT_HTML_TAG_RE = re.compile(
    r"</?(?:b|strong|i|em|u|a|br|ul|ol|li)\b",
    re.IGNORECASE,
)
_FRONTEND_MARKDOWN_HTML_SPLIT_RE = re.compile(r"(<[^>]+>)")
_FRONTEND_MARKDOWN_BOLD_RE = re.compile(
    r"(?:\*\*|＊＊)([^*\r\n＊]+)(?:\*\*|＊＊)"
)
_FRONTEND_MARKDOWN_UNDERLINE_RE = re.compile(r"__([^_\r\n]+)__")
_FRONTEND_MARKDOWN_ITALIC_RE = re.compile(
    r"(^|[^*])\*([^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029"
    r"\u202f\u205f\u3000\ufeff*](?:[^*\r\n]*?[^\t\n\v\f\r \u00a0"
    r"\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff*])?)"
    r"\*(?!\*)"
)
_FRONTEND_NUMERIC_CHARACTER_REFERENCE_RE = re.compile(
    r"&#(?:(?P<hex>[xX][0-9a-fA-F]+)|(?P<decimal>[0-9]+));?"
)


def _frontend_append_break(
    parent: list[_FrontendSanitizedNode | object],
    *,
    explicit: bool = False,
) -> None:
    if explicit or not parent or parent[-1] is not _FRONTEND_HTML_BREAK:
        parent.append(_FRONTEND_HTML_BREAK)


def _frontend_normalize_markdown_token(value: str) -> str:
    normalized = value.replace("\u00a0", " ").replace("\u3000", " ")
    start = 0
    end = len(normalized)
    while start < end and (
        _is_action_ecmascript_whitespace(normalized[start])
        or normalized[start] in "\u200b\u200c\u200d"
    ):
        start += 1
    while end > start and (
        _is_action_ecmascript_whitespace(normalized[end - 1])
        or normalized[end - 1] in "\u200b\u200c\u200d"
    ):
        end -= 1
    return normalized[start:end]


def _frontend_escape_markdown_link_target(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _frontend_markdown_links_to_html(value: str) -> str:
    output: list[str] = []
    cursor = 0
    for start, end, label, target in markdown_link_spans(value):
        output.append(value[cursor:start])
        output.append(
            f'<a href="{_frontend_escape_markdown_link_target(target)}">'
            f"{_frontend_normalize_markdown_token(label)}</a>"
        )
        cursor = end
    output.append(value[cursor:])
    return "".join(output)


def _frontend_apply_legacy_markdown(value: str) -> str:
    rendered = _frontend_markdown_links_to_html(value)
    rendered = _FRONTEND_MARKDOWN_BOLD_RE.sub(
        lambda match: f"<b>{_frontend_normalize_markdown_token(match.group(1))}</b>",
        rendered,
    )
    rendered = _FRONTEND_MARKDOWN_UNDERLINE_RE.sub(
        lambda match: f"<u>{_frontend_normalize_markdown_token(match.group(1))}</u>",
        rendered,
    )
    return _FRONTEND_MARKDOWN_ITALIC_RE.sub(
        lambda match: (
            f"{match.group(1)}<i>"
            f"{_frontend_normalize_markdown_token(match.group(2))}</i>"
        ),
        rendered,
    )


def _frontend_maybe_convert_legacy_markdown(value: str) -> str:
    if not value or _FRONTEND_MARKDOWN_TRIGGER_RE.search(value) is None:
        return value
    if re.search(r"<[^>]+>", value) is None:
        return _frontend_apply_legacy_markdown(value)
    return "".join(
        part
        if part.startswith("<") and part.endswith(">")
        else _frontend_apply_legacy_markdown(part)
        for part in _FRONTEND_MARKDOWN_HTML_SPLIT_RE.split(value)
    )


def _frontend_preserve_numeric_reference_characters(
    value: str,
) -> tuple[str, dict[str, str]]:
    """Protect HTML5 numeric references that Python's parser incorrectly drops."""

    replacements: dict[str, str] = {}
    next_placeholder = 0xF0000

    def replace(match: re.Match[str]) -> str:
        nonlocal next_placeholder
        digits = match.group("hex") or match.group("decimal")
        base = 16 if match.group("hex") else 10
        if match.group("hex"):
            digits = digits[1:]
        try:
            codepoint = int(digits, base)
        except (TypeError, ValueError):
            return match.group()
        is_disallowed_control = (
            1 <= codepoint <= 8
            or codepoint == 11
            or 14 <= codepoint <= 31
            or codepoint == 127
        )
        is_noncharacter = (
            0xFDD0 <= codepoint <= 0xFDEF
            or (
                codepoint <= 0x10FFFF
                and (codepoint & 0xFFFF) in {0xFFFE, 0xFFFF}
            )
        )
        if not (is_disallowed_control or is_noncharacter):
            return match.group()
        while chr(next_placeholder) in value or chr(next_placeholder) in replacements:
            next_placeholder += 1
        placeholder = chr(next_placeholder)
        next_placeholder += 1
        replacements[placeholder] = chr(codepoint)
        return placeholder

    return _FRONTEND_NUMERIC_CHARACTER_REFERENCE_RE.sub(replace, value), replacements


def _frontend_append_text(
    parent: list[_FrontendSanitizedNode | object],
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> None:
    normalized = value.replace("\u00a0", " ")
    if preserve_text_line_breaks:
        if normalized:
            parent.append(_FrontendSanitizedNode(None, normalized, []))
        return
    parts = re.split(r"\r?\n", normalized)
    for index, part in enumerate(parts):
        if part:
            parent.append(_FrontendSanitizedNode(None, part, []))
        if index < len(parts) - 1:
            _frontend_append_break(parent, explicit=True)


def _frontend_style_tags(node: _FrontendHtmlSourceNode) -> list[str]:
    style = next((value for name, value in node.attrs if name == "style"), "") or ""
    declarations: dict[str, str] = {}
    for declaration in style.split(";"):
        name, separator, value = declaration.partition(":")
        if separator:
            declarations[name.strip().lower()] = value.strip().lower()
    tags: list[str] = []
    font_weight = declarations.get("font-weight", "")
    numeric_weight = re.match(r"^[+-]?\d+", font_weight)
    if font_weight in {"bold", "bolder"} or (
        numeric_weight is not None and int(numeric_weight.group()) >= 600
    ):
        tags.append("b")
    if re.match(r"^(?:italic|oblique)\b", declarations.get("font-style", "")):
        tags.append("i")
    text_decoration = " ".join(
        (
            declarations.get("text-decoration-line", ""),
            declarations.get("text-decoration", ""),
        )
    )
    if re.search(r"\bunderline\b", text_decoration):
        tags.append("u")
    return tags


def _frontend_safe_href(node: _FrontendHtmlSourceNode) -> bool:
    href = next((value for name, value in node.attrs if name == "href"), None)
    if not href:
        return False
    try:
        scheme = urlsplit(urljoin("https://fallback.local", href)).scheme
    except ValueError:
        return False
    return scheme in {"http", "https", "mailto", "tel"}


def _frontend_wrap_inline_styles(
    child: _FrontendSanitizedNode,
    style_tags: list[str],
) -> _FrontendSanitizedNode:
    wrapped = child
    for tag in reversed(style_tags):
        wrapped = _FrontendSanitizedNode(tag, None, [wrapped])
    return wrapped


def _frontend_styled_content_parent(
    parent: list[_FrontendSanitizedNode | object],
    style_tags: list[str],
) -> list[_FrontendSanitizedNode | object]:
    current = parent
    for tag in style_tags:
        wrapper = _FrontendSanitizedNode(tag, None, [])
        current.append(wrapper)
        current = wrapper.children
    return current


def _frontend_sanitize_nodes(
    nodes: list[_FrontendHtmlSourceNode],
    parent: list[_FrontendSanitizedNode | object],
    *,
    preserve_text_line_breaks: bool,
) -> None:
    for node in nodes:
        if node.tag is None:
            _frontend_append_text(
                parent,
                node.text or "",
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            continue
        if node.tag == "br":
            _frontend_append_break(parent, explicit=True)
            continue
        if node.tag in _FRONTEND_INLINE_TAGS:
            if node.tag == "a" and not _frontend_safe_href(node):
                _frontend_sanitize_nodes(
                    node.children,
                    parent,
                    preserve_text_line_breaks=preserve_text_line_breaks,
                )
                continue
            mapped_tag = {"strong": "b", "em": "i"}.get(node.tag, node.tag)
            inline = _FrontendSanitizedNode(mapped_tag, None, [])
            _frontend_sanitize_nodes(
                node.children,
                inline.children,
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            style_tags = [
                tag for tag in _frontend_style_tags(node) if tag != mapped_tag
            ]
            parent.append(_frontend_wrap_inline_styles(inline, style_tags))
            continue
        if node.tag in _FRONTEND_LIST_TAGS:
            block = _FrontendSanitizedNode(node.tag, None, [])
            _frontend_sanitize_nodes(
                node.children,
                block.children,
                preserve_text_line_breaks=preserve_text_line_breaks,
            )
            parent.append(block)
            continue
        content_parent = _frontend_styled_content_parent(
            parent,
            _frontend_style_tags(node),
        )
        _frontend_sanitize_nodes(
            node.children,
            content_parent,
            preserve_text_line_breaks=preserve_text_line_breaks,
        )
        if node.tag in _FRONTEND_BLOCK_TAGS:
            _frontend_append_break(parent, explicit=not node.had_child_node)


def _frontend_flatten_sanitized_node(
    node: _FrontendSanitizedNode | object,
) -> str:
    if node is _FRONTEND_HTML_BREAK:
        return "\n"
    if not isinstance(node, _FrontendSanitizedNode):
        return ""
    if node.text is not None:
        return node.text
    flattened = "".join(
        _frontend_flatten_sanitized_node(child) for child in node.children
    )
    return f"{flattened}\n" if node.tag == "li" else flattened


def _frontend_serialize_sanitized_node(
    node: _FrontendSanitizedNode | object,
) -> str:
    if node is _FRONTEND_HTML_BREAK:
        return "<br>"
    if not isinstance(node, _FrontendSanitizedNode):
        return ""
    if node.text is not None:
        return html_lib.escape(node.text, quote=False)
    content = "".join(
        _frontend_serialize_sanitized_node(child) for child in node.children
    )
    return f"<{node.tag}>{content}</{node.tag}>" if node.tag else content


def _frontend_sanitized_nodes(
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> tuple[list[_FrontendSanitizedNode | object], dict[str, str]]:
    value = _frontend_maybe_convert_legacy_markdown(value)
    value, preserved_references = _frontend_preserve_numeric_reference_characters(value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    parser = _FrontendHtmlSourceParser()
    parser.feed(value)
    parser.close()
    sanitized: list[_FrontendSanitizedNode | object] = []
    _frontend_sanitize_nodes(
        parser.root.children,
        sanitized,
        preserve_text_line_breaks=preserve_text_line_breaks,
    )
    while sanitized and sanitized[-1] is _FRONTEND_HTML_BREAK:
        sanitized.pop()
    return sanitized, preserved_references


def _frontend_restore_preserved_references(
    value: str,
    preserved_references: Mapping[str, str],
) -> str:
    for placeholder, character in preserved_references.items():
        value = value.replace(placeholder, character)
    return value


def _frontend_sanitized_html(value: str) -> str:
    """Mirror one browser ``sanitizeRichTextHtml`` serialize pass."""

    sanitized, preserved_references = _frontend_sanitized_nodes(
        value,
        preserve_text_line_breaks=False,
    )
    return _frontend_restore_preserved_references(
        "".join(_frontend_serialize_sanitized_node(node) for node in sanitized),
        preserved_references,
    )


def _frontend_sanitized_plain_text(
    value: str,
    *,
    preserve_text_line_breaks: bool,
) -> str:
    sanitized, preserved_references = _frontend_sanitized_nodes(
        value,
        preserve_text_line_breaks=preserve_text_line_breaks,
    )
    # The frontend serializes the sanitized tree and parses it once more before
    # reading textContent. That second HTML parse canonicalizes CR character
    # references in text nodes to LF.
    flattened = "".join(
        _frontend_flatten_sanitized_node(node) for node in sanitized
    ).replace("\r\n", "\n").replace("\r", "\n")
    return _frontend_restore_preserved_references(
        flattened,
        preserved_references,
    )


def _frontend_plain_text(
    value: Any,
    *,
    preserve_plain_line_breaks: bool = False,
) -> str:
    text = "" if value is None else str(value)
    if not text:
        return ""
    text = _frontend_sanitized_plain_text(
        text,
        preserve_text_line_breaks=preserve_plain_line_breaks,
    )
    start = 0
    end = len(text)
    while start < end and _is_action_ecmascript_whitespace(text[start]):
        start += 1
    while end > start and _is_action_ecmascript_whitespace(text[end - 1]):
        end -= 1
    return text[start:end]


def _frontend_decode_rich_text_entities_deep(value: Any) -> str:
    text = "" if value is None else str(value)
    rich_entity_pattern = re.compile(
        r"&(lt|gt|amp;lt|amp;gt);",
        re.IGNORECASE,
    )
    for _ in range(2):
        if rich_entity_pattern.search(text) is None:
            break
        protected, preserved_references = (
            _frontend_preserve_numeric_reference_characters(text)
        )
        decoded = html_lib.unescape(protected)
        for placeholder, character in preserved_references.items():
            decoded = decoded.replace(placeholder, character)
        if decoded == text:
            break
        text = decoded
    return text


def _frontend_star_plain_text(value: Any) -> str:
    """Mirror normalizeStarValue followed by evaluation plainText."""

    normalized = _frontend_decode_rich_text_entities_deep(value)
    if (
        _FRONTEND_RICH_TEXT_HTML_TAG_RE.search(normalized) is not None
        or _FRONTEND_MARKDOWN_TRIGGER_RE.search(normalized) is not None
    ):
        normalized = _frontend_sanitized_html(normalized)
    return _frontend_plain_text(normalized)


def _frontend_snapshot_plain_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00a0", " ")
    start = 0
    end = len(text)
    while start < end and _is_action_ecmascript_whitespace(text[start]):
        start += 1
    while end > start and _is_action_ecmascript_whitespace(text[end - 1]):
        end -= 1
    return text[start:end]


def _frontend_star_value(value: Any) -> str:
    if isinstance(value, list):
        def js_string(item: Any) -> str:
            if item is None:
                return ""
            if isinstance(item, bool):
                return "true" if item else "false"
            if isinstance(item, list):
                return ",".join(js_string(nested) for nested in item)
            if isinstance(item, Mapping):
                return "[object Object]"
            return str(item)

        value = "、".join(js_string(item) for item in value)
    normalized = _frontend_decode_rich_text_entities_deep(value)
    if (
        _FRONTEND_RICH_TEXT_HTML_TAG_RE.search(normalized)
        is not None
        or _FRONTEND_MARKDOWN_TRIGGER_RE.search(normalized)
        is not None
    ):
        normalized = _frontend_sanitized_html(normalized)
    return normalized


def _frontend_year_month(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return f"{value.year:04d}.{value.month:02d}"
    text = str(value).strip()
    if not text:
        return ""
    normalized = text.replace("/", "-").replace(".", "-")
    parts = normalized.split("-")
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        return f"{int(parts[0]):04d}.{int(parts[1]):02d}"
    return text.replace("-", ".")


