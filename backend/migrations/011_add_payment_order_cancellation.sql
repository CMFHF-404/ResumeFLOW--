-- Payment order cancellation and expiry lookup support.
-- Safe to run against both existing and newly initialized PostgreSQL databases.

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payment_orders_pending_expires
    ON payment_orders(expires_at)
    WHERE status = 'pending';
