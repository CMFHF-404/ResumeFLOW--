from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...dependencies import get_current_user
from .ai_service import analyze_jd, polish_experience

router = APIRouter(prefix="/api", tags=["ai"])


class AnalyzeJDRequest(BaseModel):
    text: str
    resume_text: Optional[str] = None


class PolishTextRequest(BaseModel):
    content: Dict[str, Any]


@router.post("/analyze-jd", response_model=Dict[str, Any])
async def analyze_jd_endpoint(
    payload: AnalyzeJDRequest,
    current_user=Depends(get_current_user),
):
    return await analyze_jd(payload.text, payload.resume_text)


@router.post("/polish-text", response_model=Dict[str, Any])
async def polish_text_endpoint(
    payload: PolishTextRequest,
    current_user=Depends(get_current_user),
):
    return await polish_experience(payload.content)
