import hashlib
import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

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
