from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


DEFAULT_AGENT_TEMPLATE_ID = "modern-slate"
DEFAULT_AGENT_POLISH_LEVEL = "标准"


class AgentPluginConfigRead(BaseModel):
    selected_template_id: str = DEFAULT_AGENT_TEMPLATE_ID
    polish_before_output: bool = True
    polish_level: str = DEFAULT_AGENT_POLISH_LEVEL
    force_one_page: bool = True


class AgentPluginConfigUpdate(BaseModel):
    selected_template_id: str = Field(default=DEFAULT_AGENT_TEMPLATE_ID, min_length=1, max_length=80)
    polish_before_output: bool = True
    polish_level: str = Field(default=DEFAULT_AGENT_POLISH_LEVEL, min_length=1, max_length=20)
    force_one_page: bool = True


class AgentApiKeyCreate(BaseModel):
    name: str = Field(default="Agent", min_length=1, max_length=80)


class AgentApiKeyRead(BaseModel):
    id: str
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class AgentApiKeyCreateResponse(BaseModel):
    key: str
    api_key: AgentApiKeyRead


class AgentApiKeyRevokeResponse(BaseModel):
    id: str
    revoked_at: datetime


class AgentSkillBundleFile(BaseModel):
    path: str
    content: str


class AgentSkillBundleResponse(BaseModel):
    name: str
    files: List[AgentSkillBundleFile]


class AgentJobRequest(BaseModel):
    job_title: str = Field(min_length=1, max_length=160)
    company_name: str = Field(min_length=1, max_length=160)
    jd_text: str = Field(min_length=1)
    job_url: HttpUrl
    source: Optional[str] = Field(default=None, max_length=80)
    resume_id: Optional[str] = None


class AgentJobGenerateRequest(AgentJobRequest):
    template_id: Optional[str] = None
    polish_before_output: Optional[bool] = None
    polish_level: Optional[str] = None
    force_one_page: Optional[bool] = None


class AgentJobAnalysisResponse(BaseModel):
    match_percentage: int
    evaluation: str
    strengths: List[str] = Field(default_factory=list)
    gaps: List[str] = Field(default_factory=list)
    missing_keywords: List[str] = Field(default_factory=list)
    recommendation: Literal["skip", "review", "generate"] = "review"
    suggested_folder_name: str


class AgentResumePdf(BaseModel):
    download_url: str
    file_name: str
    generated_resume_id: Optional[str] = None
    generated_resume_title: Optional[str] = None


class AgentJobMetadata(BaseModel):
    job_title: str
    company_name: str
    jd_text: str
    job_url: str
    source: Optional[str] = None
    generated_at: datetime
    folder_name: str
    match_percentage: int


class AgentJobGenerateResponse(AgentJobAnalysisResponse):
    resume_pdf: AgentResumePdf
    job_link_url: str
    job_metadata: AgentJobMetadata
