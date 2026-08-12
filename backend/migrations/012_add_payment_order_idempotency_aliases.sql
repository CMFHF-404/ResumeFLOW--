-- Preserve every accepted payment-order idempotency key, including keys that
-- intentionally reuse an older provider order which cannot be closed locally.
CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);

INSERT INTO payment_order_idempotency_aliases (
    user_id,
    idempotency_key,
    payment_order_id,
    created_at
)
SELECT user_id, idempotency_key, id, created_at
FROM payment_orders
ON CONFLICT (user_id, idempotency_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_payment_order_idempotency_aliases_order
    ON payment_order_idempotency_aliases(payment_order_id);
