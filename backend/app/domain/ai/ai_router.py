from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...dependencies import get_current_user
from .ai_service import analyze_jd, generate_boss_greeting, generate_tags, polish_experience

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
