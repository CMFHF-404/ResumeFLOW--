import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE

from ...config import load_settings
from .prompts import (
    JD_ANALYSIS,
    STAR_POLISH,
    TAG_GENERATION,
)

settings = load_settings()
logger = logging.getLogger(__name__)

MAX_ERROR_BODY_LOG_LENGTH = 2000
DEFAULT_MATCH_SCORE = 0
RESUME_SKILLS_KEY = "skills"

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


async def _call_llm(messages: List[Dict[str, str]], json_mode: bool = True) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
    }
    url = f"{settings.ai_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.post(url, headers=_build_headers(), json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_http_error(response)
            raise
        data = response.json()
        _log_http_success(response, payload["model"], len(messages))
    content = _extract_content(data)
    if json_mode:
        return _parse_json_content(content)
    return {"content": content}


async def call_llm_json(messages: List[Dict[str, str]]) -> Dict[str, Any]:
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
    return _ensure_skill_matches(result, skill_ids)


def _resolve_star_prompt(target_field: Optional[str]) -> str:
    return STAR_POLISH


async def polish_experience(
    content: Dict[str, Any],
    target_field: Optional[str] = None,
    jd_text: Optional[str] = None,
) -> Dict[str, Any]:
    prompt = _resolve_star_prompt(target_field)
    content_payload = {**content}
    if jd_text:
        content_payload["jd_text"] = jd_text
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": json.dumps(content_payload, ensure_ascii=False)},
    ]
    return await _call_llm(messages, json_mode=True)


async def generate_tags(text: str) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": TAG_GENERATION},
        {"role": "user", "content": text},
    ]
    return await _call_llm(messages, json_mode=True)
