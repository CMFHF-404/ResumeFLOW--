from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .models import ExperienceCategory


class ProfileLinkPayload(BaseModel):
    label: str
    url: str
    position: int = 0


class ProfileRead(BaseModel):
    user_id: str
    full_name: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    extra_json: Dict[str, Any] = Field(default_factory=dict)
    links: List[ProfileLinkPayload] = Field(default_factory=list)
    updated_at: datetime


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    extra_json: Optional[Dict[str, Any]] = None
    links: Optional[List[ProfileLinkPayload]] = None


class ExperienceVersionPayload(BaseModel):
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool = False
    summary: Optional[str] = None
    highlights: List[str] = Field(default_factory=list)
    star: Dict[str, Any] = Field(default_factory=dict)


class ExperienceCreate(BaseModel):
    category: ExperienceCategory
    version: ExperienceVersionPayload


class ExperienceUpdate(BaseModel):
    category: Optional[ExperienceCategory] = None
    is_archived: Optional[bool] = None


class ExperienceVersionRead(BaseModel):
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
    created_at: datetime


class MasterExperienceRead(BaseModel):
    id: str
    category: ExperienceCategory
    latest_version_id: Optional[str] = None
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class ExperienceDetail(BaseModel):
    master: MasterExperienceRead
    latest_version: Optional[ExperienceVersionRead] = None
    versions: List[ExperienceVersionRead] = Field(default_factory=list)


class ExperienceListItem(BaseModel):
    master: MasterExperienceRead
    latest_version: Optional[ExperienceVersionRead] = None


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
