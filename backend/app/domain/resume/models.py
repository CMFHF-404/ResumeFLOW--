from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
import uuid

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ...utils.time_utils import utc_now


class Resume(SQLModel, table=True):
    __tablename__ = "resumes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    title: str
    target_role: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ResumeExperienceLink(SQLModel, table=True):
    __tablename__ = "resume_experiences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    resume_id: uuid.UUID = Field(foreign_key="resumes.id", index=True)
    experience_version_id: uuid.UUID = Field(
        foreign_key="experience_versions.id", index=True
    )
    overrides_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    display_order: int = 0
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
