from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from pydantic import BaseModel, Field


class TokenPurchaseOption(BaseModel):
    id: str
    label: str
    tokens: int
    price_label: str
    is_placeholder: bool = True
    description: str = ""


class TokenQuotaSummary(BaseModel):
    user_id: str
    token_limit: int
    remaining_tokens: int
    used_tokens: int
    remaining_percent: float
    is_unlimited: bool = False
    unlimited_expires_at: datetime | None = None
    unlimited_plan_name: str | None = None
    last_purchase_tokens: int = 0
    last_purchase_at: datetime | None = None
    updated_at: datetime | None = None


class TokenUsageEventRead(BaseModel):
    id: str
    entrypoint: str
    request_label: str
    provider: str
    model: str
    status: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class TokenUsageAggregate(BaseModel):
    key: str
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    count: int


class TokenUsageListResponse(BaseModel):
    events: List[TokenUsageEventRead]
    usage_by_day: List[TokenUsageAggregate]
    usage_by_entrypoint: List[TokenUsageAggregate]


class TokenPurchaseRequest(BaseModel):
    option_id: str


class TokenPurchaseEventRead(BaseModel):
    id: str
    option_id: str
    label: str
    tokens: int
    status: str
    before_remaining_tokens: int
    after_remaining_tokens: int
    before_token_limit: int
    after_token_limit: int
    created_at: datetime


class TokenPurchaseResponse(BaseModel):
    summary: TokenQuotaSummary
    purchase: TokenPurchaseEventRead
