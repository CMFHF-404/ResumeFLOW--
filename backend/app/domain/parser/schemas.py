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
    matched_existing_id: Optional[str] = None
    match_reason: Optional[str] = None


class ParsedExperienceItem(BaseModel):
    id: str
    category: ExperienceCategory
    version: ParsedExperienceVersion
    duplicate: DuplicateMatch = Field(default_factory=DuplicateMatch)


class ParsedPersonalInfo(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    links: List[str] = Field(default_factory=list)


class ParsedCertification(BaseModel):
    name: str
    issuer: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    credential_id: Optional[str] = None
    credential_url: Optional[str] = None
    description: Optional[str] = None


class ParsedSkillGroup(BaseModel):
    category: str
    tags: List[str] = Field(default_factory=list)


class ResumeParseResponse(BaseModel):
    items: List[ParsedExperienceItem] = Field(default_factory=list)
    personal_info: Optional[ParsedPersonalInfo] = None
    certifications: List[ParsedCertification] = Field(default_factory=list)
    skills: List[ParsedSkillGroup] = Field(default_factory=list)
