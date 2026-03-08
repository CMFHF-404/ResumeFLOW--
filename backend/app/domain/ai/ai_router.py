from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.status import HTTP_400_BAD_REQUEST

from ...dependencies import get_current_user
from .ai_service import (
    analyze_jd,
    analyze_jd_with_image,
    generate_boss_greeting,
    generate_tags,
    polish_experience,
)
from . import jd_attachment_service

router = APIRouter(prefix="/api", tags=["ai"])


class AnalyzeJDRequest(BaseModel):
    text: str
    resume_text: Optional[str] = None
    prev_result: Optional[Dict[str, Any]] = None
    experience_text: Optional[str] = None
    prev_experience_text: Optional[str] = None


class PolishTextRequest(BaseModel):
    content: Dict[str, Any]
    target_field: Optional[str] = None
    jd_text: Optional[str] = None


class GenerateTagsRequest(BaseModel):
    text: str


class GenerateBossGreetingRequest(BaseModel):
    jd_text: str
    analysis_summary: str
    job_title: Optional[str] = None
    company: Optional[str] = None
    resume_text: Optional[str] = None


@router.post("/analyze-jd", response_model=Dict[str, Any])
async def analyze_jd_endpoint(
    payload: AnalyzeJDRequest,
    current_user=Depends(get_current_user),
):
    return await analyze_jd(
        payload.text,
        payload.resume_text,
        payload.prev_result,
        payload.experience_text,
        payload.prev_experience_text,
    )


@router.post("/polish-text", response_model=Dict[str, Any])
async def polish_text_endpoint(
    payload: PolishTextRequest,
    current_user=Depends(get_current_user),
):
    return await polish_experience(payload.content, payload.target_field, payload.jd_text)


@router.post("/generate-tags", response_model=Dict[str, Any])
async def generate_tags_endpoint(
    payload: GenerateTagsRequest,
    current_user=Depends(get_current_user),
):
    return await generate_tags(payload.text)


@router.post("/generate-boss-greeting", response_model=Dict[str, Any])
async def generate_boss_greeting_endpoint(
    payload: GenerateBossGreetingRequest,
    current_user=Depends(get_current_user),
):
    return await generate_boss_greeting(
        payload.jd_text,
        payload.analysis_summary,
        payload.job_title,
        payload.company,
        payload.resume_text,
    )


@router.post("/analyze-jd-attachment", response_model=Dict[str, Any])
async def analyze_jd_attachment_endpoint(
    file: UploadFile = File(...),
    jd_text: Optional[str] = Form(None),
    resume_text: Optional[str] = Form(None),
    experience_text: Optional[str] = Form(None),
    prev_result: Optional[str] = Form(None),
    prev_experience_text: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
):
    """
    附件 JD 分析端点。
    - 图像（jpg/png/webp）→ vision 路径，模型直接解读图像
    - PDF/DOCX → 文本提取后走现有分析路径
    """
    try:
        attachment = await jd_attachment_service.extract_jd_from_attachment(file)
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    prev_result_dict: Optional[Dict[str, Any]] = None
    if prev_result:
        import json as _json
        try:
            prev_result_dict = _json.loads(prev_result)
        except Exception:
            prev_result_dict = None

    supplemental_jd_text = (jd_text or "").strip()

    if attachment.is_image:
        return await analyze_jd_with_image(
            image_b64=attachment.image_b64,
            mime_type=attachment.mime_type,
            resume_text=resume_text,
            prev_result=prev_result_dict,
            experience_text=experience_text,
            prev_experience_text=prev_experience_text,
            jd_text=supplemental_jd_text or None,
        )

    # 文本路径：将文档提取的文字与手动输入拼接
    extracted_jd_text = (attachment.text or "").strip()
    combined_jd_text = extracted_jd_text
    if supplemental_jd_text:
        combined_jd_text = (
            f"{extracted_jd_text}\n\n补充 JD 说明：\n{supplemental_jd_text}"
            if extracted_jd_text
            else supplemental_jd_text
        )
    return await analyze_jd(
        text=combined_jd_text,
        resume_text=resume_text,
        prev_result=prev_result_dict,
        experience_text=experience_text,
        prev_experience_text=prev_experience_text,
    )

