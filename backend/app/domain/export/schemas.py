from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from ..certifications.schemas import CertificationRead
from ..experience.schemas import ExperienceListItem
from ..profile.schemas import ProfileRead
from ..skills.schemas import UserSkillRead


class StarFields(BaseModel):
    s: str = ""
    t: str = ""
    a: str = ""
    r: str = ""


class ResumeEditorProfileSnapshot(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    linkedin: str = ""
    summary: str = ""
    avatarDataUrl: str = ""


class ResumeExperienceViewSnapshot(BaseModel):
    id: str
    title: str
    company: str
    date: str
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    isCurrent: Optional[bool] = None
    star: StarFields = Field(default_factory=StarFields)
    category: str
    isDraft: Optional[bool] = None


class EducationViewSnapshot(BaseModel):
    id: str
    school: str
    major: str
    degree: str
    startDate: str
    endDate: str
    isCurrent: Optional[bool] = None
    gpa: Optional[str] = None
    courses: Optional[str] = None
    isDraft: Optional[bool] = None


class CertificationViewSnapshot(BaseModel):
    id: str
    name: str
    issuer: Optional[str] = None
    date: str
    matchRate: Optional[int] = None
    isDraft: Optional[bool] = None


class SkillItemViewSnapshot(BaseModel):
    id: str
    name: str


class SkillGroupViewSnapshot(BaseModel):
    name: str
    skills: List[SkillItemViewSnapshot] = Field(default_factory=list)


class ResumePdfRenderSnapshot(BaseModel):
    resumeName: str
    profile: ResumeEditorProfileSnapshot
    lineHeight: float
    fontSize: float
    listSpacingValue: str
    bulletSpacingValue: str
    topPaddingPx: float
    sectionSpacingClass: str
    listSpacingClass: str
    sectionOrder: List[str] = Field(default_factory=list)
    selectedWorkItems: List[ResumeExperienceViewSnapshot] = Field(default_factory=list)
    selectedProjectItems: List[ResumeExperienceViewSnapshot] = Field(default_factory=list)
    educations: List[EducationViewSnapshot] = Field(default_factory=list)
    selectedEduIds: List[str] = Field(default_factory=list)
    sortedCertifications: List[CertificationViewSnapshot] = Field(default_factory=list)
    selectedCertIds: List[str] = Field(default_factory=list)
    selectedSkillGroups: List[SkillGroupViewSnapshot] = Field(default_factory=list)
    templateId: str = "modern-slate"
    themeColorPresetId: str = "slate"


class ResumePdfExportRequest(BaseModel):
    snapshot: ResumePdfRenderSnapshot
    fileName: Optional[str] = None


class RenderSnapshotRead(BaseModel):
    snapshot: ResumePdfRenderSnapshot


class ExportDownloadLinkRead(BaseModel):
    downloadUrl: str
    fileName: str


class ExperienceBankPdfRenderSnapshot(BaseModel):
    profile: Optional[ProfileRead] = None
    workItems: List[ExperienceListItem] = Field(default_factory=list)
    projectItems: List[ExperienceListItem] = Field(default_factory=list)
    educationItems: List[ExperienceListItem] = Field(default_factory=list)
    certifications: List[CertificationRead] = Field(default_factory=list)
    skills: List[UserSkillRead] = Field(default_factory=list)
    exportDateLabel: Optional[str] = None


class ExperienceBankPdfExportRequest(BaseModel):
    snapshot: ExperienceBankPdfRenderSnapshot
    fileName: Optional[str] = None


class ExperienceBankRenderSnapshotRead(BaseModel):
    snapshot: ExperienceBankPdfRenderSnapshot
