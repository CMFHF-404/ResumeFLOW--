from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .schemas import TokenQuotaSummary


class RedemptionPackageCreate(BaseModel):
    name: str = Field(..., min_length=1)
    token_amount: int = 0
    benefit_type: Literal["tokens", "unlimited_time"] = "tokens"
    unlimited_duration_days: Optional[int] = None
    unlimited_duration_hours: Optional[int] = None
    is_active: bool = True
    notes: str = ""


class RedemptionPackageUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    token_amount: Optional[int] = None
    benefit_type: Optional[Literal["tokens", "unlimited_time"]] = None
    unlimited_duration_days: Optional[int] = None
    unlimited_duration_hours: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class RedemptionPackageRead(BaseModel):
    id: str
    name: str
    token_amount: int
    benefit_type: str
    unlimited_duration_days: int | None = None
    unlimited_duration_hours: int | None = None
    is_active: bool
    notes: str
    created_at: datetime
    updated_at: datetime


class RedemptionBatchCreate(BaseModel):
    package_id: str
    name: str = Field(..., min_length=1)
    channel: str = ""
    count: int = Field(..., ge=1, le=5000)


class RedemptionBatchRead(BaseModel):
    id: str
    package_id: str | None
    name: str
    channel: str
    package_name: str
    token_amount: int
    benefit_type: str
    unlimited_duration_days: int | None = None
    unlimited_duration_hours: int | None = None
    code_count: int
    status: str
    created_by_user_id: str
    exported_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RedemptionBatchCreateResponse(BaseModel):
    batch: RedemptionBatchRead
    codes: List[str]


class RedemptionCodeRead(BaseModel):
    id: str
    batch_id: str | None = None
    package_id: str | None = None
    code_prefix: str
    token_amount: int
    package_name: str
    benefit_type: str
    unlimited_duration_days: int | None = None
    unlimited_duration_hours: int | None = None
    status: str
    redeemed_by_user_id: str | None = None
    redeemed_at: datetime | None = None
    revoked_by_user_id: str | None = None
    revoked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RedemptionRedeemRequest(BaseModel):
    code: str = Field(..., min_length=1)


class RedemptionRedeemResponse(BaseModel):
    tokens: int
    package_name: str
    summary: TokenQuotaSummary


class RedemptionRevokeResponse(BaseModel):
    code: RedemptionCodeRead


class RedemptionBatchRevokeResponse(BaseModel):
    batch: RedemptionBatchRead
    revoked_count: int
