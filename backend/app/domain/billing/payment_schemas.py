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
    catalog_version: str
    products: list[PaymentProductRead]


class PaymentOrderCreate(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    # Omission is accepted only so a legacy client can replay an already-bound
    # idempotency key. New keys are rejected by the service without a token.
    expected_payment_state_token: str | None = Field(
        default=None,
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
    )
    expected_catalog_version: str | None = Field(
        default=None,
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
    )


class PaymentOrderRead(BaseModel):
    id: str
    status: Literal["pending", "paid", "fulfilled", "expired", "cancelled", "failed"]
    state_version: int
    sku: str
    product_name: str
    amount_fen: int
    currency: str
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None
    fulfilled_at: datetime | None = None
    cancelled_at: datetime | None = None
    provider_trade_no: str | None = None
    summary: TokenQuotaSummary | None = None


class PaymentOrderListItem(BaseModel):
    id: str
    status: Literal["pending", "paid", "fulfilled", "expired", "cancelled", "failed"]
    state_version: int
    sku: str
    product_name: str
    amount_fen: int
    currency: str
    benefit_type: Literal["tokens", "unlimited_time"]
    token_amount: int
    unlimited_duration_days: int | None = None
    description: str
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None
    fulfilled_at: datetime | None = None
    cancelled_at: datetime | None = None


class PaymentOrdersResponse(BaseModel):
    items: list[PaymentOrderListItem]
    next_cursor: str | None = None
    has_more: bool


class PaymentPurchaseContextResponse(BaseModel):
    payment_state_token: str
    latest_order: PaymentOrderListItem | None = None


class PaymentCheckoutResponse(BaseModel):
    order: PaymentOrderRead
    action: str
    method: Literal["POST"] = "POST"
    fields: Dict[str, str]
