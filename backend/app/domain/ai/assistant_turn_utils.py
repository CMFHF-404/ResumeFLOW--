import re
from typing import Any, Dict, List, Optional

from .assistant_action_utils import _normalize_assistant_draft_card
from .assistant_attachments import (
    _build_assistant_attachment_context,
    _normalize_assistant_history,
)
from .assistant_context import (
    _normalize_selected_experiences,
    _normalize_selected_resume,
)
from .prompts import (
    CERTIFICATION_ASSISTANT_PROMPT,
    EXPERIENCE_ASSISTANT_PROMPT,
    GENERAL_ASSISTANT_PROMPT,
    SKILL_ASSISTANT_PROMPT,
)

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

ASSISTANT_SKILL_PROMPTS: Dict[str, Dict[str, str]] = {
    "star_guidance": {
        "title": "STAR 引导助手",
        "prompt": (
            "Current assistant skill: STAR 引导助手. Your primary job is to guide the user to complete "
            "a factual STAR experience. First inspect selected_experiences, selected_resume, attachments, "
            "and bank_context. If information is insufficient, ask exactly one focused follow-up question "
            "about the most important missing STAR detail and set draftCard to null. Do not rush to produce "
            "a finished draft. You may return a draftCard only when the user explicitly asks for a draft, "
            "confirms the information is enough, or the supplied work/project facts already cover S/T/A/R. "
            "For education material, a draft may be returned when the material covers school, major, degree, "
            "GPA or grades, or coursework well enough to save an education experience. "
            "When the material is clearly education, grades, or coursework, organize it as an education "
            "experience draft instead of forcing work/project-style actions and results. "
            "When returning draftCard, follow the experience card schema exactly."
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


def _is_off_scope_smart_complete_question(question: str) -> bool:
    normalized = re.sub(r"\s+", "", question)
    if not normalized:
        return True
    if any(term in normalized for term in SMART_COMPLETE_OFF_SCOPE_QUESTION_TERMS):
        return True
    if ("其他" in normalized or "其它" in normalized) and ("项目" in normalized or "案例" in normalized):
        return True
    return "是否有过任何" in normalized


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
