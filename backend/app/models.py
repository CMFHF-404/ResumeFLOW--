from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.utcnow()


class ExperienceCategory(str, Enum):
    WORK = "work"
    PROJECT = "project"
    EDUCATION = "education"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(primary_key=True, index=True)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class Profile(SQLModel, table=True):
    __tablename__ = "profiles"

    user_id: str = Field(primary_key=True, foreign_key="users.id")
    full_name: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    social_links: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    extra_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ProfileLink(SQLModel, table=True):
    __tablename__ = "profile_links"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="profiles.user_id", index=True)
    label: str
    url: str
    position: int = 0


class Resume(SQLModel, table=True):
    __tablename__ = "resumes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    title: str
    target_role: Optional[str] = None
    template_id: Optional[str] = None
    is_archived: bool = False
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class MasterExperience(SQLModel, table=True):
    __tablename__ = "master_experiences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    category: ExperienceCategory
    latest_version_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="experience_versions.id", index=True
    )
    is_archived: bool = False
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)


class ExperienceVersion(SQLModel, table=True):
    __tablename__ = "experience_versions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    master_experience_id: uuid.UUID = Field(foreign_key="master_experiences.id", index=True)
    version: int
    title: str
    org: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    is_current: bool = False
    summary: Optional[str] = None
    highlights: List[str] = Field(default_factory=list, sa_column=Column(ARRAY(Text)))
    star: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class ResumeExperience(SQLModel, table=True):
    __tablename__ = "resume_experiences"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    resume_id: uuid.UUID = Field(foreign_key="resumes.id", index=True)
    experience_version_id: uuid.UUID = Field(foreign_key="experience_versions.id", index=True)
    section: str
    position: int = 0
    overrides_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=utc_now, nullable=False)


class Skill(SQLModel, table=True):
    __tablename__ = "skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    category: Optional[str] = None


class UserSkill(SQLModel, table=True):
    __tablename__ = "user_skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    skill_id: uuid.UUID = Field(foreign_key="skills.id", index=True)
    proficiency: Optional[int] = None


class ExperienceVersionSkill(SQLModel, table=True):
    __tablename__ = "experience_version_skills"

    experience_version_id: uuid.UUID = Field(
        foreign_key="experience_versions.id", primary_key=True
    )
    skill_id: uuid.UUID = Field(foreign_key="skills.id", primary_key=True)


class ResumeSkill(SQLModel, table=True):
    __tablename__ = "resume_skills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    resume_id: uuid.UUID = Field(foreign_key="resumes.id", index=True)
    skill_name_snapshot: str
    position: int = 0
