import json
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE

from ...config import load_settings
from .prompts import JD_ANALYSIS, STAR_POLISH, TAG_GENERATION

settings = load_settings()


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
        raise ValueError("Invalid JSON returned by model") from exc


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


async def _call_llm(messages: List[Dict[str, str]], json_mode: bool = True) -> Dict[str, Any]:
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.3,
    }
    url = f"{settings.ai_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, headers=_build_headers(), json=payload)
        response.raise_for_status()
        data = response.json()
    content = _extract_content(data)
    if json_mode:
        return _parse_json_content(content)
    return {"content": content}


async def analyze_jd(text: str, resume_text: Optional[str] = None) -> Dict[str, Any]:
    resume_payload = resume_text or "Resume content not provided."
    messages = [
        {"role": "system", "content": JD_ANALYSIS},
        {
            "role": "user",
            "content": f"Job Description:\n{text}\n\nResume Content:\n{resume_payload}",
        },
    ]
    return await _call_llm(messages, json_mode=True)


async def polish_experience(content: Dict[str, Any]) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": STAR_POLISH},
        {"role": "user", "content": json.dumps(content, ensure_ascii=False)},
    ]
    return await _call_llm(messages, json_mode=True)


async def generate_tags(text: str) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": TAG_GENERATION},
        {"role": "user", "content": text},
    ]
    return await _call_llm(messages, json_mode=True)
