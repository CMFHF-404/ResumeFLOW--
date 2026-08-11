CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entrypoint TEXT NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_user_recent
    ON ai_unlimited_request_leases(user_id, acquired_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_active
    ON ai_unlimited_request_leases(user_id, expires_at)
    WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_unlimited_usage_alerts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_day DATE NOT NULL,
    threshold_tokens BIGINT NOT NULL DEFAULT 2000000,
    observed_tokens BIGINT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notified_at TIMESTAMPTZ,
    delivery_error TEXT,
    PRIMARY KEY (user_id, usage_day, threshold_tokens)
);
