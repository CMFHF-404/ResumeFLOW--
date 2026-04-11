from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


AssistantMode = Literal["general", "experience", "certification", "skill"]
AssistantEntrySource = Literal["direct", "experience_bank", "resume_editor"]
AssistantMessageRole = Literal["user", "assistant"]
AssistantMessageType = Literal["user_text", "assistant_text", "draft_card"]
AssistantDraftCardType = Literal["experience", "certification", "skill_group"]


class AssistantSessionCreate(BaseModel):
    mode: AssistantMode = "general"
    title: Optional[str] = None
    entry_source: AssistantEntrySource = "direct"
    context_json: Dict[str, Any] = Field(default_factory=dict)


class AssistantSessionUpdate(BaseModel):
    title: Optional[str] = None


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


class AssistantSessionStreamRequest(BaseModel):
    user_message: str = ""
    display_message: Optional[str] = None
    mode: Optional[AssistantMode] = None


class AssistantMessageApplyRead(BaseModel):
    message: AssistantMessageRead
