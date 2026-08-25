from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from ..ai.runtime_budget import validate_ai_text_field
from .assistant_storage import (
    MAX_ASSISTANT_SESSION_TITLE_CHARS,
    validate_session_context,
)


AssistantMode = Literal["general", "experience", "certification", "skill"]
AssistantSkillId = Literal["star_guidance", "experience_completion", "mock_interview"]
AssistantEntrySource = Literal["direct", "experience_bank", "resume_editor"]
AssistantMessageRole = Literal["user", "assistant"]
AssistantMessageType = Literal["user_text", "assistant_text", "draft_card"]
AssistantDraftCardType = Literal["experience", "certification", "skill_group"]
AssistantApplyTargetView = Literal["experience_bank", "resume_editor"]


class AssistantSessionCreate(BaseModel):
    mode: AssistantMode = "general"
    title: Optional[str] = Field(
        default=None,
        max_length=MAX_ASSISTANT_SESSION_TITLE_CHARS,
    )
    entry_source: AssistantEntrySource = "direct"
    context_json: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("context_json", mode="before")
    @classmethod
    def _validate_context_json(cls, value):
        return validate_session_context(value)


class AssistantSessionUpdate(BaseModel):
    title: Optional[str] = Field(
        default=None,
        max_length=MAX_ASSISTANT_SESSION_TITLE_CHARS,
    )


class AssistantSessionRead(BaseModel):
    id: str
    user_id: str
    title: str
    mode: AssistantMode
    entry_source: str
    context_json: Dict[str, Any]
    latest_preview: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AssistantMessageRead(BaseModel):
    id: str
    role: AssistantMessageRole
    message_type: AssistantMessageType
    content_json: Dict[str, Any]
    created_at: datetime


class AssistantSessionDetail(BaseModel):
    session: AssistantSessionRead
    messages: List[AssistantMessageRead]
    truncated: bool = False
    next_cursor: Optional[str] = None
    storage_projection_truncated: bool = False


class AssistantSessionStreamRequest(BaseModel):
    user_message: str = ""
    display_message: Optional[str] = None
    mode: Optional[AssistantMode] = None
    skill_id: Optional[AssistantSkillId] = None
    enable_thinking: bool = False
    selected_experiences: List[Dict[str, Any]] = Field(default_factory=list)
    selected_resume: Optional[Dict[str, Any]] = None

    @field_validator("user_message", "display_message")
    @classmethod
    def _validate_primary_text(cls, value, info):
        return validate_ai_text_field(value, info.field_name)


class AssistantDraftApplyNavigation(BaseModel):
    targetView: AssistantApplyTargetView
    targetId: Optional[str] = None
    resumeId: Optional[str] = None
    category: Optional[str] = None


class AssistantMessageApplyRead(BaseModel):
    message: AssistantMessageRead
    navigation: Optional[AssistantDraftApplyNavigation] = None
