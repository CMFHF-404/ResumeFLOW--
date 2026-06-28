ALTER TABLE ai_token_wallets
    ADD COLUMN IF NOT EXISTS unlimited_tokens_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unlimited_tokens_plan_name TEXT;

ALTER TABLE redemption_packages
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER;

ALTER TABLE redemption_batches
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER;

ALTER TABLE redemption_codes
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER;
