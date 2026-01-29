from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .domain.experience.schemas import (
    ExperienceCreate,
    ExperienceDetail,
    ExperienceListItem,
    ExperienceUpdate,
    ExperienceVersionPayload,
    ExperienceVersionRead,
    MasterExperienceRead,
)
from .domain.profile.schemas import ProfileRead, ProfileUpdate


class ResumeCreate(BaseModel):
    title: str
    target_role: Optional[str] = None
    template_id: Optional[str] = None


class ResumeUpdate(BaseModel):
    title: Optional[str] = None
    target_role: Optional[str] = None
    template_id: Optional[str] = None
    is_archived: Optional[bool] = None


class ResumeRead(BaseModel):
    id: str
    user_id: str
    title: str
    target_role: Optional[str] = None
    template_id: Optional[str] = None
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class ExperienceSnapshot(BaseModel):
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
    star: Dict[str, Any]


class ResumeExperienceRead(BaseModel):
    id: str
    resume_id: str
    section: str
    position: int
    overrides_json: Dict[str, Any] = Field(default_factory=dict)
    experience: ExperienceSnapshot


class ResumeDetail(BaseModel):
    resume: ResumeRead
    experiences: List[ResumeExperienceRead] = Field(default_factory=list)


class ResumeExperiencePatch(BaseModel):
    ops: List[Dict[str, Any]]
