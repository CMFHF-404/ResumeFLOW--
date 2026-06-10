from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from ...models import ExperienceCategory

ExperienceDraftMode = Literal["simple", "expert"]


class ExperienceDraftUpsert(BaseModel):
    category: ExperienceCategory
    client_draft_key: str = Field(min_length=1, max_length=128)
    mode: ExperienceDraftMode = "simple"
    simple_text: str = ""
    card_data: Dict[str, Any] = Field(default_factory=dict)
    target_master_id: Optional[str] = None

    @field_validator("category")
    @classmethod
    def _work_project_only(cls, value: ExperienceCategory) -> ExperienceCategory:
        if value not in {ExperienceCategory.WORK, ExperienceCategory.PROJECT}:
            raise ValueError("Experience drafts only support work and project categories")
        return value

    @field_validator("client_draft_key")
    @classmethod
    def _non_blank_client_draft_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("client_draft_key cannot be blank")
        return normalized


class ExperienceDraftRead(BaseModel):
    id: str
    category: ExperienceCategory
    client_draft_key: str
    mode: ExperienceDraftMode
    simple_text: str
    card_data: Dict[str, Any]
    target_master_id: Optional[str] = None
    updated_at: datetime
