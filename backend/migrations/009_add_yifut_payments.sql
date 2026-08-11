CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE ai_token_wallets
    ALTER COLUMN token_limit TYPE BIGINT,
    ALTER COLUMN remaining_tokens TYPE BIGINT,
    ALTER COLUMN used_tokens TYPE BIGINT,
    ALTER COLUMN last_purchase_tokens TYPE BIGINT;

ALTER TABLE ai_token_usage_events
    ALTER COLUMN prompt_tokens TYPE BIGINT,
    ALTER COLUMN completion_tokens TYPE BIGINT,
    ALTER COLUMN total_tokens TYPE BIGINT;

ALTER TABLE ai_token_purchase_events
    ALTER COLUMN tokens TYPE BIGINT,
    ALTER COLUMN before_remaining_tokens TYPE BIGINT,
    ALTER COLUMN after_remaining_tokens TYPE BIGINT,
    ALTER COLUMN before_token_limit TYPE BIGINT,
    ALTER COLUMN after_token_limit TYPE BIGINT;

ALTER TABLE ai_token_purchase_events
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'placeholder_purchase',
    ADD COLUMN IF NOT EXISTS source_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_token_purchase_events_source_id
    ON ai_token_purchase_events(source, source_id)
    WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'yifut',
    merchant_order_no TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount_fen BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    benefit_type TEXT NOT NULL,
    token_amount BIGINT NOT NULL DEFAULT 0,
    unlimited_duration_days INTEGER,
    entitlement_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_trade_no TEXT UNIQUE,
    failure_reason TEXT,
    paid_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment_orders_user_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'yifut',
    event_key TEXT NOT NULL UNIQUE,
    merchant_order_no TEXT,
    provider_trade_no TEXT,
    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
    ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order
    ON payment_webhook_events(merchant_order_no);
