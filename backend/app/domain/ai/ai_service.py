import hashlib
import inspect
import json
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE, HTTP_504_GATEWAY_TIMEOUT

from ...config import load_settings
from .prompts import (
    CERTIFICATION_ASSISTANT_PROMPT,
    EXPERIENCE_ASSISTANT_PROMPT,
    GENERAL_ASSISTANT_PROMPT,
    BOSS_GREETING_GENERATION,
    JD_ANALYSIS,
    JD_ANALYSIS_IMAGE,
    POLISH_MODE_INSTRUCTIONS,
    PERSONAL_SUMMARY_GENERATION,
    SKILL_ASSISTANT_PROMPT,
    STAR_GENERAL_REWRITE_NO_JD,
    STAR_HIGHLIGHT,
    STAR_HIGHLIGHT_NO_JD,
    STAR_POLISH,
    STAR_RESUME_READY_REWRITE,
    STAR_SMART_COMPLETE_REWRITE,
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

MAX_ERROR_BODY_LOG_LENGTH = 2000
DEFAULT_MATCH_SCORE = 0
RESUME_SKILLS_KEY = "skills"
AI_CONNECT_TIMEOUT_SECONDS = 10.0
AI_POOL_TIMEOUT_SECONDS = 10.0
GEMINI_CONNECT_TIMEOUT_SECONDS = 10.0
GEMINI_POOL_TIMEOUT_SECONDS = 10.0
MAX_SELECTED_EXPERIENCE_TEXT_CHARS = 300
MAX_SELECTED_EXPERIENCE_SUMMARY_CHARS = 300
MAX_SELECTED_EXPERIENCE_STAR_CHARS = 500
MAX_SELECTED_EXPERIENCES = 20
VALID_SELECTED_EXPERIENCE_CATEGORIES = {"work", "project", "education"}
MAX_SELECTED_RESUME_ID_CHARS = 120
MAX_SELECTED_RESUME_NAME_CHARS = 160
MAX_SELECTED_RESUME_JD_CONTEXT_CHARS = 4000
MAX_SELECTED_RESUME_EXPERIENCES = 40
MAX_SELECTED_RESUME_EDUCATIONS = 20
MAX_SELECTED_RESUME_CERTIFICATIONS = 30
MAX_SELECTED_RESUME_SKILLS = 60
MAX_SMART_COMPLETE_FOLLOW_UP_QUESTIONS = 3
MAX_ASSISTANT_SUGGESTED_FOLLOWUPS = 3
MAX_ASSISTANT_FOLLOWUP_LABEL_CHARS = 16
MAX_ASSISTANT_FOLLOWUP_PROMPT_CHARS = 220
SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS = (
    "其他项目",
    "其它项目",
    "非本项目",
    "非当前项目",
    "本项目以外",
    "项目以外",
    "非该项目",
    "课程项目",
    "个人练习",
    "个人项目",
    "专业背景",
    "其他案例",
    "其它案例",
)
ASSISTANT_ACTION_ORDERED_PREFIX_PATTERN = re.compile(r"^\s*\d+[.、)）]\s*(.+)$")
ASSISTANT_ACTION_UNORDERED_PREFIX_PATTERN = re.compile(r"^\s*[-*＊•·]\s*(.+)$")
ASSISTANT_ACTION_INLINE_ORDERED_PATTERN = re.compile(r"^\s*\d+[.、)）]\s*.+$")
ASSISTANT_ACTION_INLINE_ORDERED_SPLIT_PATTERN = re.compile(r"(?=\d+[.、)）]\s+)")
ASSISTANT_ACTION_ORDERED_LINE_PATTERN = re.compile(r"^\s*(\d+)([.、)）])\s*(.+)$")
ASSISTANT_ACTION_UNORDERED_LINE_PATTERN = re.compile(r"^\s*([-*＊•·])\s*(.+)$")
ASSISTANT_PLAIN_ITALIC_MARKDOWN_PATTERN = re.compile(r"^\*[^*\r\n]+\*$")

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]
AttachmentHydrator = Optional[Callable[[List[Dict[str, Any]]], Awaitable[List[Dict[str, Any]]]]]

ASSISTANT_SKILL_PROMPTS: Dict[str, Dict[str, str]] = {
    "star_guidance": {
        "title": "STAR 引导助手",
        "prompt": (
            "Current assistant skill: STAR 引导助手. Your primary job is to guide the user to complete "
            "a factual STAR experience. First inspect selected_experiences, selected_resume, attachments, "
            "and bank_context. If information is insufficient, ask exactly one focused follow-up question "
            "about the most important missing STAR detail and set draftCard to null. Do not rush to produce "
            "a finished draft. You may return a draftCard only when the user explicitly asks for a draft, "
            "confirms the information is enough, or the supplied facts already cover S/T/A/R with concrete "
            "actions and results. When returning draftCard, follow the experience card schema exactly."
        ),
    },
    "experience_completion": {
        "title": "智能补全",
        "prompt": (
            "Current assistant skill: 智能补全. Diagnose whether the selected current STAR experience contains enough "
            "factual evidence for the target JD before rewriting. If evidence is insufficient, ask 0-3 focused Chinese "
            "questions limited to truthful, plausibly answerable facts inside this current experience only. Do not ask "
            "about other projects, course projects, personal exercises, the user's broader professional background, "
            "non-this-project cases, certifications, skills, or any experience outside the current input item. Do not "
            "create questions to fill a quota; if the current experience clearly has no relevant material for a missing "
            "JD capability, state that gap instead of asking for unrelated evidence. Do not transform technical "
            "implementation into product ownership unless the input proves product decisions, user research, MVP "
            "validation, metrics, or stakeholder work. Default draftCard to null unless the user asks to generate or save a card."
        ),
    },
    "mock_interview": {
        "title": "模拟面试教练",
        "prompt": (
            "Current assistant skill: 模拟面试教练. Act as an interviewer and coach. Use selected_resume, "
            "selected_experiences, JD context, and bank_context to generate role-fit interview questions, "
            "面试官追问, answer-improvement advice, and JD/company value gaps. draftCard must be null unless "
            "the user explicitly switches back to resume drafting. Do not output an experience card by default."
        ),
    },
}


def _normalize_assistant_skill_id(skill_id: Optional[str]) -> Optional[str]:
    if not isinstance(skill_id, str):
        return None
    normalized = skill_id.strip()
    return normalized if normalized in ASSISTANT_SKILL_PROMPTS else None


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()

def _summarize_text(text: str) -> str:
    if not text:
        return "len=0 sha256=<empty>"
    return f"len={len(text)} sha256={_hash_text(text)}"

def _strip_json_wrappers(text: str) -> str:
    cleaned = text.strip()
    if "```" not in cleaned:
        return cleaned
    start = cleaned.find("```")
    end = cleaned.rfind("```")
    if end <= start:
        return cleaned
    inner = cleaned[start + 3 : end].strip()
    if inner.lower().startswith("json"):
        inner = inner[4:].strip()
    return inner


def _extract_json_payload(text: str) -> str:
    cleaned = _strip_json_wrappers(text)
    if cleaned.startswith("{") or cleaned.startswith("["):
        return cleaned
    brace_index = cleaned.find("{")
    bracket_index = cleaned.find("[")
    candidates = [i for i in (brace_index, bracket_index) if i >= 0]
    if not candidates:
        return cleaned
    start = min(candidates)
    end_char = "}" if start == brace_index else "]"
    end = cleaned.rfind(end_char)
    if end <= start:
        return cleaned
    return cleaned[start : end + 1]


def _parse_json_content(text: str) -> Dict[str, Any]:
    payload = _extract_json_payload(text)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        logger.error("JSON Parse Error: %s", exc)
        logger.error("Raw Text Summary: %s", _summarize_text(text))
        logger.error("Extracted Payload Summary: %s", _summarize_text(payload))
        raise ValueError(f"Invalid JSON returned by model: {exc}") from exc


def _parse_json_content_candidates(candidates: List[str]) -> Dict[str, Any]:
    last_error: ValueError | None = None
    for candidate in candidates:
        cleaned = candidate.strip()
        if not cleaned:
            continue
        try:
            return _parse_json_content(cleaned)
        except ValueError as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise ValueError("Invalid JSON returned by model: empty streamed response")


def _safe_parse_resume_payload(resume_text: Optional[str]) -> Optional[Dict[str, Any]]:
    if not resume_text:
        return None
    try:
        data = json.loads(resume_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _clip_optional_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


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


def _normalize_assistant_draft_card(card: Any) -> Dict[str, Any] | None:
    if not isinstance(card, dict):
        return None

    normalized_card = dict(card)
    if normalized_card.get("type") != "experience":
        return normalized_card

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


def _normalize_selected_experience_item(
    item: Any,
    *,
    include_full_text: bool = False,
    preserve_star_text: bool = False,
) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    master_id = _clip_optional_text(item.get("masterId"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    category = item.get("category")
    if not master_id or not isinstance(category, str) or category not in VALID_SELECTED_EXPERIENCE_CATEGORIES:
        return None

    normalized: Dict[str, Any] = {
        "masterId": master_id,
        "category": category,
        "isCurrent": bool(item.get("isCurrent")),
    }
    for source_key, limit in (
        ("org", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("title", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("startDate", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("endDate", MAX_SELECTED_EXPERIENCE_TEXT_CHARS),
        ("summary", MAX_SELECTED_EXPERIENCE_SUMMARY_CHARS),
    ):
        clipped = _clip_optional_text(item.get(source_key), limit)
        if clipped:
            normalized[source_key] = clipped

    full_text: Dict[str, Any] = {}
    raw_star = item.get("star")
    if isinstance(raw_star, dict):
        normalized_star: Dict[str, str] = {}
        full_star: Dict[str, str] = {}
        for key in ("s", "t", "a", "r"):
            raw_value = raw_star.get(key)
            raw_text = raw_value.strip() if isinstance(raw_value, str) else None
            if preserve_star_text:
                if raw_text:
                    normalized_star[key] = raw_text
            else:
                clipped = _clip_optional_text(raw_value, MAX_SELECTED_EXPERIENCE_STAR_CHARS)
                if clipped:
                    normalized_star[key] = clipped
            if include_full_text and raw_text:
                full_star[key] = raw_text
        if normalized_star:
            normalized["star"] = normalized_star
        if full_star:
            full_text["star"] = full_star
    if include_full_text and full_text:
        normalized["full_text"] = full_text
    return normalized


def _normalize_selected_experiences(
    items: Any,
    *,
    include_full_text: bool = False,
    preserve_star_text: bool = False,
) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    normalized_items: List[Dict[str, Any]] = []
    for item in items:
        normalized = _normalize_selected_experience_item(
            item,
            include_full_text=include_full_text,
            preserve_star_text=preserve_star_text,
        )
        if normalized:
            normalized_items.append(normalized)
        if len(normalized_items) >= MAX_SELECTED_EXPERIENCES:
            break
    return normalized_items


def _normalize_selected_resume_experience_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None

    normalized: Dict[str, Any] = {
        "id": item_id,
        "title": _clip_optional_text(item.get("title"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "org": _clip_optional_text(item.get("org"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "star": {},
    }
    start_date = _clip_optional_text(item.get("start_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if start_date:
        normalized["start_date"] = start_date
    end_date = _clip_optional_text(item.get("end_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if end_date:
        normalized["end_date"] = end_date

    raw_star = item.get("star")
    if isinstance(raw_star, dict):
        normalized_star: Dict[str, str] = {}
        for key in ("s", "t", "a", "r"):
            clipped = _clip_optional_text(raw_star.get(key), MAX_SELECTED_EXPERIENCE_STAR_CHARS)
            if clipped:
                normalized_star[key] = clipped
        normalized["star"] = normalized_star
    return normalized


def _normalize_selected_resume_certification_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    normalized: Dict[str, Any] = {
        "id": item_id,
        "name": _clip_optional_text(item.get("name"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "issue_date": _clip_optional_text(item.get("issue_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }
    issuer = _clip_optional_text(item.get("issuer"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if issuer:
        normalized["issuer"] = issuer
    return normalized


def _normalize_selected_resume_education_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    normalized: Dict[str, Any] = {
        "id": item_id,
        "school": _clip_optional_text(item.get("school"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "major": _clip_optional_text(item.get("major"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "degree": _clip_optional_text(item.get("degree"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }
    start_date = _clip_optional_text(item.get("start_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if start_date:
        normalized["start_date"] = start_date
    end_date = _clip_optional_text(item.get("end_date"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if end_date:
        normalized["end_date"] = end_date
    gpa = _clip_optional_text(item.get("gpa"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS)
    if gpa:
        normalized["gpa"] = gpa
    courses = _clip_optional_text(item.get("courses"), MAX_SELECTED_EXPERIENCE_STAR_CHARS)
    if courses:
        normalized["courses"] = courses
    return normalized


def _normalize_selected_resume_skill_item(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    item_id = _clip_optional_text(item.get("id"), MAX_SELECTED_RESUME_ID_CHARS)
    if not item_id:
        return None
    return {
        "id": item_id,
        "name": _clip_optional_text(item.get("name"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
        "category": _clip_optional_text(item.get("category"), MAX_SELECTED_EXPERIENCE_TEXT_CHARS) or "",
    }


def _normalize_selected_resume_snapshot(snapshot: Any) -> Dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {
            "experiences": [],
            "educations": [],
            "certifications": [],
            "skills": [],
        }

    normalized_experiences: List[Dict[str, Any]] = []
    for item in snapshot.get("experiences", []):
        normalized = _normalize_selected_resume_experience_item(item)
        if normalized:
            normalized_experiences.append(normalized)
        if len(normalized_experiences) >= MAX_SELECTED_RESUME_EXPERIENCES:
            break

    normalized_certifications: List[Dict[str, Any]] = []
    normalized_educations: List[Dict[str, Any]] = []
    for item in snapshot.get("educations", []):
        normalized = _normalize_selected_resume_education_item(item)
        if normalized:
            normalized_educations.append(normalized)
        if len(normalized_educations) >= MAX_SELECTED_RESUME_EDUCATIONS:
            break

    for item in snapshot.get("certifications", []):
        normalized = _normalize_selected_resume_certification_item(item)
        if normalized:
            normalized_certifications.append(normalized)
        if len(normalized_certifications) >= MAX_SELECTED_RESUME_CERTIFICATIONS:
            break

    normalized_skills: List[Dict[str, Any]] = []
    for item in snapshot.get("skills", []):
        normalized = _normalize_selected_resume_skill_item(item)
        if normalized:
            normalized_skills.append(normalized)
        if len(normalized_skills) >= MAX_SELECTED_RESUME_SKILLS:
            break

    return {
        "experiences": normalized_experiences,
        "educations": normalized_educations,
        "certifications": normalized_certifications,
        "skills": normalized_skills,
    }


def _normalize_selected_resume(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    resume_id = _clip_optional_text(
        item.get("resume_id") or item.get("resumeId"),
        MAX_SELECTED_RESUME_ID_CHARS,
    )
    resume_name = _clip_optional_text(
        item.get("resume_name") or item.get("resumeName"),
        MAX_SELECTED_RESUME_NAME_CHARS,
    )
    if not resume_id or not resume_name:
        return None

    normalized: Dict[str, Any] = {
        "resume_id": resume_id,
        "resume_name": resume_name,
        "snapshot": _normalize_selected_resume_snapshot(item.get("snapshot")),
    }
    master_id = _clip_optional_text(
        item.get("master_id") or item.get("masterId"),
        MAX_SELECTED_RESUME_ID_CHARS,
    )
    if master_id:
        normalized["master_id"] = master_id
    jd_context = _clip_optional_text(
        item.get("jd_context") or item.get("jdContext"),
        MAX_SELECTED_RESUME_JD_CONTEXT_CHARS,
    )
    if jd_context:
        normalized["jd_context"] = jd_context
    return normalized


def _extract_skill_ids(resume_text: Optional[str]) -> List[str]:
    payload = _safe_parse_resume_payload(resume_text)
    if not payload:
        return []
    skills = payload.get(RESUME_SKILLS_KEY)
    if not isinstance(skills, list):
        return []
    ids: List[str] = []
    for item in skills:
        if isinstance(item, dict):
            skill_id = item.get("id")
            if isinstance(skill_id, str) and skill_id:
                ids.append(skill_id)
    return ids


def _clamp_match_score(value: Any) -> Optional[int]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not numeric == numeric:
        return None
    return max(0, min(100, int(round(numeric))))


def _normalize_match_entries(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        match_id = item.get("id")
        if not isinstance(match_id, str) or not match_id:
            continue
        score = _clamp_match_score(item.get("score"))
        if score is None:
            continue
        entry: Dict[str, Any] = {"id": match_id, "score": score}
        reason = item.get("reason")
        if isinstance(reason, str) and reason.strip():
            entry["reason"] = reason
        normalized.append(entry)
    return normalized


def _ensure_skill_matches(
    result: Dict[str, Any],
    skill_ids: List[str],
) -> Dict[str, Any]:
    if not skill_ids:
        return result
    known_ids = set(skill_ids)
    normalized = _normalize_match_entries(result.get("skillMatches"))
    normalized = [entry for entry in normalized if entry["id"] in known_ids]
    existing = {entry["id"] for entry in normalized}
    for skill_id in skill_ids:
        if skill_id not in existing:
            normalized.append({"id": skill_id, "score": DEFAULT_MATCH_SCORE})
    result["skillMatches"] = normalized
    return result


def _normalize_jd_analysis_result(result: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(result)
    extracted_jd_text = normalized.get("extractedJdText")
    if not isinstance(extracted_jd_text, str):
        extracted_jd_text = normalized.get("extracted_jd_text")
    if isinstance(extracted_jd_text, str) and extracted_jd_text.strip():
        normalized["extractedJdText"] = extracted_jd_text.strip()
    else:
        normalized.pop("extractedJdText", None)
        normalized.pop("extracted_jd_text", None)
    jd_interpretation = normalized.get("jdInterpretation")
    if not isinstance(jd_interpretation, dict):
        jd_interpretation = normalized.get("jd_interpretation")
    if isinstance(jd_interpretation, dict):
        normalized["jdInterpretation"] = jd_interpretation
        normalized.pop("jd_interpretation", None)
    else:
        normalized.pop("jdInterpretation", None)
        normalized.pop("jd_interpretation", None)
    capability_analysis = normalized.get("capabilityAnalysis")
    if not isinstance(capability_analysis, dict):
        capability_analysis = normalized.get("capability_analysis")
    if isinstance(capability_analysis, dict):
        normalized["capabilityAnalysis"] = capability_analysis
        normalized.pop("capability_analysis", None)
    else:
        normalized.pop("capabilityAnalysis", None)
        normalized.pop("capability_analysis", None)
    return normalized


def _normalize_greeting_result(result: Dict[str, Any]) -> Dict[str, Any]:
    greeting = result.get("greeting")
    if isinstance(greeting, str) and greeting.strip():
        return {"greeting": greeting.strip()}
    return {"greeting": ""}


def _normalize_summary_result(result: Dict[str, Any]) -> Dict[str, Any]:
    summary = result.get("summary")
    if isinstance(summary, str) and summary.strip():
        return {"summary": summary.strip()}
    return {"summary": ""}


def _extract_content(response_data: Dict[str, Any]) -> str:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise ValueError("LLM response missing content")
    return content


def _build_headers() -> Dict[str, str]:
    api_key = settings.ai_api_key
    if not api_key:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_API_KEY is not configured",
        )
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _build_gemini_headers() -> Dict[str, str]:
    api_key = settings.gemini_api_key
    if not api_key:
        raise ValueError("GEMINI_API_KEY 未配置，无法返回 Gemini 实时思考节点。")
    return {
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }


def _build_gemini_stream_url(model: str) -> str:
    base_url = (settings.gemini_base_url or "").rstrip("/")
    if not base_url:
        raise ValueError("GEMINI_BASE_URL 未配置，无法调用 Gemini Thinking。")
    normalized = base_url.lower()
    if not normalized.endswith("/v1beta") and not normalized.endswith("/v1"):
        base_url = f"{base_url}/v1beta"
    return f"{base_url}/models/{model}:streamGenerateContent?alt=sse"

def _safe_response_text(response: httpx.Response) -> str:
    try:
        text = response.text
    except Exception:
        return "<failed to read response text>"
    trimmed = text.strip()
    if len(trimmed) > MAX_ERROR_BODY_LOG_LENGTH:
        return f"{trimmed[:MAX_ERROR_BODY_LOG_LENGTH]}...<truncated>"
    return trimmed


def _log_http_error(response: httpx.Response) -> None:
    logger.error(
        "AI request failed: status=%s url=%s body=%s",
        response.status_code,
        str(response.request.url) if response.request else "<unknown>",
        _safe_response_text(response),
    )

def _log_http_success(response: httpx.Response, model: str, message_count: int) -> None:
    request_id = response.headers.get("x-request-id") or response.headers.get("x-requestid")
    logger.info(
        "AI request success: url=%s model=%s messages=%s status=%s request_id=%s",
        str(response.request.url) if response.request else "<unknown>",
        model,
        message_count,
        response.status_code,
        request_id or "<none>",
    )



def _build_ai_timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=AI_CONNECT_TIMEOUT_SECONDS,
        write=float(settings.ai_timeout_seconds),
        read=float(settings.ai_timeout_seconds),
        pool=AI_POOL_TIMEOUT_SECONDS,
    )


def _build_gemini_timeout() -> httpx.Timeout:
    return httpx.Timeout(
        connect=GEMINI_CONNECT_TIMEOUT_SECONDS,
        write=float(settings.ai_timeout_seconds),
        read=float(settings.ai_timeout_seconds),
        pool=GEMINI_POOL_TIMEOUT_SECONDS,
    )


async def _emit_thought(
    thought_callback: ThoughtCallback,
    payload: Dict[str, Any],
) -> None:
    if not thought_callback:
        return
    result = thought_callback(payload)
    if inspect.isawaitable(result):
        await result


async def _iter_sse_json_payloads(response: httpx.Response):
    def build_payload(lines: List[str]) -> str:
        data_lines: List[str] = []
        for item in lines:
            if not item.startswith("data:"):
                continue
            value = item[5:]
            if value.startswith(" "):
                value = value[1:]
            data_lines.append(value)
        return "\n".join(data_lines)

    event_lines: List[str] = []
    async for raw_line in response.aiter_lines():
        line = raw_line.rstrip("\r")
        if not line.strip():
            if not event_lines:
                continue
            payload = build_payload(event_lines)
            event_lines = []
            if not payload:
                continue
            if payload == "[DONE]":
                break
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("[AI Stream] invalid Gemini SSE payload: %s", payload[:500])
            continue
        event_lines.append(line)

    if event_lines:
        payload = build_payload(event_lines)
        if payload and payload != "[DONE]":
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                logger.warning("[AI Stream] invalid Gemini SSE trailing payload: %s", payload[:500])


def _build_gemini_generation_config(
    budget_tokens: Optional[int] = None,
    *,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    config: Dict[str, Any] = {
        "temperature": 0.2,
        "thinkingConfig": {
            "includeThoughts": True,
        },
    }
    normalized_model = (model or "").strip().lower()
    if not normalized_model.startswith("gemini-3"):
        config["responseMimeType"] = "application/json"
    if budget_tokens is None:
        return config

    config["thinkingConfig"]["thinkingBudget"] = int(budget_tokens)
    return config


def _build_gemini_request_body(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    budget_tokens: Optional[int] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "systemInstruction": {
            "parts": [{"text": system_prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": user_parts,
            }
        ],
        "generationConfig": _build_gemini_generation_config(
            budget_tokens,
            model=model,
        ),
    }


async def _stream_gemini_json_response(
    *,
    system_prompt: str,
    user_parts: List[Dict[str, Any]],
    error_message: str,
    request_label: str,
    budget_tokens: Optional[int] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    model = settings.gemini_model
    request_body = _build_gemini_request_body(
        system_prompt=system_prompt,
        user_parts=user_parts,
        budget_tokens=budget_tokens,
        model=model,
    )
    url = _build_gemini_stream_url(model)
    answer_parts: List[str] = []
    answer_snapshots: List[str] = []

    try:
        async with httpx.AsyncClient(timeout=_build_gemini_timeout()) as client:
            async with client.stream(
                "POST",
                url,
                headers=_build_gemini_headers(),
                json=request_body,
            ) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/event-stream" not in content_type:
                    body_preview = (await response.aread()).decode("utf-8", errors="ignore")[:800]
                    logger.error(
                        "[AI Stream] unexpected Gemini content-type label=%s content_type=%s body=%s",
                        request_label,
                        content_type,
                        body_preview,
                    )
                    raise ValueError(
                        "Gemini 中转站返回了非流式响应，请检查 GEMINI_BASE_URL 是否需要包含 /v1beta。"
                    )
                async for payload in _iter_sse_json_payloads(response):
                    candidates = payload.get("candidates") or []
                    if not candidates:
                        continue
                    parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
                    event_answer_parts: List[str] = []
                    for part in parts:
                        text = part.get("text")
                        if not isinstance(text, str) or not text:
                            continue
                        if part.get("thought") is True:
                            await _emit_thought(
                                thought_callback,
                                {"type": "thought", "summary": text},
                            )
                            continue
                        answer_parts.append(text)
                        event_answer_parts.append(text)
                    if event_answer_parts:
                        answer_snapshots.append("".join(event_answer_parts))
    except httpx.HTTPStatusError as exc:
        try:
            await exc.response.aread()
            error_text = exc.response.text[:1000]
        except Exception:
            error_text = "Failed to read response body."
        logger.error(
            "[AI Stream] Gemini request failed label=%s status=%s body=%s",
            request_label,
            exc.response.status_code,
            error_text,
        )
        raise ValueError(error_message) from exc
    except httpx.TimeoutException as exc:
        raise ValueError(error_message) from exc

    answer_text = "".join(answer_parts).strip()
    if not answer_text:
        raise ValueError("Gemini 未返回可解析的结构化结果。")
    parse_candidates: List[str] = [answer_text]
    if answer_snapshots:
        parse_candidates.append(answer_snapshots[-1])
        parse_candidates.extend(
            snapshot
            for snapshot in sorted(answer_snapshots, key=len, reverse=True)
            if snapshot not in parse_candidates
        )
    return _parse_json_content_candidates(parse_candidates)

async def _call_llm(messages: List[Dict[str, Any]], json_mode: bool = True) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
    }
    url = f"{settings.ai_base_url}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
            response = await client.post(url, headers=_build_headers(), json=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                _log_http_error(response)
                raise
            data = response.json()
            _log_http_success(response, payload["model"], len(messages))
    except httpx.TimeoutException as exc:
        logger.error(
            "AI request timed out: url=%s model=%s messages=%s read_timeout=%ss",
            url,
            payload["model"],
            len(messages),
            settings.ai_timeout_seconds,
        )
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=(
                "AI analysis timed out. The request took too long to finish; "
                "please try again later."
            ),
        ) from exc
    content = _extract_content(data)
    if json_mode:
        return _parse_json_content(content)
    return {"content": content}


def _extract_message(response_data: Dict[str, Any]) -> Dict[str, Any]:
    choices = response_data.get("choices") or []
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    if not isinstance(message, dict):
        raise ValueError("LLM response missing message")
    return message


async def _post_chat_completion(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{settings.ai_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=_build_ai_timeout()) as client:
        response = await client.post(url, headers=_build_headers(), json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_http_error(response)
            raise
        data = response.json()
        _log_http_success(response, payload["model"], len(payload.get("messages") or []))
        return data


async def _call_llm_with_tools(
    messages: List[Dict[str, Any]],
    *,
    tools: List[Dict[str, Any]],
    tool_executor: Callable[[str, Dict[str, Any]], Dict[str, Any]],
    json_mode: bool = True,
) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
        "tools": tools,
        "tool_choice": "auto",
    }
    try:
        data = await _post_chat_completion(payload)
        message = _extract_message(data)
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            follow_up_messages = [*messages, message]
            for tool_call in tool_calls:
                function_call = tool_call.get("function") if isinstance(tool_call, dict) else None
                if not isinstance(function_call, dict):
                    continue
                tool_name = str(function_call.get("name") or "")
                raw_arguments = function_call.get("arguments")
                try:
                    arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) and raw_arguments.strip() else {}
                except json.JSONDecodeError:
                    arguments = {}
                tool_result = tool_executor(tool_name, arguments if isinstance(arguments, dict) else {})
                follow_up_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.get("id"),
                        "name": tool_name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    }
                )
            return await _call_llm(follow_up_messages, json_mode=json_mode)
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("LLM response missing content")
        return _parse_json_content(content) if json_mode else {"content": content}
    except Exception:
        logger.warning("[AI Tools] tool calling unavailable; falling back to standard assistant generation.", exc_info=True)
        return await _call_llm(messages, json_mode=json_mode)


def _build_assistant_context_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_selected_experience_full_text",
                "description": "Return full, untruncated STAR text for the selected experience by masterId.",
                "parameters": {
                    "type": "object",
                    "properties": {"masterId": {"type": "string"}},
                    "required": ["masterId"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_selected_resume_context",
                "description": "Return the selected resume snapshot and linked JD context available in the current assistant turn.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_bank_context",
                "description": "Return the user's experience library, certifications, skills, and profile context already loaded for this turn.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _build_assistant_context_tool_executor(
    payload: Dict[str, Any],
) -> Callable[[str, Dict[str, Any]], Dict[str, Any]]:
    def execute(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if tool_name == "get_selected_experience_full_text":
            master_id = str(arguments.get("masterId") or "").strip()
            for item in payload.get("selected_experiences") or []:
                if isinstance(item, dict) and item.get("masterId") == master_id:
                    return {"experience": item.get("full_text") or item}
            return {"experience": None}
        if tool_name == "get_selected_resume_context":
            return {"selected_resume": payload.get("selected_resume")}
        if tool_name == "get_bank_context":
            return {"bank_context": payload.get("bank_context")}
        return {"error": f"Unknown tool: {tool_name}"}

    return execute


MAX_ASSISTANT_REUSED_ATTACHMENTS = 3


async def call_llm_json(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    return await _call_llm(messages, json_mode=True)


async def analyze_jd(
    text: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
) -> Dict[str, Any]:
    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    messages = [
        {"role": "system", "content": JD_ANALYSIS},
        {
            "role": "user",
            "content": (
                "Job Description:\n"
                f"{text}\n\n"
                "Resume Content:\n"
                f"{resume_payload}\n\n"
                "Current Experience Content:\n"
                f"{experience_payload}\n\n"
                "Previous Experience Content:\n"
                f"{previous_experience_payload}\n\n"
                "Previous Result:\n"
                f"{previous_payload}"
            ),
        },
    ]
    result = await _call_llm(messages, json_mode=True)
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_jd_analysis_user_parts(
    text: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
) -> List[Dict[str, Any]]:
    return [
        {
            "text": (
                "Job Description:\n"
                f"{text}\n\n"
                "Resume Content:\n"
                f"{resume_payload}\n\n"
                "Current Experience Content:\n"
                f"{experience_payload}\n\n"
                "Previous Experience Content:\n"
                f"{previous_experience_payload}\n\n"
                "Previous Result:\n"
                f"{previous_payload}"
            )
        }
    ]


async def analyze_jd_with_thoughts(
    text: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await analyze_jd(
            text,
            resume_text,
            prev_result,
            experience_text,
            prev_experience_text,
        )

    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    try:
        result = await _stream_gemini_json_response(
            system_prompt=JD_ANALYSIS,
            user_parts=_build_jd_analysis_user_parts(
                text,
                resume_payload,
                experience_payload,
                previous_payload,
                previous_experience_payload,
            ),
            error_message="JD 分析失败，请稍后重试。",
            request_label="jd_text_analysis",
            budget_tokens=settings.ai_thinking_budget_jd_analysis,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for jd_text_analysis, falling back to standard analysis.",
            exc_info=True,
        )
        return await analyze_jd(
            text,
            resume_text,
            prev_result,
            experience_text,
            prev_experience_text,
        )
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_image_jd_user_message(
    image_b64: str,
    mime_type: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
    jd_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    构建包含图像 part 的 multimodal user message。
    图像以 base64 data URL 内嵌，模型可直接读取图像中的 JD 内容。
    """
    text_context = (
        f"Supplementary JD Text:\n{jd_text or 'None'}\n\n"
        f"Resume Content:\n{resume_payload}\n\n"
        f"Current Experience Content:\n{experience_payload}\n\n"
        f"Previous Experience Content:\n{previous_experience_payload}\n\n"
        f"Previous Result:\n{previous_payload}"
    )
    return {
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{image_b64}"
                },
            },
            {"type": "text", "text": text_context},
        ],
    }


async def analyze_jd_with_image(
    image_b64: str,
    mime_type: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    jd_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Vision 路径：将 JD 图像以 base64 内嵌到 multimodal message，
    由模型一次完成 OCR + 分析，无需额外 OCR 服务。
    """
    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    user_message = _build_image_jd_user_message(
        image_b64,
        mime_type,
        resume_payload,
        experience_payload,
        previous_payload,
        previous_experience_payload,
        jd_text,
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": JD_ANALYSIS_IMAGE},
        user_message,
    ]
    result = await _call_llm(messages, json_mode=True)
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _build_image_jd_user_parts(
    image_b64: str,
    mime_type: str,
    resume_payload: str,
    experience_payload: str,
    previous_payload: str,
    previous_experience_payload: str,
    jd_text: Optional[str] = None,
) -> List[Dict[str, Any]]:
    return [
        {
            "inlineData": {
                "mimeType": mime_type,
                "data": image_b64,
            }
        },
        {
            "text": (
                f"Supplementary JD Text:\n{jd_text or 'None'}\n\n"
                f"Resume Content:\n{resume_payload}\n\n"
                f"Current Experience Content:\n{experience_payload}\n\n"
                f"Previous Experience Content:\n{previous_experience_payload}\n\n"
                f"Previous Result:\n{previous_payload}"
            )
        },
    ]


async def analyze_jd_with_image_thoughts(
    image_b64: str,
    mime_type: str,
    resume_text: Optional[str] = None,
    prev_result: Optional[Dict[str, Any]] = None,
    experience_text: Optional[str] = None,
    jd_text: Optional[str] = None,
    prev_experience_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await analyze_jd_with_image(
            image_b64=image_b64,
            mime_type=mime_type,
            resume_text=resume_text,
            prev_result=prev_result,
            experience_text=experience_text,
            jd_text=jd_text,
            prev_experience_text=prev_experience_text,
        )

    resume_payload = resume_text or "Resume content not provided."
    experience_payload = experience_text or "Experience content not provided."
    previous_payload = (
        json.dumps(prev_result, ensure_ascii=False)
        if prev_result
        else "None"
    )
    previous_experience_payload = prev_experience_text or "None"
    try:
        result = await _stream_gemini_json_response(
            system_prompt=JD_ANALYSIS_IMAGE,
            user_parts=_build_image_jd_user_parts(
                image_b64,
                mime_type,
                resume_payload,
                experience_payload,
                previous_payload,
                previous_experience_payload,
                jd_text,
            ),
            error_message="JD 附件分析失败，请稍后重试。",
            request_label="jd_image_analysis",
            budget_tokens=settings.ai_thinking_budget_jd_analysis,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for jd_image_analysis, falling back to standard image analysis.",
            exc_info=True,
        )
        return await analyze_jd_with_image(
            image_b64=image_b64,
            mime_type=mime_type,
            resume_text=resume_text,
            prev_result=prev_result,
            experience_text=experience_text,
            jd_text=jd_text,
            prev_experience_text=prev_experience_text,
        )
    skill_ids = _extract_skill_ids(resume_text)
    normalized_result = _normalize_jd_analysis_result(result)
    return _ensure_skill_matches(normalized_result, skill_ids)


def _resolve_star_prompt(
    target_field: Optional[str],
    mode: Optional[str] = None,
    has_jd_text: bool = False,
) -> str:
    normalized_mode = (mode or "default").strip().lower()
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


def _is_off_scope_smart_complete_question(question: str) -> bool:
    normalized = re.sub(r"\s+", "", question)
    if not normalized:
        return True
    if any(term in normalized for term in SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS):
        return True
    if ("其他" in normalized or "其它" in normalized) and ("项目" in normalized or "案例" in normalized):
        return True
    return "是否有过任何" in normalized


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


def _normalize_polish_result(result: Dict[str, Any], mode: Optional[str] = None) -> Dict[str, Any]:
    normalized_mode = (mode or "default").strip().lower()
    if normalized_mode in {"smart_complete", "smart_completion"}:
        return _normalize_smart_complete_polish_result(result)
    return result


def _normalize_assistant_suggested_followups(
    value: Any,
    *,
    active_skill_id: Optional[str] = None,
) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized_active_skill_id = _normalize_assistant_skill_id(active_skill_id)
    normalized_items: List[Dict[str, str]] = []
    seen_prompts: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        raw_label = item.get("label")
        raw_prompt = item.get("prompt")
        raw_skill_id = item.get("skillId") or item.get("skill_id")
        if not isinstance(raw_label, str) or not isinstance(raw_prompt, str):
            continue
        label = raw_label.strip()
        prompt = raw_prompt.strip()
        skill_id = _normalize_assistant_skill_id(str(raw_skill_id or ""))
        if not label or not prompt or not skill_id:
            continue
        if normalized_active_skill_id == "experience_completion" and _is_off_scope_smart_complete_question(f"{label} {prompt}"):
            continue
        prompt_key = re.sub(r"\s+", "", prompt)
        if prompt_key in seen_prompts:
            continue
        seen_prompts.add(prompt_key)
        normalized_items.append(
            {
                "label": label[:MAX_ASSISTANT_FOLLOWUP_LABEL_CHARS],
                "prompt": prompt[:MAX_ASSISTANT_FOLLOWUP_PROMPT_CHARS],
                "skillId": skill_id,
            }
        )
        if len(normalized_items) >= MAX_ASSISTANT_SUGGESTED_FOLLOWUPS:
            break
    return normalized_items


def _get_assistant_prompt(mode: str, skill_id: Optional[str] = None) -> str:
    normalized_skill_id = _normalize_assistant_skill_id(skill_id)
    if mode == "general":
        prompt = GENERAL_ASSISTANT_PROMPT
    if mode == "experience":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: experience. Start by focusing on experience organization, but do not refuse other topics. "
            + "When 'context.masterId' exists, treat that record as the primary optimization target. "
            + "When 'bank_context' clearly matches an existing experience and the user wants to optimize it, return an experience draftCard with data.targetMasterId set to that masterId. "
            + "The experience draft data may include optional key 'targetMasterId' (string or null). Never fabricate a targetMasterId."
        )
    elif mode == "certification":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: certification. Start by focusing on certification organization, but do not refuse other topics."
        )
    elif mode == "skill":
        prompt = (
            GENERAL_ASSISTANT_PROMPT
            + " Current preferred topic: skill. Start by focusing on skill organization, but do not refuse other topics."
        )
    elif mode != "general":
        raise ValueError(f"Unsupported assistant mode: {mode}")
    if normalized_skill_id:
        prompt = f"{prompt} {ASSISTANT_SKILL_PROMPTS[normalized_skill_id]['prompt']}"
    return prompt


def _build_assistant_payload(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]],
    selected_experiences: Optional[List[Dict[str, Any]]],
    selected_resume: Optional[Dict[str, Any]],
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    skill_id: Optional[str] = None,
    include_selected_experience_full_text: bool = True,
    preserve_selected_experience_star_text: bool = False,
) -> Dict[str, Any]:
    normalized_history = _normalize_assistant_history(history[-16:], include_attachment_content=False)
    normalized_selected_experiences = _normalize_selected_experiences(
        selected_experiences,
        include_full_text=include_selected_experience_full_text,
        preserve_star_text=preserve_selected_experience_star_text,
    )
    normalized_selected_resume = _normalize_selected_resume(selected_resume)
    normalized_skill_id = _normalize_assistant_skill_id(skill_id)
    payload = {
        "mode": mode,
        "session_title": session_title,
        "entry_source": entry_source,
        "context": context_json,
        "history": normalized_history,
    }
    if normalized_skill_id:
        payload["skill_id"] = normalized_skill_id
        payload["skill"] = {
            "id": normalized_skill_id,
            "title": ASSISTANT_SKILL_PROMPTS[normalized_skill_id]["title"],
        }
    if bank_context is not None:
        payload["bank_context"] = bank_context
    if normalized_selected_experiences:
        payload["selected_experiences"] = normalized_selected_experiences
    if normalized_selected_resume:
        payload["selected_resume"] = normalized_selected_resume
    if attachments:
        attachment_contexts = [
            _build_assistant_attachment_context(item, include_attachment_content=True)
            for item in attachments
        ]
        if len(attachment_contexts) == 1:
            payload["attachment"] = attachment_contexts[0]
        else:
            payload["attachments"] = attachment_contexts
    payload["user_message"] = user_message
    return payload


def _build_assistant_attachment_context(
    attachment: Dict[str, Any],
    *,
    include_attachment_content: bool,
) -> Dict[str, Any]:
    context: Dict[str, Any] = {}
    base_fields = (
        ("name", "name"),
        ("kind", "kind"),
        ("contentType", "contentType"),
        ("textExcerpt", "textExcerpt"),
    )
    content_fields = (
        ("text", "text"),
    )
    for source_key, target_key in (*base_fields, *(content_fields if include_attachment_content else ())):
        value = attachment.get(source_key)
        if isinstance(value, str) and value.strip():
            context[target_key] = value.strip()
    return context


def _read_attachment_image_payload(attachment: Dict[str, Any]) -> str:
    image_b64 = attachment.get("imageB64")
    if isinstance(image_b64, str) and image_b64.strip():
        return image_b64.strip()
    return ""


def _normalize_assistant_history(
    history: List[Dict[str, Any]],
    *,
    include_attachment_content: bool,
) -> List[Dict[str, Any]]:
    normalized_history: List[Dict[str, Any]] = []
    for message in history:
        if not isinstance(message, dict):
            continue
        normalized_message = {**message}
        content_json = message.get("content_json")
        if isinstance(content_json, dict):
            normalized_content_json = {**content_json}
            attachment_signatures: set[tuple[str, str, str, str]] = set()
            raw_attachments = content_json.get("attachments")
            if isinstance(raw_attachments, list):
                attachment_contexts = [
                    _build_assistant_attachment_context(
                        attachment,
                        include_attachment_content=include_attachment_content,
                    )
                    for attachment in raw_attachments
                    if isinstance(attachment, dict)
                ]
                attachment_signatures = {
                    _attachment_signature(attachment)
                    for attachment in raw_attachments
                    if isinstance(attachment, dict)
                }
                if attachment_contexts:
                    normalized_content_json["attachments"] = attachment_contexts
                elif "attachments" in normalized_content_json:
                    normalized_content_json.pop("attachments", None)
            attachment = content_json.get("attachment")
            if isinstance(attachment, dict) and _attachment_signature(attachment) not in attachment_signatures:
                normalized_content_json["attachment"] = _build_assistant_attachment_context(
                    attachment,
                    include_attachment_content=include_attachment_content,
                )
            elif "attachment" in normalized_content_json and attachment_signatures:
                normalized_content_json.pop("attachment", None)
            selected_experiences = _normalize_selected_experiences(
                content_json.get("selected_experiences")
            )
            if selected_experiences:
                normalized_content_json["selected_experiences"] = selected_experiences
            elif "selected_experiences" in normalized_content_json:
                normalized_content_json.pop("selected_experiences", None)
            selected_resume = _normalize_selected_resume(
                content_json.get("selected_resume")
            )
            if selected_resume:
                normalized_content_json["selected_resume"] = selected_resume
            elif "selected_resume" in normalized_content_json:
                normalized_content_json.pop("selected_resume", None)
            normalized_message["content_json"] = normalized_content_json
        normalized_history.append(normalized_message)
    return normalized_history


def _message_explicitly_references_attachment(
    user_message: str,
    attachment: Dict[str, Any],
) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    attachment_name = str(attachment.get("name") or "").strip().lower()
    return bool(attachment_name and attachment_name in normalized_message)


def _message_references_attachment_generically(user_message: str, attachment: Dict[str, Any]) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    kind = str(attachment.get("kind") or "").strip().lower()
    if kind == "image":
        attachment_terms = ("附件", "图片", "图", "截图", "照片", "海报", "image", "photo", "screenshot")
    else:
        attachment_terms = ("附件", "文档", "文件", "pdf", "doc", "docx", "简历", "材料", "document", "file")
    return any(term in normalized_message for term in attachment_terms)


def _message_is_attachment_follow_up(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    new_content_terms = (
        "下面这段",
        "下面这句话",
        "以下这段",
        "以下内容",
        "如下内容",
        "这段文案",
        "这段文字",
        "这句话",
        "这一段",
        "下一段",
        "我刚写的",
        "刚写的这段",
        "贴给你一段",
        "贴一下这段",
        "发给你一段",
    )
    if any(term in normalized_message for term in new_content_terms):
        return False

    inline_text_reference_terms = (
        "这段",
        "这句话",
        "这一句",
        "下面",
        "以下",
        "如下",
        "刚写",
        "我写的",
        "贴的",
        "粘贴",
    )
    if any(term in normalized_message for term in inline_text_reference_terms):
        return False

    explicit_attachment_terms = (
        "这个附件",
        "这个文档",
        "这个文件",
        "这个图片",
        "这张图",
        "这份附件",
        "这份文档",
        "这份文件",
    )
    if any(term in normalized_message for term in explicit_attachment_terms):
        return True

    continuation_markers = (
        "继续",
        "接着",
        "基于",
        "根据",
        "结合",
        "围绕",
        "针对",
        "在这个基础上",
        "在此基础上",
        "顺着这个",
        "沿着这个",
        "保持这个",
        "用这个",
        "按这个",
        "照这个",
        "基于刚才",
        "基于上面",
    )
    transformation_terms = (
        "换成",
        "改成",
        "改写",
        "重写",
        "润色",
        "优化",
        "细化",
        "展开",
        "扩写",
        "缩写",
        "压缩",
        "精简",
        "提炼",
        "总结",
        "归纳",
        "翻译",
        "改为英文",
        "英文版",
        "中文版",
        "star",
        "bullet",
    )
    has_transformation = any(term in normalized_message for term in transformation_terms)
    has_continuation_marker = any(term in normalized_message for term in continuation_markers)
    if has_transformation and (
        has_continuation_marker
        or any(
            term in normalized_message
            for term in ("这个", "这份", "这张", "上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
        )
    ):
        return True
    return has_continuation_marker and any(
        term in normalized_message
        for term in ("这个", "这份", "这张", "上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
    )


def _message_is_short_transformation_command(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    if any(
        term in normalized_message
        for term in (
            "这段",
            "这句话",
            "这一句",
            "下面",
            "以下",
            "如下",
            "刚写",
            "我写的",
            "贴的",
            "粘贴",
            "这个附件",
            "这个文档",
            "这个文件",
            "这个图片",
            "这张图",
            "这份附件",
            "这份文档",
            "这份文件",
            "继续",
            "接着",
            "基于",
            "根据",
            "结合",
            "围绕",
            "针对",
        )
    ):
        return False

    return len(normalized_message) <= 16 and any(
        term in normalized_message
        for term in (
            "换成",
            "改成",
            "改写",
            "重写",
            "润色",
            "优化",
            "细化",
            "展开",
            "扩写",
            "缩写",
            "压缩",
            "精简",
            "提炼",
            "总结",
            "归纳",
            "翻译",
            "改为英文",
            "英文版",
            "中文版",
            "star",
            "bullet",
        )
    )


def _message_requests_multi_attachment_context(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    comparison_terms = (
        "比较",
        "对比",
        "区别",
        "差异",
        "异同",
        "不同",
        "相同",
    )
    grouping_terms = (
        "另一份",
        "另一张",
        "另一个附件",
        "另一个文档",
        "另一个文件",
        "另一个图片",
        "这份和另一份",
        "这一份和另一份",
        "这张和另一张",
        "这一张和另一张",
        "结合前两",
        "结合这两",
        "前两份",
        "前两个",
        "前两张",
        "两份",
        "两张",
        "两个",
        "多个",
        "几份",
        "几张",
    )
    return any(term in normalized_message for term in comparison_terms) or any(
        term in normalized_message for term in grouping_terms
    )


def _message_uses_relative_attachment_reference(user_message: str) -> bool:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return False

    relative_reference_terms = (
        "另一份",
        "另一张",
        "另一个附件",
        "另一个文档",
        "另一个文件",
        "另一个图片",
        "这份和另一份",
        "这一份和另一份",
        "这张和另一张",
        "这一张和另一张",
        "这两份",
        "这两张",
        "这两个",
        "前两份",
        "前两张",
        "前两个",
        "结合前两",
        "结合这两",
        "上一份",
        "前一份",
        "上一张",
        "前一张",
        "上一个",
        "前一个",
    )
    return any(term in normalized_message for term in relative_reference_terms)


def _infer_requested_attachment_count(user_message: str) -> int:
    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return MAX_ASSISTANT_REUSED_ATTACHMENTS

    count_terms = (
        (
            2,
            (
                "两份",
                "两张",
                "两个",
                "前两份",
                "前两张",
                "前两个",
                "这两份",
                "这两张",
                "这两个",
                "这份和另一份",
                "这一份和另一份",
                "这张和另一张",
                "这一张和另一张",
            ),
        ),
        (3, ("三份", "三张", "三个", "前三份", "前三张", "前三个", "这三份", "这三张", "这三个")),
    )
    for count, terms in count_terms:
        if any(term in normalized_message for term in terms):
            return count
    return MAX_ASSISTANT_REUSED_ATTACHMENTS


def _resolve_relative_attachment_reference(
    history_attachments: List[Dict[str, Any]],
    user_message: str,
) -> List[Dict[str, Any]]:
    if not history_attachments:
        return []

    normalized_message = user_message.strip().lower()
    if not normalized_message:
        return []

    previous_reference_terms = ("上一份", "前一份", "上一张", "前一张", "上一个", "前一个")
    if any(term in normalized_message for term in previous_reference_terms):
        if len(history_attachments) >= 2:
            return [history_attachments[-2]]
        return [history_attachments[-1]]

    return []


def _attachment_signature(attachment: Dict[str, Any]) -> tuple[str, str, str, str]:
    content_fingerprint = ""
    if isinstance(attachment.get("text"), str) and attachment.get("text", "").strip():
        content_fingerprint = hashlib.sha1(attachment["text"].encode("utf-8")).hexdigest()
    else:
        image_blob_id = attachment.get("imageBlobId")
        if isinstance(image_blob_id, str) and image_blob_id.strip():
            content_fingerprint = f"imageBlobId:{image_blob_id.strip()}"
        elif image_payload := _read_attachment_image_payload(attachment):
            content_fingerprint = hashlib.sha1(image_payload.encode("ascii")).hexdigest()
    if not content_fingerprint and isinstance(attachment.get("textExcerpt"), str) and attachment.get("textExcerpt", "").strip():
        content_fingerprint = hashlib.sha1(attachment["textExcerpt"].encode("utf-8")).hexdigest()
    return (
        str(attachment.get("name") or "").strip(),
        str(attachment.get("kind") or "").strip(),
        str(attachment.get("contentType") or "").strip(),
        content_fingerprint,
    )


def _collect_history_attachments(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    attachments: List[Dict[str, Any]] = []
    for message in history:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content_json = message.get("content_json")
        if not isinstance(content_json, dict):
            continue
        raw_attachments = content_json.get("attachments")
        message_signatures: set[tuple[str, str, str, str]] = set()
        if isinstance(raw_attachments, list):
            for attachment in raw_attachments:
                if not isinstance(attachment, dict):
                    continue
                attachments.append(attachment)
                message_signatures.add(_attachment_signature(attachment))
        attachment = content_json.get("attachment")
        if isinstance(attachment, dict) and _attachment_signature(attachment) not in message_signatures:
            attachments.append(attachment)
    return attachments


def _unique_attachments(attachments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for attachment in attachments:
        signature = _attachment_signature(attachment)
        if signature in seen:
            continue
        seen.add(signature)
        unique.append(attachment)
    return unique


def _complete_multi_attachment_selection(
    history_attachments: List[Dict[str, Any]],
    selected_attachments: List[Dict[str, Any]],
    requested_attachment_count: int,
    user_message: str,
) -> List[Dict[str, Any]]:
    selected_unique = _unique_attachments(selected_attachments)
    if len(selected_unique) >= requested_attachment_count:
        return selected_unique[-requested_attachment_count:]

    normalized_message = user_message.strip().lower()
    target_signatures = {_attachment_signature(attachment) for attachment in selected_unique}
    previous_reference_terms = ("上一份", "前一份", "上一张", "前一张", "上一个", "前一个")

    if selected_unique and any(term in normalized_message for term in previous_reference_terms):
        anchor_signature = _attachment_signature(selected_unique[-1])
        anchor_index = next(
            (
                index
                for index in range(len(history_attachments) - 1, -1, -1)
                if _attachment_signature(history_attachments[index]) == anchor_signature
            ),
            -1,
        )
        for index in range(anchor_index - 1, -1, -1):
            signature = _attachment_signature(history_attachments[index])
            if signature in target_signatures:
                continue
            target_signatures.add(signature)
            if len(target_signatures) >= requested_attachment_count:
                break

    if len(target_signatures) < requested_attachment_count:
        for attachment in reversed(history_attachments):
            signature = _attachment_signature(attachment)
            if signature in target_signatures:
                continue
            target_signatures.add(signature)
            if len(target_signatures) >= requested_attachment_count:
                break

    completed: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for attachment in history_attachments:
        signature = _attachment_signature(attachment)
        if signature not in target_signatures or signature in seen:
            continue
        completed.append(attachment)
        seen.add(signature)
    return completed[-requested_attachment_count:]


def _resolve_relevant_attachments(
    history: List[Dict[str, Any]],
    current_attachments: Optional[List[Dict[str, Any]]] = None,
    user_message: str = "",
) -> List[Dict[str, Any]]:
    history_attachments = _collect_history_attachments(history)
    normalized_current_attachments = _unique_attachments(
        [attachment for attachment in (current_attachments or []) if isinstance(attachment, dict)]
    )
    requested_attachment_count = min(
        _infer_requested_attachment_count(user_message),
        MAX_ASSISTANT_REUSED_ATTACHMENTS,
    )
    if normalized_current_attachments:
        if _message_requests_multi_attachment_context(user_message):
            companion_count = max(requested_attachment_count - len(normalized_current_attachments), 0)
            explicit_history_matches = [
                attachment
                for attachment in history_attachments
                if _message_explicitly_references_attachment(user_message, attachment)
            ]
            if companion_count <= 0 or len(normalized_current_attachments) >= requested_attachment_count:
                return normalized_current_attachments[-requested_attachment_count:]
            if explicit_history_matches:
                selected_history = _complete_multi_attachment_selection(
                    history_attachments,
                    explicit_history_matches,
                    companion_count,
                    user_message,
                )
                return _unique_attachments([*selected_history, *normalized_current_attachments])[-requested_attachment_count:]
            recent_history = history_attachments[-companion_count:]
            return _unique_attachments([*recent_history, *normalized_current_attachments])[-requested_attachment_count:]
        return normalized_current_attachments

    if not history_attachments:
        return []

    explicit_matches = [
        attachment
        for attachment in history_attachments
        if _message_explicitly_references_attachment(user_message, attachment)
    ]
    if explicit_matches:
        if _message_requests_multi_attachment_context(user_message):
            return _complete_multi_attachment_selection(
                history_attachments,
                explicit_matches,
                requested_attachment_count,
                user_message,
            )
        return [explicit_matches[-1]]

    if _message_requests_multi_attachment_context(user_message):
        if _message_uses_relative_attachment_reference(user_message):
            return history_attachments[-requested_attachment_count:]
        if _message_is_attachment_follow_up(user_message) or any(
            _message_references_attachment_generically(user_message, attachment)
            for attachment in history_attachments[-requested_attachment_count:]
        ):
            return history_attachments[-requested_attachment_count:]
        return []

    relative_attachment = _resolve_relative_attachment_reference(history_attachments, user_message)
    if relative_attachment:
        return relative_attachment

    latest_attachment = history_attachments[-1]
    latest_user_attachment = next(
        (
            content_json.get("attachment")
            for message in reversed(history)
            if isinstance(message, dict)
            and message.get("role") == "user"
            and isinstance((content_json := message.get("content_json")), dict)
        ),
        None,
    )
    if isinstance(latest_user_attachment, dict) and latest_user_attachment is latest_attachment:
        if _message_is_short_transformation_command(user_message):
            return [latest_attachment]

    if _message_references_attachment_generically(user_message, latest_attachment) or _message_is_attachment_follow_up(user_message):
        return [latest_attachment]
    return []


def _build_assistant_user_message(
    payload: Dict[str, Any],
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    payload_text = json.dumps(payload, ensure_ascii=False)
    image_parts = []
    for attachment in attachments or []:
        attachment_mime = attachment.get("mimeType")
        attachment_image = _read_attachment_image_payload(attachment)
        if not isinstance(attachment_mime, str):
            continue
        if not attachment_mime.strip() or not attachment_image:
            continue
        image_parts.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{attachment_mime};base64,{attachment_image}"
                },
            }
        )
    if image_parts:
        return {
            "role": "user",
            "content": [*image_parts, {"type": "text", "text": payload_text}],
        }
    return {"role": "user", "content": payload_text}


def _build_assistant_user_parts(
    payload: Dict[str, Any],
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    payload_text = json.dumps(payload, ensure_ascii=False)
    image_parts = []
    for attachment in attachments or []:
        attachment_mime = attachment.get("mimeType")
        attachment_image = _read_attachment_image_payload(attachment)
        if not isinstance(attachment_mime, str):
            continue
        if not attachment_mime.strip() or not attachment_image:
            continue
        image_parts.append(
            {
                "inlineData": {
                    "mimeType": attachment_mime,
                    "data": attachment_image,
                }
            },
        )
    if image_parts:
        return [*image_parts, {"text": payload_text}]
    return [{"text": payload_text}]


def _normalize_assistant_result(
    result: Dict[str, Any],
    *,
    skill_id: Optional[str] = None,
) -> Dict[str, Any]:
    assistant_text = result.get("assistantText")
    title = result.get("title")
    draft_card = result.get("draftCard")
    normalized_text = assistant_text.strip() if isinstance(assistant_text, str) else ""
    normalized_title = title.strip() if isinstance(title, str) and title.strip() else "AI 助理"
    normalized_card = None if _normalize_assistant_skill_id(skill_id) == "mock_interview" else _normalize_assistant_draft_card(draft_card)
    if not normalized_text:
        raise ValueError("AI 助理未返回有效回复。")
    return {
        "assistantText": normalized_text,
        "draftCard": normalized_card,
        "title": normalized_title,
        "suggestedFollowups": _normalize_assistant_suggested_followups(
            result.get("suggestedFollowups"),
            active_skill_id=skill_id,
        ),
    }


async def polish_experience(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    prompt = _build_polish_prompt(target_field, mode, jd_text, custom_prompt)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    if mode:
        content_payload["polish_mode"] = mode
    if custom_prompt:
        content_payload["custom_prompt"] = custom_prompt
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(content_payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_polish_result(result, mode)


async def polish_experience_with_thoughts(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
    mode: Optional[str] = None,
    custom_prompt: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await polish_experience(content, target_field, jd_text, mode, custom_prompt)

    prompt = _build_polish_prompt(target_field, mode, jd_text, custom_prompt)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    if mode:
        content_payload["polish_mode"] = mode
    if custom_prompt:
        content_payload["custom_prompt"] = custom_prompt
    try:
        result = await _stream_gemini_json_response(
            system_prompt=prompt,
            user_parts=[
                {"text": json.dumps(content_payload, ensure_ascii=False)},
            ],
            error_message="JD 润色失败，请稍后重试。",
            request_label="star_polish",
            budget_tokens=settings.ai_thinking_budget_polish,
            thought_callback=thought_callback,
        )
        return _normalize_polish_result(result, mode)
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for star_polish, falling back to standard polish.",
            exc_info=True,
        )
        return await polish_experience(content, target_field, jd_text, mode, custom_prompt)


async def run_assistant_turn(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]] = None,
    selected_experiences: Optional[List[Dict[str, Any]]] = None,
    selected_resume: Optional[Dict[str, Any]] = None,
    skill_id: Optional[str] = None,
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    attachment_hydrator: AttachmentHydrator = None,
) -> Dict[str, Any]:
    resolved_attachments = _resolve_relevant_attachments(history, attachments, user_message=user_message)
    if attachment_hydrator:
        resolved_attachments = await attachment_hydrator(resolved_attachments)
    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        bank_context=bank_context,
        selected_experiences=selected_experiences,
        selected_resume=selected_resume,
        skill_id=skill_id,
        history=history,
        attachments=resolved_attachments,
    )
    messages = [
        {"role": "system", "content": _get_assistant_prompt(mode, skill_id=skill_id)},
        _build_assistant_user_message(payload, resolved_attachments),
    ]
    if _normalize_assistant_skill_id(skill_id):
        result = await _call_llm_with_tools(
            messages,
            tools=_build_assistant_context_tools(),
            tool_executor=_build_assistant_context_tool_executor(payload),
            json_mode=True,
        )
    else:
        result = await _call_llm(messages, json_mode=True)
    return _normalize_assistant_result(result, skill_id=skill_id)


async def run_assistant_turn_with_thoughts(
    *,
    mode: str,
    user_message: str,
    session_title: str,
    entry_source: str,
    context_json: Dict[str, Any],
    bank_context: Optional[Dict[str, Any]] = None,
    selected_experiences: Optional[List[Dict[str, Any]]] = None,
    selected_resume: Optional[Dict[str, Any]] = None,
    skill_id: Optional[str] = None,
    history: List[Dict[str, Any]],
    attachments: Optional[List[Dict[str, Any]]] = None,
    thought_callback: ThoughtCallback = None,
    attachment_hydrator: AttachmentHydrator = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        await _emit_thought(
            thought_callback,
            {"type": "thought", "summary": "正在整理上下文并生成回复"},
        )
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            bank_context=bank_context,
            selected_experiences=selected_experiences,
            selected_resume=selected_resume,
            skill_id=skill_id,
            history=history,
            attachments=attachments,
            attachment_hydrator=attachment_hydrator,
        )

    resolved_attachments = _resolve_relevant_attachments(history, attachments, user_message=user_message)
    if attachment_hydrator:
        resolved_attachments = await attachment_hydrator(resolved_attachments)
    payload = _build_assistant_payload(
        mode=mode,
        user_message=user_message,
        session_title=session_title,
        entry_source=entry_source,
        context_json=context_json,
        bank_context=bank_context,
        selected_experiences=selected_experiences,
        selected_resume=selected_resume,
        skill_id=skill_id,
        history=history,
        attachments=resolved_attachments,
        include_selected_experience_full_text=False,
        preserve_selected_experience_star_text=True,
    )
    await _emit_thought(
        thought_callback,
        {"type": "thought", "summary": "正在分析上下文并组织回复"},
    )
    try:
        result = await _stream_gemini_json_response(
            system_prompt=_get_assistant_prompt(mode, skill_id=skill_id),
            user_parts=_build_assistant_user_parts(payload, resolved_attachments),
            error_message="AI 助理整理失败，请稍后重试。",
            request_label=f"assistant_{mode}",
            budget_tokens=settings.ai_thinking_budget_polish,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for assistant_%s, falling back to standard assistant turn.",
            mode,
            exc_info=True,
        )
        await _emit_thought(
            thought_callback,
            {"type": "thought", "summary": "实时思考流不可用，正在切换为标准生成"},
        )
        return await run_assistant_turn(
            mode=mode,
            user_message=user_message,
            session_title=session_title,
            entry_source=entry_source,
            context_json=context_json,
            bank_context=bank_context,
            selected_experiences=selected_experiences,
            selected_resume=selected_resume,
            skill_id=skill_id,
            history=history,
            attachments=attachments,
            attachment_hydrator=attachment_hydrator,
        )
    return _normalize_assistant_result(result, skill_id=skill_id)


async def generate_tags(text: str) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": TAG_GENERATION},
        {"role": "user", "content": text},
    ]
    return await _call_llm(messages, json_mode=True)


async def generate_boss_greeting(
    jd_text: str,
    analysis_summary: str,
    job_title: Optional[str] = None,
    company: Optional[str] = None,
    resume_text: Optional[str] = None,
) -> Dict[str, Any]:
    resume_payload = _safe_parse_resume_payload(resume_text) or {}
    payload = {
        "jd_text": jd_text,
        "analysis_summary": analysis_summary,
        "job_title": job_title or "",
        "company": company or "",
        "resume_text": resume_payload,
    }
    messages = [
        {"role": "system", "content": BOSS_GREETING_GENERATION},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_greeting_result(result)


async def generate_boss_greeting_with_thoughts(
    jd_text: str,
    analysis_summary: str,
    job_title: Optional[str] = None,
    company: Optional[str] = None,
    resume_text: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if settings.ai_thinking_budget_boss_greeting <= 0:
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )

    if not settings.gemini_api_key:
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )

    resume_payload = _safe_parse_resume_payload(resume_text) or {}
    payload = {
        "jd_text": jd_text,
        "analysis_summary": analysis_summary,
        "job_title": job_title or "",
        "company": company or "",
        "resume_text": resume_payload,
    }
    try:
        result = await _stream_gemini_json_response(
            system_prompt=BOSS_GREETING_GENERATION,
            user_parts=[{"text": json.dumps(payload, ensure_ascii=False)}],
            error_message="BOSS 招呼语生成失败，请稍后重试。",
            request_label="boss_greeting",
            budget_tokens=settings.ai_thinking_budget_boss_greeting,
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for boss_greeting, falling back to standard generation.",
            exc_info=True,
        )
        return await generate_boss_greeting(
            jd_text,
            analysis_summary,
            job_title,
            company,
            resume_text,
        )
    return _normalize_greeting_result(result)


async def generate_personal_summary(
    mode: str,
    profile: Optional[Dict[str, Any]] = None,
    work_experiences: Optional[List[Dict[str, Any]]] = None,
    project_experiences: Optional[List[Dict[str, Any]]] = None,
    education_experiences: Optional[List[Dict[str, Any]]] = None,
    certifications: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    jd_text: Optional[str] = None,
    polish_level: Optional[str] = None,
) -> Dict[str, Any]:
    payload = {
        "mode": mode,
        "profile": profile or {},
        "work_experiences": work_experiences or [],
        "project_experiences": project_experiences or [],
        "education_experiences": education_experiences or [],
        "certifications": certifications or [],
        "skills": skills or [],
        "jd_text": jd_text or "",
        "polish_level": polish_level or "标准",
    }
    messages = [
        {"role": "system", "content": PERSONAL_SUMMARY_GENERATION},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    result = await _call_llm(messages, json_mode=True)
    return _normalize_summary_result(result)


async def generate_personal_summary_with_thoughts(
    mode: str,
    profile: Optional[Dict[str, Any]] = None,
    work_experiences: Optional[List[Dict[str, Any]]] = None,
    project_experiences: Optional[List[Dict[str, Any]]] = None,
    education_experiences: Optional[List[Dict[str, Any]]] = None,
    certifications: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    jd_text: Optional[str] = None,
    polish_level: Optional[str] = None,
    thought_callback: ThoughtCallback = None,
) -> Dict[str, Any]:
    if not settings.gemini_api_key:
        return await generate_personal_summary(
            mode=mode,
            profile=profile,
            work_experiences=work_experiences,
            project_experiences=project_experiences,
            education_experiences=education_experiences,
            certifications=certifications,
            skills=skills,
            jd_text=jd_text,
            polish_level=polish_level,
        )

    payload = {
        "mode": mode,
        "profile": profile or {},
        "work_experiences": work_experiences or [],
        "project_experiences": project_experiences or [],
        "education_experiences": education_experiences or [],
        "certifications": certifications or [],
        "skills": skills or [],
        "jd_text": jd_text or "",
        "polish_level": polish_level or "标准",
    }
    try:
        result = await _stream_gemini_json_response(
            system_prompt=PERSONAL_SUMMARY_GENERATION,
            user_parts=[{"text": json.dumps(payload, ensure_ascii=False)}],
            error_message="个人评价生成失败，请稍后重试。",
            request_label="personal_summary",
            thought_callback=thought_callback,
        )
    except Exception:
        logger.warning(
            "[AI Stream] Gemini thought streaming failed for personal_summary, falling back to standard generation.",
            exc_info=True,
        )
        return await generate_personal_summary(
            mode=mode,
            profile=profile,
            work_experiences=work_experiences,
            project_experiences=project_experiences,
            education_experiences=education_experiences,
            certifications=certifications,
            skills=skills,
            jd_text=jd_text,
            polish_level=polish_level,
        )
    return _normalize_summary_result(result)

