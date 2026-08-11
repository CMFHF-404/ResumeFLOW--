from __future__ import annotations

from datetime import datetime
from typing import Dict, Literal

from pydantic import BaseModel, Field

from .schemas import TokenQuotaSummary


class PaymentProductRead(BaseModel):
    sku: str
    name: str
    category: Literal["tokens", "unlimited"]
    amount_fen: int
    currency: str
    token_amount: int | None = None
    unlimited_duration_days: int | None = None
    description: str


class PaymentProductsResponse(BaseModel):
    payments_enabled: bool
    products: list[PaymentProductRead]


class PaymentOrderCreate(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)


class PaymentOrderRead(BaseModel):
    id: str
    status: Literal["pending", "paid", "fulfilled", "expired", "failed"]
    sku: str
    product_name: str
    amount_fen: int
    currency: str
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None
    fulfilled_at: datetime | None = None
    provider_trade_no: str | None = None
    summary: TokenQuotaSummary | None = None


class PaymentCheckoutResponse(BaseModel):
    order: PaymentOrderRead
    action: str
    method: Literal["POST"] = "POST"
    fields: Dict[str, str]

