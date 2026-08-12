-- Expose monotonic per-order revisions used by the all-order payment-state token.
ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1;
