from __future__ import annotations

import hashlib
import html as html_lib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from ..ai import runtime_budget
from .schemas import (
    OptimizationAction,
    OptimizationChange,
    OptimizationModuleType,
    OptimizationPlan,
    OptimizationQuestion,
    RESUME_EVALUATION_DIMENSION_NAMES,
)


# Model output is never expected to need a single 20k-character scalar. Keep this
# below the shared runtime ceiling while still honoring deployments with a tighter cap.
MAX_MODEL_STRING_CHARS = 20_000

_ACTION_HTML_ATTRIBUTE_CONTENT = r'''(?:[^"'<>]|"[^"]*"|'[^']*')*'''
_ACTION_OPEN_BOUNDARY_TAG = (
    rf"<(?:li|div|p|ul|ol|br)(?=[\s/>]){_ACTION_HTML_ATTRIBUTE_CONTENT}>"
)
_ACTION_BOUNDARY_PATTERN = (
    rf"(?:{_ACTION_OPEN_BOUNDARY_TAG}|</(?:li|div|p|ul|ol)\s*>|\r?\n)"
)
_ACTION_BOUNDARY_TAG_RE = re.compile(
    rf"^{_ACTION_OPEN_BOUNDARY_TAG}$|^</(?:li|div|p|ul|ol)\s*>$",
    re.IGNORECASE,
)
_ACTION_TRAILING_CLOSE_TAGS_RE = re.compile(r"\s*(?:</[^>]+>\s*)+$", re.IGNORECASE)
_ACTION_TRAILING_CLOSERS_RE = re.compile(r"[”’\"'」』]+$")
_ACTION_TRAILING_CLOSER_ENTITY_RE = re.compile(
    r"(?:&(?:CloseCurlyDoubleQuote|CloseCurlyQuote|rdquo|rdquor|rsquo|rsquor|quot|apos|#0*(?:8221|8217|34|39)|#(?:x|X)0*(?:201d|2019|22|27));)+$",
)
_ACTION_TRAILING_ENTITY_RE = re.compile(
    r"&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);$",
    re.IGNORECASE,
)
_ACTION_TRAILING_PUNCTUATION_RE = re.compile(r"[。！？!?；;，,、：:.…]+$")
_ACTION_PUNCTUATION_ONLY_RE = re.compile(r"^[。！？!?；;，,、：:.…]+$")
_ACTION_MARKDOWN_EMPHASIS_DELIMITERS = ("***", "**", "＊＊", "__", "*")
_HTML_TAG_RE = re.compile(r'''<(?:[^"'<>]|"[^"]*"|'[^']*')*>''')
_ACTION_MARKDOWN_HTML_SPLIT_RE = re.compile(r"<[^>]+>")
_ACTION_MARKDOWN_RENDER_BOLD_RE = re.compile(
    r"(?:\*\*|＊＊)([^*\r\n＊]+)(?:\*\*|＊＊)"
)
_ACTION_MARKDOWN_RENDER_UNDERLINE_RE = re.compile(r"__([^_\r\n]+)__")
_ACTION_MARKDOWN_RENDER_ITALIC_RE = re.compile(
    r"(^|[^*])\*([^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029"
    r"\u202f\u205f\u3000\ufeff*](?:[^*\r\n]*?[^\t\n\v\f\r \u00a0"
    r"\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff*])?)"
    r"\*(?!\*)"
)
_ACTION_MARKDOWN_SYNTHETIC_OPEN = "\ue000"
_ACTION_MARKDOWN_SYNTHETIC_CLOSE = "\ue001"
# Mirror ECMAScript ``\s`` and ``Default_Ignorable_Code_Point`` exactly for
# the frontend/backend Action-tail contract. Python's ``isspace`` and the broad
# ``Cf`` category include code points (for example U+0085 and U+0600) that the
# browser does not treat as either class here.
_ACTION_ECMASCRIPT_WHITESPACE_CODEPOINTS = frozenset((
    0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x1680,
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
))
_DEFAULT_IGNORABLE_ACTION_RANGES = (
    (0x00AD, 0x00AD), (0x034F, 0x034F), (0x061C, 0x061C),
    (0x115F, 0x1160), (0x17B4, 0x17B5), (0x180B, 0x180F),
    (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x206F),
    (0x3164, 0x3164), (0xFE00, 0xFE0F), (0xFEFF, 0xFEFF),
    (0xFFA0, 0xFFA0), (0xFFF0, 0xFFF8), (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A), (0xE0000, 0xE0FFF),
)

_CHANGE_KEYS = {
    "changeId": "change_id",
    "issueIds": "issue_ids",
    "dimension": "dimension",
    "moduleType": "module_type",
    "moduleId": "module_id",
    "fieldPath": "field_path",
    "actionKind": "action_kind",
    "scope": "scope",
    "beforeValue": "before_value",
    "generalValue": "general_value",
    "targetedValue": "targeted_value",
    "sourceRefs": "source_refs",
    "introducedTerms": "introduced_terms",
    "rationale": "rationale",
    "expectedScoreGain": "expected_score_gain",
    "defaultSelected": "default_selected",
}
_QUESTION_KEYS = {
    "questionId": "question_id",
    "moduleId": "module_id",
    "fieldPath": "field_path",
    "text": "text",
    "reason": "reason",
    "answerType": "answer_type",
    "choices": "choices",
    "affectsChangeIds": "affects_change_ids",
    "priority": "priority",
}


def _strip_trailing_action_punctuation(value: str) -> str:
    while _ACTION_TRAILING_PUNCTUATION_RE.search(value):
        if _ACTION_TRAILING_ENTITY_RE.search(value):
            return value
        value = value[:-1]
    return value


def _action_html_markup_end(value: str, start: int) -> int | None:
    quote: str | None = None
    cursor = start + 1
    while cursor < len(value):
        char = value[cursor]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in {'"', "'"}:
            quote = char
        elif char == ">":
            return cursor + 1
        cursor += 1
    return None


def _action_boundary_parts(value: str) -> list[tuple[str, bool]]:
    """Split only lexical boundaries that a browser can actually render."""

    parts: list[tuple[str, bool]] = []
    segment_start = 0
    cursor = 0
    while cursor < len(value):
        entity = re.match(r"(?:&NewLine;|&#0*(?:10|13);|&#[xX]0*(?:[aAdD]);)", value[cursor:])
        if entity is not None:
            parts.append((value[segment_start:cursor], False))
            parts.append((entity.group(), True))
            cursor += entity.end()
            segment_start = cursor
            continue
        if value[cursor] in "\r\n":
            end = cursor + 2 if value.startswith("\r\n", cursor) else cursor + 1
            parts.append((value[segment_start:cursor], False))
            parts.append((value[cursor:end], True))
            cursor = end
            segment_start = cursor
            continue
        if value.startswith("<!--", cursor):
            comment_end = value.find("-->", cursor + 4)
            cursor = len(value) if comment_end < 0 else comment_end + 3
            continue
        if value[cursor] == "<":
            end = _action_html_markup_end(value, cursor)
            if end is not None and _ACTION_BOUNDARY_TAG_RE.fullmatch(value[cursor:end]):
                parts.append((value[segment_start:cursor], False))
                parts.append((value[cursor:end], True))
                cursor = end
                segment_start = cursor
                continue
            cursor = end if end is not None else cursor + 1
            continue
        cursor += 1
    parts.append((value[segment_start:], False))
    return parts


def _is_default_ignorable_action_char(char: str) -> bool:
    codepoint = ord(char)
    return any(
        start <= codepoint <= end
        for start, end in _DEFAULT_IGNORABLE_ACTION_RANGES
    )


def _is_action_ecmascript_whitespace(char: str) -> bool:
    codepoint = ord(char)
    return (
        codepoint in _ACTION_ECMASCRIPT_WHITESPACE_CODEPOINTS
        or 0x2000 <= codepoint <= 0x200A
    )


def _strip_action_ecmascript_whitespace(value: str) -> str:
    start = 0
    end = len(value)
    while start < end and _is_action_ecmascript_whitespace(value[start]):
        start += 1
    while end > start and _is_action_ecmascript_whitespace(value[end - 1]):
        end -= 1
    return value[start:end]


def _has_visible_action_content(segment: str) -> bool:
    without_comments = re.sub(r"<!--[\s\S]*?-->", "", segment)
    raw_visible = _HTML_TAG_RE.sub("", without_comments)
    visible = html_lib.unescape(raw_visible)
    visible = "".join(
        char for char in visible
        if not _is_default_ignorable_action_char(char)
    )
    visible = _strip_action_ecmascript_whitespace(visible)
    return bool(visible)


def _split_trailing_action_suffix(value: str) -> tuple[str, str]:
    """Peel render-inert tails and closing tags without changing their order.

    The period belongs immediately after the final visible character, which can
    be inside one or more wrappers.  Removing just a terminal closing-tag run
    first fails when comments, whitespace, or default-ignorables follow it.
    """

    cursor = len(value)
    suffix = ""
    while cursor:
        char = value[cursor - 1]
        if value[:cursor].endswith("-->"):
            comment_start = value.rfind("<!--", 0, cursor)
            if comment_start >= 0:
                suffix = f"{value[comment_start:cursor]}{suffix}"
                cursor = comment_start
                continue
        entity_match = _ACTION_TRAILING_ENTITY_RE.search(value[:cursor])
        if entity_match:
            entity = entity_match.group()
            decoded_entity = html_lib.unescape(entity)
            if (
                decoded_entity
                and (
                    all(_is_default_ignorable_action_char(item) for item in decoded_entity)
                    or (
                        "</" in value[:cursor]
                        and all(_is_action_ecmascript_whitespace(item) for item in decoded_entity)
                    )
                    or all(item in "”’\"'」』" for item in decoded_entity)
                )
            ):
                suffix = f"{entity}{suffix}"
                cursor = entity_match.start()
                continue
        if _is_action_ecmascript_whitespace(char) or _is_default_ignorable_action_char(char):
            cursor -= 1
            suffix = f"{char}{suffix}"
            continue
        if char in "”’\"'」』":
            cursor -= 1
            suffix = f"{char}{suffix}"
            continue
        closing_start = value.rfind("<", 0, cursor)
        closing_tag = value[closing_start:cursor] if closing_start >= 0 else ""
        if closing_tag and re.fullmatch(r"</[^>]+>", closing_tag, re.IGNORECASE):
            suffix = f"{closing_tag}{suffix}"
            cursor = closing_start
            continue
        break
    return value[:cursor], suffix


def _is_escaped_markdown_character(value: str, position: int) -> bool:
    backslashes = 0
    cursor = position - 1
    while cursor >= 0 and value[cursor] == "\\":
        backslashes += 1
        cursor -= 1
    return backslashes % 2 == 1


def _matching_markdown_delimiter(
    value: str,
    start: int,
    opening: str,
    closing: str,
) -> int | None:
    depth = 1
    quote: str | None = None
    cursor = start + 1
    while cursor < len(value):
        char = value[cursor]
        if char in "\r\n":
            return None
        if char == "\\":
            cursor += 2
            continue
        if quote is not None:
            if char == quote:
                quote = None
            cursor += 1
            continue
        if (
            opening == "("
            and char in {'"', "'"}
            and (
                cursor == start + 1
                or _is_action_ecmascript_whitespace(value[cursor - 1])
            )
        ):
            quote = char
            cursor += 1
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return cursor
        cursor += 1
    return None


def _markdown_link_target(destination: str) -> str | None:
    title_quote: str | None = None
    title_start = -1
    title_end = -1
    cursor = 0
    while cursor < len(destination):
        char = destination[cursor]
        if char == "\\":
            cursor += 2
            continue
        if title_quote is not None:
            if char == title_quote:
                title_quote = None
                title_end = cursor
            cursor += 1
            continue
        if (
            char in {'"', "'"}
            and (
                cursor == 0
                or _is_action_ecmascript_whitespace(destination[cursor - 1])
            )
        ):
            title_quote = char
            title_start = cursor
        cursor += 1
    if title_quote is not None or (
        title_start >= 0
        and _strip_action_ecmascript_whitespace(destination[title_end + 1:])
    ):
        return None
    target = (
        destination[:title_start] if title_start >= 0 else destination
    )
    target = _strip_action_ecmascript_whitespace(target)
    return (
        target
        if target
        and not any(_is_action_ecmascript_whitespace(char) for char in target)
        else None
    )


def _markdown_link_at(
    value: str,
    label_start: int,
) -> tuple[int, int, str] | None:
    if _is_escaped_markdown_character(value, label_start):
        return None
    label_end = _matching_markdown_delimiter(value, label_start, "[", "]")
    if (
        label_end is None
        or label_end == label_start + 1
        or label_end + 1 >= len(value)
        or value[label_end + 1] != "("
    ):
        return None
    url_end = _matching_markdown_delimiter(value, label_end + 1, "(", ")")
    if url_end is None:
        return None
    target = _markdown_link_target(value[label_end + 2:url_end])
    return None if target is None else (label_end, url_end, target)


def markdown_link_targets(value: str) -> tuple[str, ...]:
    """Return rendered Markdown link hrefs using the legacy converter grammar."""

    targets: list[str] = []
    cursor = 0
    while cursor < len(value):
        label_start = value.find("[", cursor)
        if label_start < 0:
            break
        link = _markdown_link_at(value, label_start)
        if link is None:
            cursor = label_start + 1
            continue
        _, url_end, target = link
        targets.append(target)
        cursor = url_end + 1
    return tuple(targets)


def markdown_link_spans(value: str) -> tuple[tuple[int, int, str, str], ...]:
    """Return valid Markdown link spans as ``(start, end, label, target)``."""

    spans: list[tuple[int, int, str, str]] = []
    cursor = 0
    while cursor < len(value):
        label_start = value.find("[", cursor)
        if label_start < 0:
            break
        link = _markdown_link_at(value, label_start)
        if link is None:
            cursor = label_start + 1
            continue
        label_end, url_end, target = link
        spans.append(
            (
                label_start,
                url_end + 1,
                value[label_start + 1:label_end],
                target,
            )
        )
        cursor = url_end + 1
    return tuple(spans)


def markdown_links_to_plain_text(value: str) -> str:
    """Mirror the frontend converter: only valid Markdown links become labels."""

    output: list[str] = []
    source_cursor = 0
    search_cursor = 0
    while search_cursor < len(value):
        label_start = value.find("[", search_cursor)
        if label_start < 0:
            break
        link = _markdown_link_at(value, label_start)
        if link is None:
            search_cursor = label_start + 1
            continue
        label_end, url_end, _ = link
        output.append(value[source_cursor:label_start])
        output.append(value[label_start + 1:label_end])
        source_cursor = url_end + 1
        search_cursor = source_cursor
    output.append(value[source_cursor:])
    return "".join(output)


def _has_trailing_markdown_link(value: str) -> bool:
    cursor = 0
    while cursor < len(value):
        label_start = value.find("[", cursor)
        if label_start < 0:
            return False
        if _is_escaped_markdown_character(value, label_start):
            cursor = label_start + 1
            continue
        link = _markdown_link_at(value, label_start)
        if link is None:
            cursor = label_start + 1
            continue
        _, url_end, _ = link
        if url_end == len(value) - 1:
            return True
        cursor = url_end + 1
    return False


def _trailing_markdown_link_parts(value: str) -> tuple[str, str, str] | None:
    cursor = 0
    while cursor < len(value):
        label_start = value.find("[", cursor)
        if label_start < 0:
            return None
        if _is_escaped_markdown_character(value, label_start):
            cursor = label_start + 1
            continue
        link = _markdown_link_at(value, label_start)
        if link is None:
            cursor = label_start + 1
            continue
        label_end, url_end, _ = link
        if url_end == len(value) - 1:
            return (
                value[:label_start + 1],
                value[label_start + 1:label_end],
                value[label_end:],
            )
        cursor = url_end + 1
    return None


def _is_action_punctuation_entity(entity: str) -> bool:
    decoded = html_lib.unescape(entity)
    return bool(decoded and _ACTION_PUNCTUATION_ONLY_RE.fullmatch(decoded))


def _apply_action_markdown_render_pass(
    tokens: list[tuple[str, int | None]],
    pattern: re.Pattern[str],
    *,
    content_group: int,
    italic: bool = False,
) -> set[int]:
    """Consume one legacy Markdown pass while retaining source offsets."""

    rendered = "".join(char for char, _ in tokens)
    consumed: set[int] = set()
    for match in reversed(list(pattern.finditer(rendered))):
        content_start, content_end = match.span(content_group)
        if italic:
            opening_start = content_start - 1
            closing_end = content_end + 1
        else:
            opening_start = match.start()
            closing_end = match.end()
        for _, source_index in (
            tokens[opening_start:content_start]
            + tokens[content_end:closing_end]
        ):
            if source_index is not None:
                consumed.add(source_index)
        tokens[opening_start:closing_end] = [
            (_ACTION_MARKDOWN_SYNTHETIC_OPEN, None),
            *tokens[content_start:content_end],
            (_ACTION_MARKDOWN_SYNTHETIC_CLOSE, None),
        ]
    return consumed


def _rendered_action_markdown_marker_indices(value: str) -> set[int] | None:
    """Return marker offsets consumed by the editor's legacy Markdown renderer.

    The editor applies bold, underline, then italic replacements.  Modeling
    those passes catches nested forms such as ``*x;**y;***`` without treating
    unmatched or cross-HTML markers as invisible closing syntax.
    """

    if _ACTION_MARKDOWN_HTML_SPLIT_RE.search(value):
        return None
    tokens = [
        (
            "\ue002"
            if char in "*＊_" and _is_escaped_markdown_character(value, index)
            else char,
            index,
        )
        for index, char in enumerate(value)
    ]
    consumed: set[int] = set()
    consumed.update(_apply_action_markdown_render_pass(
        tokens,
        _ACTION_MARKDOWN_RENDER_BOLD_RE,
        content_group=1,
    ))
    consumed.update(_apply_action_markdown_render_pass(
        tokens,
        _ACTION_MARKDOWN_RENDER_UNDERLINE_RE,
        content_group=1,
    ))
    consumed.update(_apply_action_markdown_render_pass(
        tokens,
        _ACTION_MARKDOWN_RENDER_ITALIC_RE,
        content_group=2,
        italic=True,
    ))
    for index, char in enumerate(value):
        if (
            char in "*＊_"
            and not _is_escaped_markdown_character(value, index)
            and index not in consumed
        ):
            return None
    return consumed


def action_markdown_rendered_marker_indices(value: str) -> frozenset[int] | None:
    """Return source offsets hidden by legacy Action Markdown formatting.

    ``value`` must be one renderer text segment (HTML/comments are boundaries).
    An empty set means the segment contains no rendered emphasis markers;
    ``None`` means it contains an HTML boundary or an unmatched, unescaped
    marker and must be treated literally.  The offsets cover every delimiter
    consumed by the editor's bold -> underline -> italic conversion, including
    valid nested forms and combined ``***`` closing runs.
    """

    consumed = _rendered_action_markdown_marker_indices(value)
    return None if consumed is None else frozenset(consumed)


def _has_terminal_action_plain_punctuation(value: str) -> bool:
    body, _ = _split_trailing_action_suffix(value)
    body, _ = _split_trailing_action_closers(body)
    closer_entity_match = _ACTION_TRAILING_CLOSER_ENTITY_RE.search(body)
    if closer_entity_match:
        body = body[:closer_entity_match.start()]
    entity_match = _ACTION_TRAILING_ENTITY_RE.search(body)
    if entity_match:
        return _is_action_punctuation_entity(entity_match.group())
    return _ACTION_TRAILING_PUNCTUATION_RE.search(body) is not None


def _normalize_action_plain_tail(value: str) -> str:
    """Normalize only the visible tail, leaving Markdown markers literal."""

    body, suffix = _split_trailing_action_suffix(value)
    body, closers = _split_trailing_action_closers(body)
    closer_entity_match = _ACTION_TRAILING_CLOSER_ENTITY_RE.search(body)
    if closer_entity_match:
        body = body[:closer_entity_match.start()]
        closers = f"{closer_entity_match.group()}{closers}"
    body = _strip_trailing_action_punctuation(body)
    entity_match = _ACTION_TRAILING_ENTITY_RE.search(body)
    if entity_match:
        body, entity = body[:entity_match.start()], entity_match.group()
        if _is_action_punctuation_entity(entity):
            entity = ""
    else:
        entity = ""
    body = _strip_trailing_action_punctuation(body)
    return f"{body}{entity}。{closers}{suffix}"


def _normalize_rendered_action_markdown(value: str) -> str | None:
    consumed = _rendered_action_markdown_marker_indices(value)
    if consumed is None:
        return None
    closing_start = len(value)
    while closing_start > 0 and closing_start - 1 in consumed:
        closing_start -= 1
    return (
        f"{_normalize_action_plain_tail(value[:closing_start])}"
        f"{value[closing_start:]}"
    )


def _normalize_rendered_action_markdown_label(value: str) -> str | None:
    consumed = _rendered_action_markdown_marker_indices(value)
    if consumed is None:
        return None
    closing_start = len(value)
    while closing_start > 0 and closing_start - 1 in consumed:
        closing_start -= 1
    body = value[:closing_start]
    if not _has_terminal_action_plain_punctuation(body):
        return None
    return f"{_normalize_action_plain_tail(body)}{value[closing_start:]}"


def _split_trailing_markdown_emphasis(value: str) -> tuple[str, str] | None:
    html_matches = list(_ACTION_MARKDOWN_HTML_SPLIT_RE.finditer(value))
    text_start = html_matches[-1].end() if html_matches else 0
    tail = value[text_start:]
    consumed = _rendered_action_markdown_marker_indices(tail)
    if consumed is None:
        return None
    for delimiter in _ACTION_MARKDOWN_EMPHASIS_DELIMITERS:
        if not tail.endswith(delimiter):
            continue
        closing_start = len(tail) - len(delimiter)
        opening_start = tail.rfind(delimiter, 0, closing_start)
        if (
            opening_start < 0
            or opening_start + len(delimiter) >= closing_start
            or any(
                index not in consumed
                for index in range(opening_start, opening_start + len(delimiter))
            )
            or any(
                index not in consumed
                for index in range(closing_start, closing_start + len(delimiter))
            )
        ):
            continue
        return value[:text_start + closing_start], delimiter
    return None



def _strip_trailing_action_markup(value: str) -> str:
    body = value
    while body:
        close_tags = _ACTION_TRAILING_CLOSE_TAGS_RE.search(body)
        if close_tags:
            body = body[:close_tags.start()]
            continue
        emphasis = _split_trailing_markdown_emphasis(body)
        if emphasis:
            body = emphasis[0]
            continue
        break
    return body


def _has_terminal_action_punctuation(value: str) -> bool:
    for delimiter in _ACTION_MARKDOWN_EMPHASIS_DELIMITERS:
        if (
            value.startswith(delimiter)
            and value.endswith(delimiter)
            and len(value) > len(delimiter) * 2
            and not _is_escaped_markdown_character(value, 0)
        ):
            return _has_terminal_action_punctuation(value[len(delimiter):-len(delimiter)])
    body, _ = _split_trailing_action_closers(value)
    closer_entity_match = _ACTION_TRAILING_CLOSER_ENTITY_RE.search(body)
    if closer_entity_match:
        body = body[:closer_entity_match.start()]
    body = _strip_trailing_action_markup(body)
    entity_match = _ACTION_TRAILING_ENTITY_RE.search(body)
    if entity_match:
        return _is_action_punctuation_entity(entity_match.group())
    return _ACTION_TRAILING_PUNCTUATION_RE.search(body) is not None


def _normalize_action_markdown_label(value: str) -> str:
    for delimiter in _ACTION_MARKDOWN_EMPHASIS_DELIMITERS:
        if (
            value.startswith(delimiter)
            and value.endswith(delimiter)
            and len(value) > len(delimiter) * 2
            and not _is_escaped_markdown_character(value, 0)
        ):
            return f"{delimiter}{_normalize_action_paragraph_segment(value[len(delimiter):-len(delimiter)])}{delimiter}"
    return _normalize_action_paragraph_segment(value)


def _split_trailing_action_closers(value: str) -> tuple[str, str]:
    match = _ACTION_TRAILING_CLOSERS_RE.search(value)
    if not match:
        return value, ""
    body, closers = value[:match.start()], match.group()
    for index, char in enumerate(closers):
        if char == ")" and _has_trailing_markdown_link(body + closers[:index + 1]):
            return body + closers[:index + 1], closers[index + 1:]
    return body, closers


def _normalize_action_paragraph_segment(segment: str) -> str:
    if not _has_visible_action_content(segment):
        return segment

    body, suffix = _split_trailing_action_suffix(segment)
    html_matches = list(_ACTION_MARKDOWN_HTML_SPLIT_RE.finditer(body))
    text_start = html_matches[-1].end() if html_matches else 0
    text_prefix, text_tail = body[:text_start], body[text_start:]
    markdown_link = _trailing_markdown_link_parts(text_tail)
    if markdown_link is not None:
        prefix, label, link_suffix = markdown_link
        normalized_label = _normalize_rendered_action_markdown_label(label)
        if normalized_label is not None:
            return (
                f"{text_prefix}{prefix}{normalized_label}{link_suffix}{suffix}"
            )
        return f"{text_prefix}{_normalize_action_plain_tail(text_tail)}{suffix}"

    # The editor converts Markdown separately in each HTML/comment-delimited
    # text segment.  A bracket pair spanning such a boundary stays literal.
    if html_matches and _trailing_markdown_link_parts(body) is not None:
        return f"{_normalize_action_plain_tail(body)}{suffix}"

    if any(char in text_tail for char in "*＊_"):
        normalized_markdown = _normalize_rendered_action_markdown(text_tail)
        if normalized_markdown is None:
            normalized_markdown = _normalize_action_plain_tail(text_tail)
        return f"{text_prefix}{normalized_markdown}{suffix}"

    return f"{_normalize_action_plain_tail(body)}{suffix}"


def normalize_action_paragraph_endings(value: str) -> str:
    """Canonicalize each visible action paragraph terminator without touching markup."""

    if not isinstance(value, str) or not value:
        return value
    return "".join(
        part if is_boundary else _normalize_action_paragraph_segment(part)
        for part, is_boundary in _action_boundary_parts(value)
    )
_CHOICE_KEYS = {"value": "value", "label": "label"}
_EXPERIENCE_FIELDS = frozenset({"star.s", "star.t", "star.a", "star.r"})
_EXPERIENCE_QUESTION_FIELDS = _EXPERIENCE_FIELDS | frozenset(
    {"responsibility", "ownership", "method", "result", "scale", "causality"}
)
_PERSONAL_SUMMARY_MODULE_IDS = frozenset(
    {"personal_summary", "current_resume", "resume"}
)
_PERSONAL_SUMMARY_FIELDS = frozenset({"personal_summary", "personalSummary"})
_SKILLS_ORDER_FIELDS = frozenset(
    {"skills.order", "skillsOrder", "selection.skillIds"}
)
_SECTION_ORDER_FIELDS = frozenset({"section_order", "sectionOrder"})
_OTHER_PROJECT_MARKERS = (
    "another project",
    "other project",
    "另一个项目",
    "其他项目",
    "其它项目",
    "别的项目",
)


class OptimizationPlanNormalizationError(ValueError):
    """The entire model plan is rejected when any entry violates the contract."""

    code = "resume_optimization_plan_invalid"


@dataclass(frozen=True)
class _SourceValidationContext:
    source_documents: Mapping[str, Any]
    answer_question_modules: Mapping[str, str]
    answer_states: Mapping[str, str]
    answer_change_ids: Mapping[str, frozenset[str]]
    allow_user_answers: bool = False


def _fail(message: str) -> None:
    raise OptimizationPlanNormalizationError(message)


def _bounded_string_limit() -> int:
    return min(
        MAX_MODEL_STRING_CHARS,
        runtime_budget.get_ai_runtime_budget().max_text_field_chars,
    )


def _reject_oversized_strings(value: Any, *, path: str = "result") -> None:
    limit = _bounded_string_limit()
    if isinstance(value, str):
        if len(value) > limit:
            _fail(f"{path} exceeds the {limit}-character model-output limit")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            _reject_oversized_strings(item, path=f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _reject_oversized_strings(item, path=f"{path}[{index}]")


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _stable_id(prefix: str, value: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest.upper()}"


def _alias_object(
    raw: Any,
    *,
    aliases: Mapping[str, str],
    path: str,
) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        _fail(f"{path} must be an object")
    result: dict[str, Any] = {}
    allowed = set(aliases) | set(aliases.values())
    unknown = set(raw) - allowed
    if unknown:
        _fail(f"{path} contains unsupported fields: {sorted(unknown)}")
    for key, value in raw.items():
        normalized_key = aliases.get(key, key)
        if normalized_key in result:
            _fail(f"{path} repeats field {normalized_key}")
        result[normalized_key] = value
    return result


def _normalize_choices(raw: Any, *, path: str) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        _fail(f"{path} must be an array")
    return [
        _alias_object(item, aliases=_CHOICE_KEYS, path=f"{path}[{index}]")
        for index, item in enumerate(raw)
    ]


def _decode_pointer_token(token: str) -> str:
    if re.search(r"~(?![01])", token):
        _fail("sourceRefs must use valid RFC 6901 escaping")
    return token.replace("~1", "/").replace("~0", "~")


def _pointer_segments(source_ref: str) -> list[str]:
    if not source_ref.startswith("/"):
        _fail("sourceRefs must be absolute RFC 6901 JSON pointers")
    segments = [_decode_pointer_token(token) for token in source_ref[1:].split("/")]
    if not segments or any(not segment for segment in segments):
        _fail("sourceRefs must contain non-empty RFC 6901 segments")
    if segments[0] not in {
        "currentResume",
        "selectedSourceExperiences",
        "userAnswers",
    }:
        _fail("sourceRefs must use an exact allowed frozen-context root")
    return segments


def _resolve_pointer(source_documents: Mapping[str, Any], segments: Sequence[str]) -> Any:
    cursor: Any = source_documents
    for segment in segments:
        if isinstance(cursor, Mapping) and segment in cursor:
            cursor = cursor[segment]
            continue
        if isinstance(cursor, list) and segment.isdigit():
            index = int(segment)
            if index < len(cursor):
                cursor = cursor[index]
                continue
        _fail("sourceRef does not resolve inside the supplied sourceDocuments")
    return cursor


def _validate_source_refs(
    change: OptimizationChange,
    *,
    selected_master_ids: set[str],
    source_context: _SourceValidationContext | None,
) -> None:
    for source_ref in change.source_refs:
        segments = _pointer_segments(source_ref)
        root = segments[0]
        if root == "currentResume":
            if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
                if len(segments) < 4 or segments[1:3] != [
                    "experiences",
                    change.module_id,
                ]:
                    _fail("current-resume experience refs must use the same module ID")
            elif change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
                is_summary = segments[1:] == ["personal_summary"]
                is_selected_experience = (
                    len(segments) >= 4
                    and segments[1] == "experiences"
                    and segments[2] in selected_master_ids
                )
                is_selected_skills = segments[1:2] == ["skills"]
                if not (is_summary or is_selected_experience or is_selected_skills):
                    _fail("personal-summary refs must use the summary or a selected experience")
            elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
                if segments[1:2] != ["skills"]:
                    _fail("skills-order refs must use currentResume.skills")
            elif change.module_type == OptimizationModuleType.SECTION_ORDER:
                if segments[1:] != ["section_order"]:
                    _fail("section-order refs must use currentResume.section_order")
        elif root == "selectedSourceExperiences":
            if len(segments) < 3 or segments[1] not in selected_master_ids:
                _fail("selected-source refs must name a selected experience")
            if (
                change.module_type == OptimizationModuleType.EXPERIENCE_STAR
                and segments[1] != change.module_id
            ):
                _fail("selected source references must belong to the same experience")
            if change.module_type not in {
                OptimizationModuleType.EXPERIENCE_STAR,
                OptimizationModuleType.PERSONAL_SUMMARY,
            }:
                _fail("order changes cannot use experience text as a source")
        else:
            if source_context is None or not source_context.allow_user_answers:
                _fail("planning sourceRefs must not cite userAnswers")
            if len(segments) != 3 or segments[2] != "value":
                _fail("answer sourceRefs must have shape /userAnswers/{id}/value")
            question_module = source_context.answer_question_modules.get(segments[1])
            if question_module is None:
                _fail("answer sourceRef cites an unsubmitted question")
            if source_context.answer_states.get(segments[1]) != "answered":
                _fail("only an answered response may be cited as rewrite evidence")
            if question_module != change.module_id:
                _fail("answer sourceRef question must target the same module")
            if change.change_id not in source_context.answer_change_ids.get(
                segments[1], frozenset()
            ):
                _fail("answer sourceRef question must be linked to the same change")

        if source_context is not None:
            _resolve_pointer(source_context.source_documents, segments)


def _validate_change_target(
    change: OptimizationChange,
    *,
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_context: _SourceValidationContext | None,
) -> None:
    if change.action_kind == OptimizationAction.SUGGEST_FROM_BANK:
        _fail("the model must never generate bank suggestions")

    is_unsupported_sentinel = (
        change.module_type == OptimizationModuleType.PERSONAL_SUMMARY
        and change.module_id == "current_resume"
        and change.field_path == "unsupported"
    )
    if is_unsupported_sentinel:
        if not (
            change.action_kind == OptimizationAction.LEAVE_UNCHANGED
            and change.before_value is None
            and change.general_value is None
            and change.targeted_value is None
            and not change.source_refs
            and not change.introduced_terms
            and change.expected_score_gain == 0
            and change.default_selected is False
        ):
            _fail("unsupported sentinel must use the exact read-only safe contract")
        return

    if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
        if change.module_id not in selected_master_ids:
            _fail("experience changes must target a selected experience")
        if change.field_path not in _EXPERIENCE_FIELDS:
            _fail("experience changes may target only STAR fields")
    elif change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        if change.module_id not in _PERSONAL_SUMMARY_MODULE_IDS:
            _fail("personal-summary changes must target the current resume")
        if change.field_path not in _PERSONAL_SUMMARY_FIELDS:
            _fail("unsupported personal-summary path")
    elif change.module_type == OptimizationModuleType.SKILLS_ORDER:
        if change.module_id != "skills" or change.field_path not in _SKILLS_ORDER_FIELDS:
            _fail("unsupported skills-order module or path")
        if change.before_value != list(change.before_value):
            _fail("skills-order beforeValue must be an array")
        if set(change.before_value) != selected_skill_ids or len(change.before_value) != len(
            selected_skill_ids
        ):
            _fail("skills-order changes must contain exactly the selected skill IDs")
    elif change.module_type == OptimizationModuleType.SECTION_ORDER:
        if change.module_id != "sections" or change.field_path not in _SECTION_ORDER_FIELDS:
            _fail("unsupported section-order module or path")
        if change.before_value != current_section_order:
            _fail("section-order beforeValue must match the current section order")
    else:
        _fail("unsupported optimization module")

    _validate_source_refs(
        change,
        selected_master_ids=selected_master_ids,
        source_context=source_context,
    )


def _normalize_change(
    raw: Any,
    *,
    index: int,
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_context: _SourceValidationContext | None,
) -> OptimizationChange:
    value = _alias_object(raw, aliases=_CHANGE_KEYS, path=f"changes[{index}]")
    # These two addresses name unique current-resume collections. Canonicalize
    # only the documented resume alias; unknown IDs and mismatched fields still
    # fail below, and the full selected-ID permutation is still checked.
    if isinstance(value.get("module_id"), str) and value["module_id"] in {"current_resume", "resume"}:
        address = (value.get("module_type"), value.get("field_path"))
        if address == ("skills_order", "skills.order"):
            value["module_id"] = "skills"
        elif address == ("section_order", "section_order"):
            value["module_id"] = "sections"
    raw_id = value.pop("change_id", None)
    if raw_id is not None and (not isinstance(raw_id, str) or not raw_id.strip()):
        _fail(f"changes[{index}].changeId must be a non-empty string when provided")
    placeholder_id = raw_id or "__SERVER_GENERATED_CHANGE_ID__"
    try:
        change = OptimizationChange(change_id=placeholder_id, **value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationPlanNormalizationError(
            f"changes[{index}] violates the optimization contract"
        ) from exc
    _validate_change_target(
        change,
        selected_master_ids=selected_master_ids,
        selected_skill_ids=selected_skill_ids,
        current_section_order=current_section_order,
        source_context=source_context,
    )
    if (
        change.module_type == OptimizationModuleType.EXPERIENCE_STAR
        and change.field_path == "star.a"
    ):
        updates = {
            field: normalize_action_paragraph_endings(candidate)
            for field, candidate in (
                ("general_value", change.general_value),
                ("targeted_value", change.targeted_value),
            )
            if isinstance(candidate, str)
        }
        if updates:
            change = change.model_copy(update=updates)
        if (
            change.action_kind == OptimizationAction.REWRITE_NOW
            and change.general_value == change.before_value
            and change.targeted_value == change.before_value
        ):
            change = change.model_copy(
                update={
                    "action_kind": OptimizationAction.LEAVE_UNCHANGED,
                    "expected_score_gain": 0,
                    "default_selected": False,
                }
            )
    if raw_id is None:
        generated = _stable_id("CHG", value)
        change = change.model_copy(update={"change_id": generated})
    return change


def _validate_question_target(
    question: OptimizationQuestion,
    *,
    changes_by_id: Mapping[str, OptimizationChange],
    selected_master_ids: set[str],
) -> None:
    if question.module_id in selected_master_ids:
        if question.field_path not in _EXPERIENCE_QUESTION_FIELDS:
            _fail("unsupported selected-experience question path")
    elif question.module_id in _PERSONAL_SUMMARY_MODULE_IDS:
        if question.field_path not in _PERSONAL_SUMMARY_FIELDS:
            _fail("unsupported personal-summary question path")
    else:
        _fail("questions may target only a selected experience or current summary")

    question_text = f"{question.text} {question.reason}".lower()
    if any(marker in question_text for marker in _OTHER_PROJECT_MARKERS):
        _fail("questions must not ask about another project")
    if not question.affects_change_ids:
        _fail("each question must affect at least one ask_user change")
    for change_id in question.affects_change_ids:
        change = changes_by_id.get(change_id)
        if change is None:
            _fail("question references an unknown change ID")
        if change.action_kind != OptimizationAction.ASK_USER:
            _fail("questions may affect only ask_user changes")
        if change.module_id != question.module_id:
            _fail("question and affected change must target the same module")


def _normalize_question(
    raw: Any,
    *,
    index: int,
    changes_by_id: Mapping[str, OptimizationChange],
    selected_master_ids: set[str],
) -> OptimizationQuestion:
    value = _alias_object(raw, aliases=_QUESTION_KEYS, path=f"questions[{index}]")
    value["choices"] = _normalize_choices(
        value.get("choices"), path=f"questions[{index}].choices"
    )
    raw_id = value.pop("question_id", None)
    if raw_id is not None and (not isinstance(raw_id, str) or not raw_id.strip()):
        _fail(f"questions[{index}].questionId must be non-empty when provided")
    placeholder_id = raw_id or "__SERVER_GENERATED_QUESTION_ID__"
    try:
        question = OptimizationQuestion(question_id=placeholder_id, **value)
    except (TypeError, ValidationError, ValueError) as exc:
        raise OptimizationPlanNormalizationError(
            f"questions[{index}] violates the optimization contract"
        ) from exc
    if not question.text.strip() or not question.reason.strip():
        _fail("question text and reason must not be empty")
    _validate_question_target(
        question,
        changes_by_id=changes_by_id,
        selected_master_ids=selected_master_ids,
    )
    if raw_id is None:
        question = question.model_copy(
            update={"question_id": _stable_id("Q", value)}
        )
    return question


def _validate_issue_coverage(
    changes: Sequence[OptimizationChange],
    *,
    known_issue_dimensions: Mapping[str, str],
) -> None:
    known_issue_ids = set(known_issue_dimensions)
    for issue_id, dimension in known_issue_dimensions.items():
        if not isinstance(issue_id, str) or not issue_id.strip():
            _fail("known issue IDs must be non-empty strings")
        if dimension not in RESUME_EVALUATION_DIMENSION_NAMES:
            _fail("known issue primaryDimension must be one of the fixed six dimensions")

    covered: set[str] = set()
    routed_fields: set[tuple[str, str, str]] = set()
    for change in changes:
        if change.dimension not in RESUME_EVALUATION_DIMENSION_NAMES:
            _fail("change dimension must be one of the fixed six dimensions")
        if not change.issue_ids:
            _fail("every change must reference at least one issue ID")
        if len(set(change.issue_ids)) != len(change.issue_ids):
            _fail("a change must not repeat issue IDs")
        issue_dimensions: set[str] = set()
        for issue_id in change.issue_ids:
            if issue_id not in known_issue_ids:
                _fail("a change references an unknown issue ID")
            route = (issue_id, change.module_id, change.field_path)
            if route in routed_fields:
                _fail("each issue ID must be routed exactly once per field")
            routed_fields.add(route)
            covered.add(issue_id)
            issue_dimensions.add(known_issue_dimensions[issue_id])
        if len(issue_dimensions) != 1 or change.dimension not in issue_dimensions:
            _fail(
                "change dimension must match every covered issue primaryDimension"
            )
    if covered != known_issue_ids:
        _fail("the plan must route every known issue ID exactly once")


def _canonical_mutable_target(change: OptimizationChange) -> tuple[str, str]:
    """Return the persisted field occupied by a mutable plan change.

    This deliberately mirrors apply-time config aliases without importing the
    apply service, which would create a normalization/apply dependency cycle.
    """

    if change.module_type == OptimizationModuleType.EXPERIENCE_STAR:
        return (f"experience:{change.module_id}", change.field_path)
    if change.module_type == OptimizationModuleType.PERSONAL_SUMMARY:
        return ("config", "personalSummary")
    if change.module_type == OptimizationModuleType.SKILLS_ORDER:
        return ("config", "selection.skillIds")
    if change.module_type == OptimizationModuleType.SECTION_ORDER:
        return ("config", "layout.sectionOrder")
    _fail("unsupported mutable optimization target")


def normalize_optimization_plan(
    raw: Any,
    *,
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    known_issue_dimensions: Mapping[str, str] | None = None,
    known_issue_ids: set[str] | None = None,
    _source_context: _SourceValidationContext | None = None,
    max_questions: int = 5,
) -> OptimizationPlan:
    """Normalize a model plan using whole-plan, fail-closed rejection.

    Unsafe entries are never dropped or converted to rewrites: one invalid entry
    rejects the complete model result so callers can retry or fail explicitly.
    """

    if not isinstance(raw, Mapping):
        _fail("optimization plan root must be an object")
    if known_issue_dimensions is None:
        _fail("known issue dimensions are required")
    elif known_issue_ids is not None and set(known_issue_dimensions) != known_issue_ids:
        _fail("known issue ID and dimension inputs disagree")
    _reject_oversized_strings(raw)
    allowed_root_keys = {
        "changes",
        "questions",
        "bankSuggestions",
        "bank_suggestions",
    }
    unknown_root_keys = set(raw) - allowed_root_keys
    if unknown_root_keys:
        _fail(f"optimization plan contains unsupported fields: {sorted(unknown_root_keys)}")
    raw_changes = raw.get("changes", [])
    raw_questions = raw.get("questions", [])
    if not isinstance(raw_changes, list) or not isinstance(raw_questions, list):
        _fail("changes and questions must be arrays")
    if len(raw_questions) > min(5, max_questions):
        _fail(f"optimization plan may contain at most {min(5, max_questions)} questions")
    if "bankSuggestions" in raw and "bank_suggestions" in raw:
        _fail("bank suggestion root aliases must not both be present")
    bank_suggestions = raw.get("bankSuggestions", raw.get("bank_suggestions", []))
    if bank_suggestions not in (None, []):
        _fail("the model must never generate bank suggestions")

    changes = [
        _normalize_change(
            item,
            index=index,
            selected_master_ids=selected_master_ids,
            selected_skill_ids=selected_skill_ids,
            current_section_order=current_section_order,
            source_context=_source_context,
        )
        for index, item in enumerate(raw_changes)
    ]
    change_ids = [change.change_id for change in changes]
    if len(set(change_ids)) != len(change_ids):
        _fail("change IDs must be unique, including server-generated IDs")
    mutable_targets = [
        _canonical_mutable_target(change)
        for change in changes
        if change.action_kind in {
            OptimizationAction.REWRITE_NOW,
            OptimizationAction.ASK_USER,
        }
    ]
    if len(set(mutable_targets)) != len(mutable_targets):
        _fail("rewrite and ask_user changes must target distinct resume fields")
    _validate_issue_coverage(
        changes,
        known_issue_dimensions=known_issue_dimensions,
    )

    changes_by_id = {change.change_id: change for change in changes}
    questions = [
        _normalize_question(
            item,
            index=index,
            changes_by_id=changes_by_id,
            selected_master_ids=selected_master_ids,
        )
        for index, item in enumerate(raw_questions)
    ]
    question_ids = [question.question_id for question in questions]
    if len(set(question_ids)) != len(question_ids):
        _fail("question IDs must be unique, including server-generated IDs")

    affected_ask_change_ids = [
        change_id
        for question in questions
        for change_id in question.affects_change_ids
    ]
    required_ask_change_ids = {
        change.change_id
        for change in changes
        if change.action_kind == OptimizationAction.ASK_USER
    }
    if (
        len(affected_ask_change_ids) != len(set(affected_ask_change_ids))
        or set(affected_ask_change_ids) != required_ask_change_ids
    ):
        _fail("every ask_user change must be covered by exactly one question")

    return OptimizationPlan(changes=changes, questions=questions)


def normalize_answered_optimization_changes(
    raw: Any,
    *,
    expected_changes: Sequence[OptimizationChange],
    selected_master_ids: set[str],
    selected_skill_ids: set[str],
    current_section_order: list[str],
    source_documents: Mapping[str, Any],
    answer_question_modules: Mapping[str, str],
    answer_states: Mapping[str, str],
    answer_change_ids: Mapping[str, frozenset[str]],
    known_issue_dimensions: Mapping[str, str],
) -> list[OptimizationChange]:
    if not isinstance(raw, Mapping) or set(raw) != {"changes"}:
        _fail("answer rewrite must return only a changes object")
    expected_by_id = {change.change_id: change for change in expected_changes}
    if not isinstance(raw["changes"], list):
        _fail("answer changes must be an array")
    completed_changes=[]
    for index, item in enumerate(raw["changes"]):
        proposal=_alias_object(item,aliases=_CHANGE_KEYS,path=f"changes[{index}]")
        cid=proposal.get("change_id")
        if not isinstance(cid,str) or cid not in expected_by_id:
            _fail("answer proposal must identify an affected change")
        is_patch=not any(key in proposal for key in {
            "module_type","module_id","field_path","issue_ids","before_value",
            "dimension","scope","default_selected",
        })
        if is_patch:
            if proposal.get("action_kind")=="rewrite":
                proposal["action_kind"]="rewrite_now"
            if (proposal.get("action_kind")=="rewrite_now"
                    and isinstance(proposal.get("general_value"),str)
                    and proposal.get("targeted_value") is None):
                proposal["targeted_value"]=proposal["general_value"]
        # Identity, beforeValue and selection state are server-owned. Legacy
        # full replies still undergo the unchanged strict identity checks below.
        expected_change = expected_by_id[cid]
        original=expected_change.model_dump(mode="json")
        # Internal compatibility value is intentionally excluded from public
        # model serialization, but the normalizer still needs a complete
        # server-owned identity map while applying an answer PATCH.
        original["expected_score_gain"] = expected_change.expected_score_gain
        completed_changes.append({**{key:original[key] for key in set(_CHANGE_KEYS.values())},**proposal})
    expected_issue_ids = {
        issue_id for change in expected_changes for issue_id in change.issue_ids
    }
    missing_issue_dimensions = expected_issue_ids - set(known_issue_dimensions)
    if missing_issue_dimensions:
        _fail("answer rewrite expected issue is absent from the frozen evaluation")
    local_issue_dimensions = {
        issue_id: known_issue_dimensions[issue_id]
        for issue_id in expected_issue_ids
    }
    plan = normalize_optimization_plan(
        {"changes": completed_changes, "questions": []},
        known_issue_dimensions=local_issue_dimensions,
        selected_master_ids=selected_master_ids,
        selected_skill_ids=selected_skill_ids,
        current_section_order=current_section_order,
        _source_context=_SourceValidationContext(
            source_documents=source_documents,
            answer_question_modules=answer_question_modules,
            answer_states=answer_states,
            answer_change_ids=answer_change_ids,
            allow_user_answers=True,
        ),
    )
    if set(change.change_id for change in plan.changes) != set(expected_by_id):
        _fail("answer rewrite changed the affected change-ID set")
    for change in plan.changes:
        expected = expected_by_id[change.change_id]
        if (
            change.module_type != expected.module_type
            or change.module_id != expected.module_id
            or change.field_path != expected.field_path
            or change.issue_ids != expected.issue_ids
            or change.before_value != expected.before_value
            or change.dimension != expected.dimension
            or change.scope != expected.scope
            or change.default_selected != expected.default_selected
        ):
            _fail("answer rewrite changed an affected change identity or source value")
        submitted_for_change = {
            question_id
            for question_id, change_ids in answer_change_ids.items()
            if change.change_id in change_ids
        }
        answered_for_change = {
            question_id
            for question_id in submitted_for_change
            if answer_states.get(question_id) == "answered"
        }
        cited_answer_ids = {
            segments[1]
            for source_ref in change.source_refs
            if (segments := _pointer_segments(source_ref))[0] == "userAnswers"
        }
        if change.action_kind == OptimizationAction.REWRITE_NOW and not (
            cited_answer_ids & answered_for_change
        ):
            _fail(
                "rewrite_now requires a linked submitted answered userAnswers sourceRef"
            )
        if not answered_for_change:
            if change.action_kind != OptimizationAction.LEAVE_UNCHANGED:
                _fail("non-answered responses may only produce leave_unchanged")
            for candidate in (change.general_value, change.targeted_value):
                if candidate is not None and candidate != change.before_value:
                    _fail("leave_unchanged must not introduce a new candidate value")
    return plan.changes
