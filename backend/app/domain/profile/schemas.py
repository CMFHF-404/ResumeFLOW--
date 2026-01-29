from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


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
    social_links: Dict[str, Any] = Field(default_factory=dict)
    links: List[ProfileLinkPayload] = Field(default_factory=list)
    extra_json: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    social_links: Optional[Dict[str, Any]] = None
    extra_json: Optional[Dict[str, Any]] = None
    links: Optional[List[ProfileLinkPayload]] = None
