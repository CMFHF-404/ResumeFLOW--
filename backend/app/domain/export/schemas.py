from __future__ import annotations

import math
from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any, List, Optional

from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

from ..certifications.schemas import CertificationRead
from ..experience.schemas import ExperienceListItem
from ..profile.schemas import ProfileRead
from ..skills.schemas import UserSkillRead
from .download_contract import MAX_EXPORT_FILE_NAME_CHARACTERS
from .image_data_url import validate_avatar_data_url
from .limits import (
    MAX_EXPORT_BANK_SKILL_ITEMS,
    MAX_EXPORT_CERTIFICATION_ITEMS,
    MAX_EXPORT_EDUCATION_ITEMS,
    MAX_EXPORT_EXPERIENCE_ITEMS,
    MAX_EXPORT_ID_CHARACTERS,
    MAX_EXPORT_LAYOUT_TOKEN_CHARACTERS,
    MAX_EXPORT_LONG_TEXT_CHARACTERS,
    MAX_EXPORT_NESTED_COLLECTION_ITEMS,
    MAX_EXPORT_PROFILE_LINK_ITEMS,
    MAX_EXPORT_SECTION_ORDER_ITEMS,
    MAX_EXPORT_SHORT_TEXT_CHARACTERS,
    MAX_EXPORT_SKILL_GROUP_ITEMS,
    MAX_EXPORT_SKILLS_PER_GROUP,
)


def _validate_export_text(value: str) -> str:
    if "\x00" in value:
        raise ValueError("导出文本不能包含 NUL 字符。")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise ValueError("导出文本包含无效 Unicode 字符。") from exc
    return value


ExportId = Annotated[
    str,
    Field(max_length=MAX_EXPORT_ID_CHARACTERS),
    AfterValidator(_validate_export_text),
]
ExportShortText = Annotated[
    str,
    Field(max_length=MAX_EXPORT_SHORT_TEXT_CHARACTERS),
    AfterValidator(_validate_export_text),
]
ExportLongText = Annotated[
    str,
    Field(max_length=MAX_EXPORT_LONG_TEXT_CHARACTERS),
    AfterValidator(_validate_export_text),
]
ExportLayoutToken = Annotated[
    str,
    Field(max_length=MAX_EXPORT_LAYOUT_TOKEN_CHARACTERS),
    AfterValidator(_validate_export_text),
]
ExportFileName = Annotated[
    str,
    Field(max_length=MAX_EXPORT_FILE_NAME_CHARACTERS),
    AfterValidator(_validate_export_text),
]


def _validate_nested_export_value(value: Any, *, depth: int = 0) -> None:
    if depth > 12:
        raise ValueError("导出数据嵌套层级过深。")
    if isinstance(value, str):
        _validate_export_text(value)
        if len(value) > MAX_EXPORT_LONG_TEXT_CHARACTERS:
            raise ValueError("导出文本字段过长。")
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("导出数字字段必须为有限值。")
        return
    if value is None or isinstance(value, (bool, int, date, datetime, Enum)):
        return
    if isinstance(value, BaseModel):
        _validate_nested_export_value(
            value.model_dump(mode="python"),
            depth=depth,
        )
        return
    if isinstance(value, list):
        if len(value) > MAX_EXPORT_NESTED_COLLECTION_ITEMS:
            raise ValueError("导出列表项目过多。")
        for item in value:
            _validate_nested_export_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > MAX_EXPORT_NESTED_COLLECTION_ITEMS:
            raise ValueError("导出对象字段过多。")
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("导出对象字段名必须为文本。")
            resolved_key = _validate_export_text(key)
            if len(resolved_key) > MAX_EXPORT_SHORT_TEXT_CHARACTERS:
                raise ValueError("导出对象字段名过长。")
            _validate_nested_export_value(item, depth=depth + 1)
        return
    raise ValueError("导出数据包含无法序列化的值。")


class StarFields(BaseModel):
    s: ExportLongText = ""
    t: ExportLongText = ""
    a: ExportLongText = ""
    r: ExportLongText = ""


class ResumeEditorProfileSnapshot(BaseModel):
    name: ExportShortText = ""
    email: ExportShortText = ""
    phone: ExportShortText = ""
    location: ExportShortText = ""
    linkedin: ExportShortText = ""
    summary: ExportLongText = ""
    avatarDataUrl: str = ""

    @field_validator("avatarDataUrl")
    @classmethod
    def _validate_avatar_data_url(cls, value: str) -> str:
        return validate_avatar_data_url(_validate_export_text(value))


class ResumeExperienceViewSnapshot(BaseModel):
    id: ExportId
    title: ExportShortText
    company: ExportShortText
    date: ExportShortText
    startDate: Optional[ExportShortText] = None
    endDate: Optional[ExportShortText] = None
    isCurrent: Optional[bool] = None
    star: StarFields = Field(default_factory=StarFields)
    category: ExportShortText
    isDraft: Optional[bool] = None


class EducationViewSnapshot(BaseModel):
    id: ExportId
    school: ExportShortText
    major: ExportShortText
    degree: ExportShortText
    startDate: ExportShortText
    endDate: ExportShortText
    isCurrent: Optional[bool] = None
    gpa: Optional[ExportShortText] = None
    courses: Optional[ExportLongText] = None
    isDraft: Optional[bool] = None


class CertificationViewSnapshot(BaseModel):
    id: ExportId
    name: ExportShortText
    issuer: Optional[ExportShortText] = None
    date: ExportShortText
    matchRate: Optional[int] = None
    isDraft: Optional[bool] = None


class SkillItemViewSnapshot(BaseModel):
    id: ExportId
    name: ExportShortText


class SkillGroupViewSnapshot(BaseModel):
    name: ExportShortText
    skills: List[SkillItemViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_SKILLS_PER_GROUP,
    )


class ResumePdfRenderSnapshot(BaseModel):
    resumeName: ExportShortText
    targetRole: ExportShortText = ""
    profile: ResumeEditorProfileSnapshot
    lineHeight: float = Field(ge=0.8, le=3.0, allow_inf_nan=False)
    fontSize: float = Field(ge=8.0, le=72.0, allow_inf_nan=False)
    listSpacingValue: ExportLayoutToken
    bulletSpacingValue: ExportLayoutToken
    topPaddingPx: float = Field(ge=0.0, le=500.0, allow_inf_nan=False)
    sectionSpacingClass: ExportLayoutToken
    listSpacingClass: ExportLayoutToken
    sectionOrder: List[ExportId] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_SECTION_ORDER_ITEMS,
    )
    selectedWorkItems: List[ResumeExperienceViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EXPERIENCE_ITEMS,
    )
    selectedProjectItems: List[ResumeExperienceViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EXPERIENCE_ITEMS,
    )
    educations: List[EducationViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EDUCATION_ITEMS,
    )
    selectedEduIds: List[ExportId] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EDUCATION_ITEMS,
    )
    sortedCertifications: List[CertificationViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_CERTIFICATION_ITEMS,
    )
    selectedCertIds: List[ExportId] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_CERTIFICATION_ITEMS,
    )
    selectedSkillGroups: List[SkillGroupViewSnapshot] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_SKILL_GROUP_ITEMS,
    )
    templateId: ExportLayoutToken = "modern-slate"
    themeColorPresetId: ExportLayoutToken = "slate"
    experienceListMarkerStyle: ExportLayoutToken = "unordered"
    skillTagSeparator: ExportLayoutToken = "，"


class ResumePdfExportRequest(BaseModel):
    snapshot: ResumePdfRenderSnapshot
    fileName: Optional[ExportFileName] = None


class RenderSnapshotRead(BaseModel):
    snapshot: ResumePdfRenderSnapshot


class ExportDownloadLinkRead(BaseModel):
    downloadUrl: str
    fileName: str = Field(max_length=MAX_EXPORT_FILE_NAME_CHARACTERS)


class ExperienceBankPdfRenderSnapshot(BaseModel):
    profile: Optional[ProfileRead] = None
    workItems: List[ExperienceListItem] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EXPERIENCE_ITEMS,
    )
    projectItems: List[ExperienceListItem] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EXPERIENCE_ITEMS,
    )
    educationItems: List[ExperienceListItem] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_EDUCATION_ITEMS,
    )
    certifications: List[CertificationRead] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_CERTIFICATION_ITEMS,
    )
    skills: List[UserSkillRead] = Field(
        default_factory=list,
        max_length=MAX_EXPORT_BANK_SKILL_ITEMS,
    )
    exportDateLabel: Optional[ExportShortText] = None

    @model_validator(mode="before")
    @classmethod
    def _validate_raw_nested_business_limits(cls, value):
        if isinstance(value, cls):
            return value
        _validate_nested_export_value(value)
        return value

    @model_validator(mode="after")
    def _validate_nested_business_limits(self):
        if self.profile is not None and (
            len(self.profile.links) > MAX_EXPORT_PROFILE_LINK_ITEMS
        ):
            raise ValueError("导出个人资料链接过多。")
        # Inspect the Python representation so non-finite values held by
        # ``Any`` fields are not normalized to ``None`` by JSON-mode dumping
        # before this boundary gets a chance to reject them.
        _validate_nested_export_value(self.model_dump(mode="python"))
        return self


class ExperienceBankPdfExportRequest(BaseModel):
    snapshot: ExperienceBankPdfRenderSnapshot
    fileName: Optional[ExportFileName] = None


class ExperienceBankRenderSnapshotRead(BaseModel):
    snapshot: ExperienceBankPdfRenderSnapshot
