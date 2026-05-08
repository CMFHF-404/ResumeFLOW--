from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

from ...models import ExperienceCategory
from ...utils.date_utils import coerce_month_date, is_blank_or_present_date


class ExperienceVersionPayload(BaseModel):
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool = False
    summary: Optional[str] = None
    highlights: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    star: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def _normalize_month_date(cls, value: Any) -> Any:
        if is_blank_or_present_date(value):
            return None
        return coerce_month_date(value) or value


class ExperienceCreate(BaseModel):
    category: ExperienceCategory
    version: ExperienceVersionPayload


class ExperienceUpdate(BaseModel):
    category: Optional[ExperienceCategory] = None
    is_archived: Optional[bool] = None
    version: Optional[ExperienceVersionPayload] = None


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
    tags: List[str]
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
