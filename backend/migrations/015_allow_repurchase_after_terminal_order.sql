-- Treat locally cancelled and expired orders as replaceable purchase attempts.
-- Their merchant numbers remain valid for independently verified late callbacks,
-- while only pending/paid orders hold the per-user active-payment claim.

CREATE OR REPLACE FUNCTION payment_order_enforce_provider_open_per_user()
RETURNS TRIGGER AS $payment_order_provider_open$
DECLARE
    needs_claim BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        needs_claim := NEW.status IN ('pending', 'paid');
    ELSE
        IF OLD.status IN ('pending', 'paid')
           AND (
               NEW.status NOT IN ('pending', 'paid')
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
           ) THEN
            DELETE FROM payment_order_provider_open_claims
            WHERE user_id = OLD.user_id
              AND payment_order_id = OLD.id;
        END IF;
        needs_claim := NEW.status IN ('pending', 'paid')
                       AND (
                           OLD.status NOT IN ('pending', 'paid')
                           OR NEW.user_id IS DISTINCT FROM OLD.user_id
                       );
    END IF;

    IF needs_claim THEN
        INSERT INTO payment_order_provider_open_claims (
            user_id, payment_order_id, created_at
        ) VALUES (NEW.user_id, NEW.id, now());
        IF (
            SELECT count(*)
            FROM payment_orders AS existing
            WHERE existing.user_id = NEW.user_id
              AND existing.status IN ('pending', 'paid')
        ) > 1 THEN
            RAISE EXCEPTION
                'payment_order_reconciliation_required: user % already has an active payment order',
                NEW.user_id
                USING ERRCODE = '23505',
                      CONSTRAINT = 'payment_orders_one_provider_open_per_user';
        END IF;
    END IF;
    RETURN NEW;
END;
$payment_order_provider_open$ LANGUAGE plpgsql;

DELETE FROM payment_order_provider_open_claims AS claim
USING payment_orders AS existing
WHERE claim.payment_order_id = existing.id
  AND existing.status NOT IN ('pending', 'paid');

INSERT INTO payment_order_provider_open_claims (
    user_id, payment_order_id, created_at
)
SELECT candidate.user_id, candidate.id, candidate.created_at
FROM payment_orders AS candidate
WHERE candidate.status IN ('pending', 'paid')
  AND NOT EXISTS (
      SELECT 1
      FROM payment_orders AS other
      WHERE other.user_id = candidate.user_id
        AND other.status IN ('pending', 'paid')
        AND other.id <> candidate.id
  )
ON CONFLICT DO NOTHING;
