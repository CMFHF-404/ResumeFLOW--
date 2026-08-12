from collections.abc import Awaitable, Callable
from typing import Any


ExecuteStatement = Callable[[Any], Awaitable[Any]]
TextFactory = Callable[[str], Any]


AI_TOKEN_BILLING_STATEMENTS = (
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    """
                CREATE TABLE IF NOT EXISTS ai_token_wallets (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    token_limit BIGINT NOT NULL DEFAULT 0,
                    remaining_tokens BIGINT NOT NULL DEFAULT 0,
                    used_tokens BIGINT NOT NULL DEFAULT 0,
                    unlimited_tokens_expires_at TIMESTAMPTZ,
                    unlimited_tokens_plan_name TEXT,
                    last_purchase_id UUID,
                    last_purchase_tokens BIGINT NOT NULL DEFAULT 0,
                    last_purchase_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE ai_token_wallets
                ADD COLUMN IF NOT EXISTS unlimited_tokens_expires_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS unlimited_tokens_plan_name TEXT
                """,
    """
                ALTER TABLE ai_token_wallets
                ALTER COLUMN token_limit TYPE BIGINT,
                ALTER COLUMN remaining_tokens TYPE BIGINT,
                ALTER COLUMN used_tokens TYPE BIGINT,
                ALTER COLUMN last_purchase_tokens TYPE BIGINT
                """,
    """
                CREATE TABLE IF NOT EXISTS ai_token_usage_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    entrypoint TEXT NOT NULL DEFAULT 'unknown',
                    request_label TEXT NOT NULL DEFAULT 'ai_request',
                    provider TEXT NOT NULL DEFAULT 'unknown',
                    model TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'success',
                    prompt_tokens BIGINT NOT NULL DEFAULT 0,
                    completion_tokens BIGINT NOT NULL DEFAULT 0,
                    total_tokens BIGINT NOT NULL DEFAULT 0,
                    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE ai_token_usage_events
                ALTER COLUMN prompt_tokens TYPE BIGINT,
                ALTER COLUMN completion_tokens TYPE BIGINT,
                ALTER COLUMN total_tokens TYPE BIGINT
                """,
    """
                CREATE TABLE IF NOT EXISTS ai_token_purchase_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    option_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    tokens BIGINT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'placeholder_succeeded',
                    before_remaining_tokens BIGINT NOT NULL DEFAULT 0,
                    after_remaining_tokens BIGINT NOT NULL DEFAULT 0,
                    before_token_limit BIGINT NOT NULL DEFAULT 0,
                    after_token_limit BIGINT NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE ai_token_purchase_events
                ALTER COLUMN tokens TYPE BIGINT,
                ALTER COLUMN before_remaining_tokens TYPE BIGINT,
                ALTER COLUMN after_remaining_tokens TYPE BIGINT,
                ALTER COLUMN before_token_limit TYPE BIGINT,
                ALTER COLUMN after_token_limit TYPE BIGINT
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_user_created
                ON ai_token_usage_events(user_id, created_at DESC)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_entrypoint
                ON ai_token_usage_events(entrypoint)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_user_created
                ON ai_token_purchase_events(user_id, created_at DESC)
                """,
    """
                ALTER TABLE ai_token_purchase_events
                ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'placeholder_purchase',
                ADD COLUMN IF NOT EXISTS source_id TEXT,
                ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_source
                ON ai_token_purchase_events(source, source_id)
                """,
    """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_token_purchase_events_source_id
                ON ai_token_purchase_events(source, source_id)
                WHERE source_id IS NOT NULL
                """,
    """
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
                    state_version BIGINT NOT NULL DEFAULT 1,
                    provider_trade_no TEXT UNIQUE,
                    failure_reason TEXT,
                    paid_at TIMESTAMPTZ,
                    fulfilled_at TIMESTAMPTZ,
                    cancelled_at TIMESTAMPTZ,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uq_payment_orders_user_idempotency UNIQUE (user_id, idempotency_key)
                )
                """,
    """
                ALTER TABLE payment_orders
                ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1
                """,
    """
                CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    idempotency_key TEXT NOT NULL,
                    payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (user_id, idempotency_key)
                )
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_payment_order_idempotency_aliases_order
                ON payment_order_idempotency_aliases(payment_order_id)
                """,
    """
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
                $payment_order_claim$ LANGUAGE plpgsql
                """,
    """
                DROP TRIGGER IF EXISTS trg_payment_order_claim_original_idempotency_key
                ON payment_orders
                """,
    """
                CREATE TRIGGER trg_payment_order_claim_original_idempotency_key
                AFTER INSERT ON payment_orders
                FOR EACH ROW
                EXECUTE FUNCTION payment_order_claim_original_idempotency_key()
                """,
    """
                INSERT INTO payment_order_idempotency_aliases (
                    user_id,
                    idempotency_key,
                    payment_order_id,
                    created_at
                )
                SELECT user_id, idempotency_key, id, created_at
                FROM payment_orders
                ON CONFLICT (user_id, idempotency_key) DO NOTHING
                """,
    """
                CREATE TABLE IF NOT EXISTS payment_order_provider_open_claims (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT payment_orders_one_provider_open_per_user PRIMARY KEY (user_id),
                    CONSTRAINT uq_payment_order_provider_open_claims_order UNIQUE (payment_order_id)
                )
                """,
    """
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
                $payment_order_provider_open$ LANGUAGE plpgsql
                """,
    """
                DROP TRIGGER IF EXISTS trg_payment_order_enforce_provider_open_per_user
                ON payment_orders
                """,
    """
                CREATE TRIGGER trg_payment_order_enforce_provider_open_per_user
                AFTER INSERT OR UPDATE OF user_id, status ON payment_orders
                FOR EACH ROW
                EXECUTE FUNCTION payment_order_enforce_provider_open_per_user()
                """,
    """
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
                ON CONFLICT DO NOTHING
                """,
    """
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
                $payment_order_version$ LANGUAGE plpgsql
                """,
    """
                DROP TRIGGER IF EXISTS trg_payment_order_bump_state_version
                ON payment_orders
                """,
    """
                CREATE TRIGGER trg_payment_order_bump_state_version
                BEFORE UPDATE ON payment_orders
                FOR EACH ROW
                EXECUTE FUNCTION payment_order_bump_state_version()
                """,
    """
                CREATE TABLE IF NOT EXISTS payment_webhook_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    provider TEXT NOT NULL DEFAULT 'yifut',
                    event_key TEXT NOT NULL UNIQUE,
                    merchant_order_no TEXT,
                    provider_trade_no TEXT,
                    signature_valid BOOLEAN NOT NULL DEFAULT false,
                    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    processing_error TEXT,
                    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    processed_at TIMESTAMPTZ
                )
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
                ON payment_orders(user_id, created_at DESC)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_payment_orders_status
                ON payment_orders(status)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_payment_orders_pending_expires
                ON payment_orders(expires_at)
                WHERE status = 'pending'
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order
                ON payment_webhook_events(merchant_order_no)
                """,
    """
                CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    entrypoint TEXT NOT NULL,
                    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    expires_at TIMESTAMPTZ NOT NULL,
                    released_at TIMESTAMPTZ
                )
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_user_recent
                ON ai_unlimited_request_leases(user_id, acquired_at DESC)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_active
                ON ai_unlimited_request_leases(user_id, expires_at)
                WHERE released_at IS NULL
                """,
    """
                CREATE TABLE IF NOT EXISTS ai_unlimited_usage_alerts (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    usage_day DATE NOT NULL,
                    threshold_tokens BIGINT NOT NULL DEFAULT 2000000,
                    observed_tokens BIGINT NOT NULL,
                    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    notified_at TIMESTAMPTZ,
                    delivery_error TEXT,
                    PRIMARY KEY (user_id, usage_day, threshold_tokens)
                )
                """,
)


REDEMPTION_CODE_STATEMENTS = (
    'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
    """
                CREATE TABLE IF NOT EXISTS redemption_packages (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name TEXT NOT NULL,
                    token_amount INTEGER NOT NULL DEFAULT 0,
                    benefit_type TEXT NOT NULL DEFAULT 'tokens',
                    unlimited_duration_days INTEGER,
                    unlimited_duration_hours INTEGER,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE redemption_packages
                ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
                ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
                ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER
                """,
    """
                CREATE TABLE IF NOT EXISTS redemption_batches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
                    name TEXT NOT NULL,
                    channel TEXT NOT NULL DEFAULT '',
                    package_name TEXT NOT NULL,
                    token_amount INTEGER NOT NULL DEFAULT 0,
                    benefit_type TEXT NOT NULL DEFAULT 'tokens',
                    unlimited_duration_days INTEGER,
                    unlimited_duration_hours INTEGER,
                    code_count INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_by_user_id TEXT NOT NULL,
                    exported_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE redemption_batches
                ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
                ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
                ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER
                """,
    """
                CREATE TABLE IF NOT EXISTS redemption_codes (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    batch_id UUID REFERENCES redemption_batches(id) ON DELETE SET NULL,
                    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
                    code_hash TEXT NOT NULL UNIQUE,
                    code_ciphertext TEXT NOT NULL,
                    code_prefix TEXT NOT NULL DEFAULT '',
                    token_amount INTEGER NOT NULL DEFAULT 0,
                    package_name TEXT NOT NULL,
                    benefit_type TEXT NOT NULL DEFAULT 'tokens',
                    unlimited_duration_days INTEGER,
                    unlimited_duration_hours INTEGER,
                    status TEXT NOT NULL DEFAULT 'unused',
                    redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                    redeemed_at TIMESTAMPTZ,
                    revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                    revoked_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """,
    """
                ALTER TABLE redemption_codes
                ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
                ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
                ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_redemption_batches_package_id
                ON redemption_batches(package_id)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_redemption_codes_batch_id
                ON redemption_codes(batch_id)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_redemption_codes_package_id
                ON redemption_codes(package_id)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_redemption_codes_status
                ON redemption_codes(status)
                """,
    """
                CREATE INDEX IF NOT EXISTS idx_redemption_codes_code_prefix
                ON redemption_codes(code_prefix)
                """,
)


async def execute_ai_token_billing_statements(
    *,
    execute: ExecuteStatement,
    text: TextFactory,
) -> None:
    for statement in AI_TOKEN_BILLING_STATEMENTS:
        await execute(text(statement))


async def execute_redemption_code_statements(
    *,
    execute: ExecuteStatement,
    text: TextFactory,
) -> None:
    for statement in REDEMPTION_CODE_STATEMENTS:
        await execute(text(statement))
