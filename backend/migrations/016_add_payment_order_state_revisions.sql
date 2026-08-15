-- Keep an O(1) per-user payment revision so optimistic-concurrency checks do
-- not load or lock an account's complete payment-order history.

CREATE TABLE IF NOT EXISTS payment_order_state_revisions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL DEFAULT 0,
    latest_order_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION payment_order_advance_state_revision()
RETURNS TRIGGER AS $payment_order_state_revision$
DECLARE
    affected_user_id TEXT;
    affected_order_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_user_id := OLD.user_id;
        SELECT candidate.id
        INTO affected_order_id
        FROM payment_orders AS candidate
        WHERE candidate.user_id = affected_user_id
        ORDER BY candidate.updated_at DESC, candidate.id DESC
        LIMIT 1;

        UPDATE payment_order_state_revisions
        SET revision = revision + 1,
            latest_order_id = affected_order_id,
            updated_at = now()
        WHERE user_id = affected_user_id;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        UPDATE payment_order_state_revisions
        SET revision = revision + 1,
            latest_order_id = (
                SELECT candidate.id
                FROM payment_orders AS candidate
                WHERE candidate.user_id = OLD.user_id
                ORDER BY candidate.updated_at DESC, candidate.id DESC
                LIMIT 1
            ),
            updated_at = now()
        WHERE user_id = OLD.user_id;
    END IF;

    INSERT INTO payment_order_state_revisions (
        user_id,
        revision,
        latest_order_id,
        updated_at
    ) VALUES (
        NEW.user_id,
        1,
        NEW.id,
        now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET revision = payment_order_state_revisions.revision + 1,
        latest_order_id = EXCLUDED.latest_order_id,
        updated_at = EXCLUDED.updated_at;
    RETURN NEW;
END;
$payment_order_state_revision$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_order_advance_state_revision
    ON payment_orders;
CREATE TRIGGER trg_payment_order_advance_state_revision
    AFTER INSERT OR UPDATE OR DELETE ON payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION payment_order_advance_state_revision();

INSERT INTO payment_order_state_revisions (
    user_id,
    revision,
    latest_order_id,
    updated_at
)
SELECT DISTINCT ON (orders.user_id)
    orders.user_id,
    SUM(orders.state_version) OVER (PARTITION BY orders.user_id),
    orders.id,
    orders.updated_at
FROM payment_orders AS orders
WHERE NOT EXISTS (
    SELECT 1
    FROM payment_order_state_revisions AS existing_revision
    WHERE existing_revision.user_id = orders.user_id
)
ORDER BY orders.user_id, orders.updated_at DESC, orders.id DESC
ON CONFLICT (user_id) DO NOTHING;
