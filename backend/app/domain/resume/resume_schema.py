from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from ...utils.date_utils import coerce_month_date, is_blank_or_present_date


class ResumeCreate(BaseModel):
    title: str
    target_role: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)


class ResumeRead(BaseModel):
    id: str
    user_id: str
    title: str
    target_role: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ResumeUpdate(BaseModel):
    title: Optional[str] = None
    target_role: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class ResumeDuplicate(BaseModel):
    title: Optional[str] = None


class ResumeExperienceMerged(BaseModel):
    id: str
    master_experience_id: str
    version: int
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool
    summary: Optional[str] = None
    highlights: List[str]
    tags: List[str]
    star: Dict[str, Any]

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def _normalize_month_date(cls, value: Any) -> Any:
        if is_blank_or_present_date(value):
            return None
        return coerce_month_date(value) or value


class ResumeExperienceItem(BaseModel):
    id: str
    resume_id: str
    experience_version_id: str
    display_order: int
    overrides_json: Dict[str, Any] = Field(default_factory=dict)
    experience: ResumeExperienceMerged


class ResumeDetail(BaseModel):
    resume: ResumeRead
    experiences: List[ResumeExperienceItem] = Field(default_factory=list)


class ResumeAssemblyPatch(BaseModel):
    operations: List[Dict[str, Any]]
