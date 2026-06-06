import json
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from ...config import load_settings
from .llm_transport import _call_llm, _stream_gemini_json_response
from .prompts import JD_ANALYSIS, JD_ANALYSIS_IMAGE
from .response_normalizers import (
    _ensure_skill_matches,
    _extract_skill_ids,
    _normalize_jd_analysis_result,
)

settings = load_settings()
logger = logging.getLogger(__name__)

ThoughtCallback = Optional[Callable[[Dict[str, Any]], Optional[Awaitable[None]]]]


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
