from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ...models import ExperienceCategory


class ParsedExperienceVersion(BaseModel):
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: bool = False
    summary: Optional[str] = None
    highlights: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    star: Dict[str, Any] = Field(default_factory=dict)


class DuplicateMatch(BaseModel):
    is_duplicate: bool = False
    match_type: Optional[str] = None
    match_score: Optional[float] = None


class ParsedExperienceItem(BaseModel):
    id: str
    category: ExperienceCategory
    version: ParsedExperienceVersion
    duplicate: DuplicateMatch = Field(default_factory=DuplicateMatch)


class ResumeParseResponse(BaseModel):
    items: List[ParsedExperienceItem] = Field(default_factory=list)
