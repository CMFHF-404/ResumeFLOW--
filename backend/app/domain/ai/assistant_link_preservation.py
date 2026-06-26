import html
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Iterator, List
from urllib.parse import urlparse


STAR_KEYS = ("s", "t", "a", "r")
HTML_LINK_PATTERN = re.compile(
    r"<a\b(?=[^>]*\bhref\s*=\s*(['\"])(.*?)\1)[^>]*>(.*?)</a>",
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True)
class SourceLink:
    anchor: str
    href: str
    markup: str


@dataclass(frozen=True)
class MarkdownLink:
    anchor: str
    href: str
    markup: str


def _find_markdown_link_close(value: str, start: int) -> int:
    depth = 0
    escaped = False
    for index in range(start, len(value)):
        char = value[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char in "\r\n":
            return -1
        if char == "(":
            depth += 1
            continue
        if char == ")":
            if depth == 0:
                return index
            depth -= 1
    return -1


def _split_markdown_href(link_body: str) -> str:
    body = link_body.strip()
    if not body:
        return ""
    if body.startswith("<"):
        closing = body.find(">")
        if closing > 0:
            return body[1:closing].strip()

    depth = 0
    escaped = False
    for index, char in enumerate(body):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "(":
            depth += 1
            continue
        if char == ")" and depth > 0:
            depth -= 1
            continue
        if char.isspace() and depth == 0:
            return body[:index].strip()
    return body


def _iter_markdown_links(value: str) -> Iterator[MarkdownLink]:
    cursor = 0
    while cursor < len(value):
        anchor_start = value.find("[", cursor)
        if anchor_start == -1:
            return
        anchor_end = value.find("]", anchor_start + 1)
        if anchor_end == -1:
            return
        anchor = value[anchor_start + 1 : anchor_end]
        if "\r" in anchor or "\n" in anchor:
            cursor = anchor_start + 1
            continue
        if anchor_end + 1 >= len(value) or value[anchor_end + 1] != "(":
            cursor = anchor_start + 1
            continue
        body_start = anchor_end + 2
        body_end = _find_markdown_link_close(value, body_start)
        if body_end == -1:
            cursor = anchor_start + 1
            continue
        yield MarkdownLink(
            anchor=anchor.strip(),
            href=_split_markdown_href(value[body_start:body_end]),
            markup=value[anchor_start : body_end + 1],
        )
        cursor = body_end + 1


def _is_safe_href(href: str) -> bool:
    parsed = urlparse(href.strip())
    return parsed.scheme.lower() in {"http", "https", "mailto"} and bool(parsed.geturl())


def _strip_html(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", "", value)
    return html.unescape(without_tags).strip()


def _extract_source_links(value: Any) -> List[SourceLink]:
    if not isinstance(value, str) or not value.strip():
        return []

    links: List[SourceLink] = []
    seen: set[str] = set()

    for match in _iter_markdown_links(value):
        if not match.anchor or not _is_safe_href(match.href) or match.href in seen:
            continue
        seen.add(match.href)
        links.append(SourceLink(anchor=match.anchor, href=match.href, markup=match.markup))

    for match in HTML_LINK_PATTERN.finditer(value):
        href = match.group(2).strip()
        anchor = _strip_html(match.group(3))
        if not anchor or not _is_safe_href(href) or href in seen:
            continue
        seen.add(href)
        links.append(SourceLink(anchor=anchor, href=href, markup=match.group(0)))

    return links


def _field_contains_href(value: str, href: str) -> bool:
    target = href.strip()
    if not target:
        return False
    escaped_target = html.escape(target, quote=True)
    for match in _iter_markdown_links(value):
        if match.href == target:
            return True
    for match in HTML_LINK_PATTERN.finditer(value):
        candidate = match.group(2).strip()
        if candidate == target or candidate == escaped_target or html.unescape(candidate) == target:
            return True
    return False


def _field_has_linked_anchor(value: str, anchor: str) -> bool:
    for match in _iter_markdown_links(value):
        if match.anchor == anchor:
            return True
    for match in HTML_LINK_PATTERN.finditer(value):
        if _strip_html(match.group(3)) == anchor:
            return True
    return False


def _wrap_anchor_once(value: str, link: SourceLink) -> str | None:
    if not link.anchor or link.anchor not in value:
        return None
    if _field_has_linked_anchor(value, link.anchor):
        return None
    pattern = re.compile(re.escape(link.anchor))
    return pattern.sub(link.markup, value, count=1)


def _append_link(value: str, link: SourceLink) -> str:
    separator = "\n" if "\n" in value else ""
    suffix = link.markup
    if not value.strip():
        return suffix
    if value.rstrip().endswith(("。", ".", "；", ";")):
        return f"{value.rstrip()}{separator}{suffix}"
    return f"{value.rstrip()}（{suffix}）"


def _preserve_field_links(draft_value: Any, source_values: Iterable[Any]) -> Any:
    if not isinstance(draft_value, str):
        return draft_value
    next_value = draft_value
    for source_value in source_values:
        for link in _extract_source_links(source_value):
            if _field_contains_href(next_value, link.href):
                continue
            wrapped = _wrap_anchor_once(next_value, link)
            next_value = wrapped if wrapped is not None else _append_link(next_value, link)
    return next_value


def _normalize_source_stars(source_stars: Iterable[Any] | None) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for item in source_stars or []:
        if isinstance(item, dict):
            normalized.append(item)
    return normalized


def preserve_draft_card_star_links(
    draft_card: Dict[str, Any] | None,
    source_stars: Iterable[Dict[str, Any]] | None,
) -> Dict[str, Any] | None:
    if not isinstance(draft_card, dict) or draft_card.get("type") != "experience":
        return draft_card
    data = draft_card.get("data")
    if not isinstance(data, dict):
        return draft_card
    star = data.get("star")
    if not isinstance(star, dict):
        return draft_card

    normalized_sources = _normalize_source_stars(source_stars)
    if not normalized_sources:
        return draft_card

    next_star = dict(star)
    changed = False
    for key in STAR_KEYS:
        source_values = [source.get(key) for source in normalized_sources]
        preserved = _preserve_field_links(next_star.get(key), source_values)
        if preserved != next_star.get(key):
            next_star[key] = preserved
            changed = True

    if not changed:
        return draft_card

    next_data = dict(data)
    next_data["star"] = next_star
    next_card = dict(draft_card)
    next_card["data"] = next_data
    return next_card


def preserve_assistant_result_star_links(
    result: Dict[str, Any],
    source_stars: Iterable[Dict[str, Any]] | None,
) -> Dict[str, Any]:
    draft_card = preserve_draft_card_star_links(result.get("draftCard"), source_stars)
    if draft_card is result.get("draftCard"):
        return result
    return {
        **result,
        "draftCard": draft_card,
    }
