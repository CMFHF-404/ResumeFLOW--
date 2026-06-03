import re
from typing import Any, Dict, List

ASSISTANT_ACTION_ORDERED_PREFIX_PATTERN = re.compile(r"^\s*\d+[.、)）]\s*(.+)$")
ASSISTANT_ACTION_UNORDERED_PREFIX_PATTERN = re.compile(r"^\s*[-*＊•·]\s*(.+)$")
ASSISTANT_ACTION_INLINE_ORDERED_PATTERN = re.compile(r"^\s*\d+[.、)）]\s*.+$")
ASSISTANT_ACTION_INLINE_ORDERED_SPLIT_PATTERN = re.compile(r"(?=\d+[.、)）]\s+)")
ASSISTANT_ACTION_ORDERED_LINE_PATTERN = re.compile(r"^\s*(\d+)([.、)）])\s*(.+)$")
ASSISTANT_ACTION_UNORDERED_LINE_PATTERN = re.compile(r"^\s*([-*＊•·])\s*(.+)$")
ASSISTANT_PLAIN_ITALIC_MARKDOWN_PATTERN = re.compile(r"^\*[^*\r\n]+\*$")


def _split_inline_ordered_action_lines(line: str) -> List[str] | None:
    if not ASSISTANT_ACTION_INLINE_ORDERED_PATTERN.match(line):
        return None
    parts = [
        segment.strip()
        for segment in ASSISTANT_ACTION_INLINE_ORDERED_SPLIT_PATTERN.split(line.strip())
        if segment.strip()
    ]
    if len(parts) <= 1:
        return None
    if any(not _is_likely_ordered_action_line(part) for part in parts):
        return None
    return parts


def _is_plain_italic_markdown(value: str) -> bool:
    return bool(ASSISTANT_PLAIN_ITALIC_MARKDOWN_PATTERN.fullmatch(value.strip()))


def _is_likely_ordered_action_line(value: str) -> bool:
    match = ASSISTANT_ACTION_ORDERED_LINE_PATTERN.match(value)
    if not match:
        return False
    number_part = match.group(1)
    content = (match.group(3) or "").strip()
    if not content:
        return False
    if len(number_part) >= 3:
        return False
    if content.startswith(tuple("0123456789")):
        return False
    return True


def _is_likely_unordered_action_line(value: str) -> bool:
    match = ASSISTANT_ACTION_UNORDERED_LINE_PATTERN.match(value)
    if not match:
        return False
    bullet = match.group(1)
    content = (match.group(2) or "").strip()
    if not content:
        return False
    if bullet in {"*", "＊"} and _is_plain_italic_markdown(value):
        return False
    if bullet == "-" and content.startswith(tuple("0123456789")):
        return False
    return True


def _strip_action_list_prefix(line: str) -> str:
    ordered_match = ASSISTANT_ACTION_ORDERED_PREFIX_PATTERN.match(line)
    if ordered_match and _is_likely_ordered_action_line(line):
        return ordered_match.group(1).strip()
    unordered_match = ASSISTANT_ACTION_UNORDERED_PREFIX_PATTERN.match(line)
    if unordered_match and _is_likely_unordered_action_line(line):
        return unordered_match.group(1).strip()
    return line.strip()


def _normalize_assistant_action_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None

    lines = [line.strip() for line in re.split(r"\r?\n+", trimmed) if line.strip()]
    if len(lines) == 1:
        inline_lines = _split_inline_ordered_action_lines(lines[0])
        if inline_lines:
            lines = inline_lines

    normalized_lines = [_strip_action_list_prefix(line) for line in lines]
    normalized_lines = [line for line in normalized_lines if line]
    if not normalized_lines:
        return None
    return "\n".join(normalized_lines)


def _normalize_assistant_draft_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalize_assistant_skill_group_card(card: Dict[str, Any]) -> Dict[str, Any] | None:
    data = card.get("data")
    if not isinstance(data, dict):
        return None

    raw_skills = data.get("skills")
    if not isinstance(raw_skills, list):
        return None

    normalized_skills: List[Dict[str, Any]] = []
    for raw_skill in raw_skills:
        if isinstance(raw_skill, str):
            name = _normalize_assistant_draft_text(raw_skill)
            if name:
                normalized_skills.append({"name": name})
            continue
        if not isinstance(raw_skill, dict):
            continue
        name = _normalize_assistant_draft_text(raw_skill.get("name"))
        if not name:
            continue
        normalized_skill = {"name": name}
        target_user_skill_id = _normalize_assistant_draft_text(raw_skill.get("targetUserSkillId"))
        if target_user_skill_id:
            normalized_skill["targetUserSkillId"] = target_user_skill_id
        normalized_skills.append(normalized_skill)

    if not normalized_skills:
        return None

    normalized_card = dict(card)
    normalized_card["data"] = {
        "category": _normalize_assistant_draft_text(data.get("category")),
        "skills": normalized_skills,
    }
    return normalized_card


def _normalize_legacy_education_draft_card(card: Dict[str, Any]) -> Dict[str, Any]:
    data = card.get("data")
    if not isinstance(data, dict):
        data = {}
    star = data.get("star")
    if not isinstance(star, dict):
        star = {}

    normalized_data = {
        "category": "education",
        "org": _normalize_assistant_draft_text(data.get("org")),
        "title": _normalize_assistant_draft_text(data.get("title")),
        "startDate": _normalize_assistant_draft_text(data.get("startDate")),
        "endDate": _normalize_assistant_draft_text(data.get("endDate")),
        "isCurrent": bool(data.get("isCurrent")),
        "star": {
            "s": _normalize_assistant_draft_text(star.get("s")),
            "t": _normalize_assistant_draft_text(star.get("t")),
            "a": _normalize_assistant_draft_text(star.get("a")),
            "r": _normalize_assistant_draft_text(star.get("r")),
        },
    }
    target_master_id = _normalize_assistant_draft_text(data.get("targetMasterId"))
    if target_master_id:
        normalized_data["targetMasterId"] = target_master_id

    normalized_card = dict(card)
    normalized_card["type"] = "experience"
    normalized_card["data"] = normalized_data
    return normalized_card


def _normalize_assistant_draft_card(card: Any) -> Dict[str, Any] | None:
    if not isinstance(card, dict):
        return None

    normalized_card = dict(card)
    card_type = normalized_card.get("type")
    if card_type == "education":
        return _normalize_legacy_education_draft_card(normalized_card)

    if card_type == "skill_group":
        return _normalize_assistant_skill_group_card(normalized_card)

    if card_type != "experience":
        return normalized_card if card_type == "certification" else None

    data = normalized_card.get("data")
    if not isinstance(data, dict):
        return normalized_card
    if data.get("category") == "education":
        return normalized_card

    star = data.get("star")
    if not isinstance(star, dict):
        return normalized_card

    normalized_star = dict(star)
    raw_action = normalized_star.get("a")
    if isinstance(raw_action, str):
        normalized_star["a"] = _normalize_assistant_action_text(raw_action) or ""

    normalized_data = dict(data)
    normalized_data["star"] = normalized_star
    normalized_card["data"] = normalized_data
    return normalized_card
