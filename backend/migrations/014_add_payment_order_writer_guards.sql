-- Make the idempotency alias table authoritative for old and new writers, and
-- advance state_version when an older application updates payment state.

CREATE OR REPLACE FUNCTION payment_order_claim_original_idempotency_key()
RETURNS TRIGGER AS $payment_order_claim$
BEGIN
    INSERT INTO payment_order_idempotency_aliases (
        user_id,
        idempotency_key,
        payment_order_id,
        created_at
    ) VALUES (
        NEW.user_id,
        NEW.idempotency_key,
        NEW.id,
        NEW.created_at
    );
    RETURN NEW;
END;
$payment_order_claim$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_order_claim_original_idempotency_key
    ON payment_orders;

CREATE TRIGGER trg_payment_order_claim_original_idempotency_key
    AFTER INSERT ON payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION payment_order_claim_original_idempotency_key();

-- Re-run the backfill after the trigger has taken its table lock. Any old
-- writer that committed immediately before installation is therefore covered;
-- writers released afterward are protected by the trigger.
INSERT INTO payment_order_idempotency_aliases (
    user_id,
    idempotency_key,
    payment_order_id,
    created_at
)
SELECT user_id, idempotency_key, id, created_at
FROM payment_orders
ON CONFLICT (user_id, idempotency_key) DO NOTHING;

-- Provider cancellation and local expiry do not prove that a checkout can no
-- longer settle remotely. This durable per-user claim is the concurrency
-- primitive for old and new writers; unlike a trigger-local advisory lock it
-- cannot observe a stale statement snapshot after waiting.
CREATE TABLE IF NOT EXISTS payment_order_provider_open_claims (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_orders_one_provider_open_per_user PRIMARY KEY (user_id),
    CONSTRAINT uq_payment_order_provider_open_claims_order UNIQUE (payment_order_id)
);

CREATE OR REPLACE FUNCTION payment_order_enforce_provider_open_per_user()
RETURNS TRIGGER AS $payment_order_provider_open$
DECLARE
    needs_claim BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        needs_claim := NEW.status IN ('pending', 'paid', 'cancelled', 'expired');
    ELSE
        IF OLD.status IN ('pending', 'paid', 'cancelled', 'expired')
           AND (
               NEW.status NOT IN ('pending', 'paid', 'cancelled', 'expired')
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
           ) THEN
            DELETE FROM payment_order_provider_open_claims
            WHERE user_id = OLD.user_id
              AND payment_order_id = OLD.id;
        END IF;
        needs_claim := NEW.status IN ('pending', 'paid', 'cancelled', 'expired')
                       AND (
                           OLD.status NOT IN ('pending', 'paid', 'cancelled', 'expired')
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
              AND existing.status IN ('pending', 'paid', 'cancelled', 'expired')
        ) > 1 THEN
            RAISE EXCEPTION
                'payment_order_reconciliation_required: user % already has a provider-open order',
                NEW.user_id
                USING ERRCODE = '23505',
                      CONSTRAINT = 'payment_orders_one_provider_open_per_user';
        END IF;
    END IF;
    RETURN NEW;
END;
$payment_order_provider_open$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_order_enforce_provider_open_per_user
    ON payment_orders;

CREATE TRIGGER trg_payment_order_enforce_provider_open_per_user
    AFTER INSERT OR UPDATE OF user_id, status ON payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION payment_order_enforce_provider_open_per_user();

-- Clean historical users get a claim. Users with multiple provider-open rows
-- intentionally get none: normal reads return reconciliation_required and any
-- new insert/re-entry creates a provisional claim then fails the count check.
INSERT INTO payment_order_provider_open_claims (
    user_id, payment_order_id, created_at
)
SELECT candidate.user_id, candidate.id, candidate.created_at
FROM payment_orders AS candidate
WHERE candidate.status IN ('pending', 'paid', 'cancelled', 'expired')
  AND NOT EXISTS (
      SELECT 1
      FROM payment_orders AS other
      WHERE other.user_id = candidate.user_id
        AND other.status IN ('pending', 'paid', 'cancelled', 'expired')
        AND other.id <> candidate.id
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION payment_order_bump_state_version()
RETURNS TRIGGER AS $payment_order_version$
BEGIN
    IF ROW(
        NEW.status,
        NEW.provider_trade_no,
        NEW.failure_reason,
        NEW.paid_at,
        NEW.fulfilled_at,
        NEW.cancelled_at,
        NEW.expires_at
    ) IS DISTINCT FROM ROW(
        OLD.status,
        OLD.provider_trade_no,
        OLD.failure_reason,
        OLD.paid_at,
        OLD.fulfilled_at,
        OLD.cancelled_at,
        OLD.expires_at
    ) AND NEW.state_version = OLD.state_version THEN
        NEW.state_version := OLD.state_version + 1;
    END IF;
    RETURN NEW;
END;
$payment_order_version$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_order_bump_state_version
    ON payment_orders;

CREATE TRIGGER trg_payment_order_bump_state_version
    BEFORE UPDATE ON payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION payment_order_bump_state_version();
