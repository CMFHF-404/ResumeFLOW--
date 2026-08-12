from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ProductCategory = Literal["tokens", "unlimited"]


@dataclass(frozen=True)
class PaymentProduct:
    sku: str
    name: str
    category: ProductCategory
    amount_fen: int
    currency: str = "CNY"
    token_amount: int | None = None
    unlimited_duration_days: int | None = None
    description: str = ""

    @property
    def benefit_type(self) -> str:
        return "tokens" if self.category == "tokens" else "unlimited_time"


TEST_PRODUCT = PaymentProduct(
    sku="tokens_test_10k",
    name="10K Token 测试包",
    category="tokens",
    amount_fen=10,
    token_amount=10_000,
    description="10,000 Token，仅用于真实支付链路测试",
)


PRODUCTS: tuple[PaymentProduct, ...] = (
    PaymentProduct(
        sku="tokens_500k",
        name="500K Token 包",
        category="tokens",
        amount_fen=990,
        token_amount=500_000,
        description="500,000 Token，永久有效",
    ),
    PaymentProduct(
        sku="tokens_1m",
        name="1M Token 包",
        category="tokens",
        amount_fen=1_890,
        token_amount=1_000_000,
        description="1,000,000 Token，永久有效",
    ),
    PaymentProduct(
        sku="unlimited_month",
        name="单月不限量",
        category="unlimited",
        amount_fen=2_980,
        unlimited_duration_days=30,
        description="30 天不限量，不自动续费",
    ),
    PaymentProduct(
        sku="unlimited_quarter",
        name="单季度不限量",
        category="unlimited",
        amount_fen=7_980,
        unlimited_duration_days=90,
        description="90 天不限量，不自动续费",
    ),
    PaymentProduct(
        sku="unlimited_year",
        name="年度不限量",
        category="unlimited",
        amount_fen=22_980,
        unlimited_duration_days=365,
        description="365 天不限量，不自动续费",
    ),
)

PRODUCTS_BY_SKU = {product.sku: product for product in PRODUCTS}


def get_products(*, include_test_product: bool = False) -> tuple[PaymentProduct, ...]:
    if include_test_product:
        return (TEST_PRODUCT, *PRODUCTS)
    return PRODUCTS


def get_product(sku: str, *, include_test_product: bool = False) -> PaymentProduct | None:
    normalized_sku = (sku or "").strip()
    if include_test_product and normalized_sku == TEST_PRODUCT.sku:
        return TEST_PRODUCT
    return PRODUCTS_BY_SKU.get(normalized_sku)
