CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_category') THEN
        CREATE TYPE experience_category AS ENUM ('work', 'project', 'education');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_admin
    ON users (is_admin)
    WHERE is_admin = TRUE;

CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT,
    title TEXT,
    summary TEXT,
    location TEXT,
    phone TEXT,
    email TEXT,
    social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
    extra_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS profile_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    target_role TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE resumes
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS master_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category experience_category NOT NULL,
    latest_version_id UUID,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experience_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_experience_id UUID NOT NULL REFERENCES master_experiences(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    org TEXT,
    location TEXT,
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    summary TEXT,
    highlights TEXT[] NOT NULL DEFAULT '{}'::text[],
    star JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'master_experiences_latest_version_fk'
    ) THEN
        ALTER TABLE master_experiences
            ADD CONSTRAINT master_experiences_latest_version_fk
            FOREIGN KEY (latest_version_id)
            REFERENCES experience_versions(id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS resume_experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    experience_version_id UUID NOT NULL REFERENCES experience_versions(id) ON DELETE RESTRICT,
    display_order INTEGER NOT NULL DEFAULT 0,
    overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'position'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'display_order'
    ) THEN
        ALTER TABLE resume_experiences RENAME COLUMN position TO display_order;
    END IF;
END $$;

ALTER TABLE resume_experiences
    ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'resume_experiences'
          AND column_name = 'section'
    ) THEN
        ALTER TABLE resume_experiences DROP COLUMN section;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT
);

CREATE TABLE IF NOT EXISTS user_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    proficiency INTEGER
);

CREATE TABLE IF NOT EXISTS experience_version_skills (
    experience_version_id UUID NOT NULL REFERENCES experience_versions(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (experience_version_id, skill_id)
);

CREATE TABLE IF NOT EXISTS experience_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category experience_category NOT NULL,
    client_draft_key TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'simple',
    simple_text TEXT NOT NULL DEFAULT '',
    card_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    target_master_id UUID REFERENCES master_experiences(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_experience_drafts_user_category_key UNIQUE (user_id, category, client_draft_key)
);

CREATE TABLE IF NOT EXISTS resume_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    skill_name_snapshot TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    issuer TEXT,
    issue_date DATE,
    expiry_date DATE,
    credential_id TEXT,
    credential_url TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    contact_type TEXT,
    contact TEXT,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    image_base64_list TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_plaintext TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_plugin_configs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_template_id TEXT NOT NULL DEFAULT 'modern-slate',
    polish_before_output BOOLEAN NOT NULL DEFAULT true,
    polish_level TEXT NOT NULL DEFAULT '标准',
    force_one_page BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
);

ALTER TABLE ai_token_wallets
    ADD COLUMN IF NOT EXISTS unlimited_tokens_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS unlimited_tokens_plan_name TEXT;

ALTER TABLE ai_token_wallets
    ALTER COLUMN token_limit TYPE BIGINT,
    ALTER COLUMN remaining_tokens TYPE BIGINT,
    ALTER COLUMN used_tokens TYPE BIGINT,
    ALTER COLUMN last_purchase_tokens TYPE BIGINT;

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
);

ALTER TABLE ai_token_usage_events
    ALTER COLUMN prompt_tokens TYPE BIGINT,
    ALTER COLUMN completion_tokens TYPE BIGINT,
    ALTER COLUMN total_tokens TYPE BIGINT;

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
    source TEXT NOT NULL DEFAULT 'placeholder_purchase',
    source_id TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_token_purchase_events
    ALTER COLUMN tokens TYPE BIGINT,
    ALTER COLUMN before_remaining_tokens TYPE BIGINT,
    ALTER COLUMN after_remaining_tokens TYPE BIGINT,
    ALTER COLUMN before_token_limit TYPE BIGINT,
    ALTER COLUMN after_token_limit TYPE BIGINT;

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
);

-- CREATE TABLE IF NOT EXISTS does not retrofit columns onto an existing table.
-- Keep this bootstrap path aligned with migrations 011 and 013.
ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS payment_order_idempotency_aliases (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    payment_order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idempotency_key)
);

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

INSERT INTO payment_order_idempotency_aliases (
    user_id,
    idempotency_key,
    payment_order_id,
    created_at
)
SELECT user_id, idempotency_key, id, created_at
FROM payment_orders
ON CONFLICT (user_id, idempotency_key) DO NOTHING;

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
        user_id, revision, latest_order_id, updated_at
    ) VALUES (NEW.user_id, 1, NEW.id, now())
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
    user_id, revision, latest_order_id, updated_at
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

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'yifut',
    event_key TEXT NOT NULL UNIQUE,
    merchant_order_no TEXT,
    provider_trade_no TEXT,
    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_unlimited_request_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entrypoint TEXT NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ
);

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
);

ALTER TABLE redemption_packages
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;

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
);

ALTER TABLE redemption_batches
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;

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
);

ALTER TABLE redemption_codes
    ADD COLUMN IF NOT EXISTS benefit_type TEXT NOT NULL DEFAULT 'tokens',
    ADD COLUMN IF NOT EXISTS unlimited_duration_days INTEGER,
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;

CREATE TABLE IF NOT EXISTS export_render_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_assistant_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    entry_source TEXT NOT NULL DEFAULT 'direct',
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    latest_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_assistant_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    message_type TEXT NOT NULL,
    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_assistant_image_blobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES ai_assistant_sessions(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL DEFAULT '',
    payload_base64 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_master_experiences_user_id ON master_experiences(user_id);
CREATE INDEX IF NOT EXISTS idx_experience_versions_master_id ON experience_versions(master_experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_drafts_user_category ON experience_drafts(user_id, category);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_user_created ON ai_token_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_entrypoint ON ai_token_usage_events(entrypoint);
CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_user_created ON ai_token_purchase_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_source ON ai_token_purchase_events(source, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_token_purchase_events_source_id ON ai_token_purchase_events(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_pending_expires
    ON payment_orders(expires_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payment_order_idempotency_aliases_order
    ON payment_order_idempotency_aliases(payment_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order ON payment_webhook_events(merchant_order_no);
CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_user_recent ON ai_unlimited_request_leases(user_id, acquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_unlimited_request_leases_active ON ai_unlimited_request_leases(user_id, expires_at) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_redemption_batches_package_id ON redemption_batches(package_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_batch_id ON redemption_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_package_id ON redemption_codes(package_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_status ON redemption_codes(status);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_code_prefix ON redemption_codes(code_prefix);
CREATE INDEX IF NOT EXISTS idx_resume_experiences_resume_id ON resume_experiences(resume_id);
CREATE INDEX IF NOT EXISTS idx_certifications_user_id ON certifications(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_user_id ON agent_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_key_prefix ON agent_api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_user_id ON export_render_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_expires_at ON export_render_snapshots(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_sessions_user_id ON ai_assistant_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_sessions_updated_at ON ai_assistant_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_session_id ON ai_assistant_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_image_blobs_session_id ON ai_assistant_image_blobs(session_id, created_at);
