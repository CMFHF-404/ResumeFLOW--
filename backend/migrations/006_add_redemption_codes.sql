CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE ai_token_purchase_events
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'placeholder_purchase',
    ADD COLUMN IF NOT EXISTS source_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_source
    ON ai_token_purchase_events(source, source_id);

CREATE TABLE IF NOT EXISTS redemption_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token_amount INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    package_name TEXT NOT NULL,
    token_amount INTEGER NOT NULL,
    code_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by_user_id TEXT NOT NULL,
    exported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES redemption_batches(id) ON DELETE SET NULL,
    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
    code_hash TEXT NOT NULL UNIQUE,
    code_ciphertext TEXT NOT NULL,
    code_prefix TEXT NOT NULL DEFAULT '',
    token_amount INTEGER NOT NULL,
    package_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused',
    redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at TIMESTAMPTZ,
    revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redemption_batches_package_id
    ON redemption_batches(package_id);

CREATE INDEX IF NOT EXISTS idx_redemption_codes_batch_id
    ON redemption_codes(batch_id);

CREATE INDEX IF NOT EXISTS idx_redemption_codes_package_id
    ON redemption_codes(package_id);

CREATE INDEX IF NOT EXISTS idx_redemption_codes_status
    ON redemption_codes(status);

CREATE INDEX IF NOT EXISTS idx_redemption_codes_code_prefix
    ON redemption_codes(code_prefix);
