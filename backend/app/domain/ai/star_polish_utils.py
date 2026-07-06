import re
from typing import Any, Dict, List, Optional

from .assistant_turn_utils import _is_off_scope_smart_complete_question
from .prompts import (
    POLISH_MODE_INSTRUCTIONS,
    STAR_CAMPUS_RECRUITMENT_REWRITE,
    STAR_GENERAL_REWRITE_NO_JD,
    STAR_HIGHLIGHT,
    STAR_HIGHLIGHT_NO_JD,
    STAR_POLISH,
    STAR_RESUME_READY_REWRITE,
    STAR_SMART_COMPLETE_REWRITE,
)

MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS = 3
DEFAULT_JD_EXTRA_BOLD_LIMIT = 3
CAMPUS_RECRUITMENT_MODE = "campus_recruitment"
STAR_FIELD_KEYS = ("s", "t", "a", "r")
MARKDOWN_BOLD_PATTERN = re.compile(r"(\*\*|＊＊)([^\r\n]+?)(\1)")
HTML_BOLD_TAG_PATTERN = re.compile(r"</?(?:strong|b)\b[^>]*>", re.IGNORECASE)
FOUR_CJK_CHARS_PATTERN = re.compile(r"^[\u4e00-\u9fff]{4}$")
CAMPUS_ACTION_LABEL_BOLD_PATTERN = re.compile(r"(^|\n)(\*\*|＊＊)([\u4e00-\u9fff]{4})(\2)(?=：)")


def _is_campus_recruitment_mode(mode: Optional[str]) -> bool:
    return (mode or "").strip().lower() == CAMPUS_RECRUITMENT_MODE


def _strip_bold_markers(value: str) -> str:
    without_markdown = MARKDOWN_BOLD_PATTERN.sub(lambda match: match.group(2), value)
    return HTML_BOLD_TAG_PATTERN.sub("", without_markdown)


def _prepare_polish_content_payload(
    content: Dict[str, Any],
    mode: Optional[str] = None,
) -> Dict[str, Any]:
    payload = dict(content)
    if not _is_campus_recruitment_mode(mode):
        return payload

    for key in STAR_FIELD_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value:
            payload[key] = _strip_bold_markers(value)
    return payload


def _resolve_star_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    has_jd_text: bool = False,
) -> str:
    normalized_mode = (mode or "default").strip().lower()
    if _is_campus_recruitment_mode(mode):
        return STAR_CAMPUS_RECRUITMENT_REWRITE
    if normalized_mode in {"smart_complete", "smart_completion"}:
        return STAR_SMART_COMPLETE_REWRITE
    if normalized_mode == "default":
        if has_jd_text:
            return STAR_RESUME_READY_REWRITE
        return STAR_GENERAL_REWRITE_NO_JD
    if normalized_mode in {"highlight", "match_highlight"}:
        if has_jd_text:
            return STAR_HIGHLIGHT
        return STAR_HIGHLIGHT_NO_JD
    return STAR_POLISH


def _build_polish_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    jd_text: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> str:
    has_jd_text = bool(jd_text and jd_text.strip())
    base_prompt = _resolve_star_prompt(target_field, mode, has_jd_text=has_jd_text)
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"highlight", "match_highlight"}:
        mode_instruction = None
    elif normalized_mode == "default" and not has_jd_text:
        mode_instruction = None
    else:
        mode_instruction = POLISH_MODE_INSTRUCTIONS.get(normalized_mode)
    prompt_parts = [base_prompt]
    if mode_instruction:
        prompt_parts.append(mode_instruction)
    if custom_prompt and custom_prompt.strip():
        prompt_parts.append(
            "Additional user instruction for this rewrite: "
            f"{custom_prompt.strip()}"
        )
    return " ".join(prompt_parts)


def _normalize_smart_complete_polish_result(result: Dict[str, Any]) -> Dict[str, Any]:
    questions = result.get("followUpQuestions")
    if not isinstance(questions, list):
        if isinstance(questions, str) and questions.strip():
            raw_questions: List[Any] = [questions]
        else:
            raw_questions = []
    else:
        raw_questions = questions

    normalized_questions: List[str] = []
    seen_questions: set[str] = set()
    for item in raw_questions:
        if not isinstance(item, str):
            continue
        question = item.strip()
        if not question or _is_off_scope_smart_complete_question(question):
            continue
        question_key = re.sub(r"\s+", "", question)
        if question_key in seen_questions:
            continue
        seen_questions.add(question_key)
        normalized_questions.append(question)
        if len(normalized_questions) >= MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS:
            break

    return {
        **result,
        "followUpQuestions": normalized_questions,
    }


def _is_action_opening_label(value: str, match: re.Match[str]) -> bool:
    line_start = value.rfind("\n", 0, match.start()) + 1
    if value[line_start:match.start()].strip():
        return False
    if not FOUR_CJK_CHARS_PATTERN.fullmatch(match.group(2).strip()):
        return False
    return bool(re.match(r"\s*[:：]", value[match.end():]))


def _limit_default_jd_extra_bold(result: Dict[str, Any]) -> Dict[str, Any]:
    remaining_extra_bold = DEFAULT_JD_EXTRA_BOLD_LIMIT
    normalized = dict(result)

    for key in ("s", "t", "a", "r"):
        value = normalized.get(key)
        if not isinstance(value, str) or not value:
            continue

        parts: List[str] = []
        cursor = 0
        for match in MARKDOWN_BOLD_PATTERN.finditer(value):
            parts.append(value[cursor:match.start()])
            is_exempt_action_label = key == "a" and _is_action_opening_label(value, match)
            if is_exempt_action_label or remaining_extra_bold > 0:
                parts.append(match.group(0))
                if not is_exempt_action_label:
                    remaining_extra_bold -= 1
            else:
                parts.append(match.group(2))
            cursor = match.end()
        parts.append(value[cursor:])
        normalized[key] = "".join(parts)

    return normalized


def _normalize_campus_recruitment_result(result: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(result)
    value = normalized.get("a")
    if isinstance(value, str) and value:
        normalized["a"] = CAMPUS_ACTION_LABEL_BOLD_PATTERN.sub(
            lambda match: f"{match.group(1)}{match.group(3)}",
            value,
        )
    return normalized


def _normalize_polish_result(
    result: Dict[str, Any],
    mode: Optional[str] = None,
    has_jd_text: bool = False,
) -> Dict[str, Any]:
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"smart_complete", "smart_completion"}:
        return _normalize_smart_complete_polish_result(result)
    if _is_campus_recruitment_mode(mode):
        return _normalize_campus_recruitment_result(result)
    if normalized_mode == "default" and has_jd_text:
        return _limit_default_jd_extra_bold(result)
    return result
