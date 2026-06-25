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
    token_limit INTEGER NOT NULL DEFAULT 0,
    remaining_tokens INTEGER NOT NULL DEFAULT 0,
    used_tokens INTEGER NOT NULL DEFAULT 0,
    last_purchase_id UUID,
    last_purchase_tokens INTEGER NOT NULL DEFAULT 0,
    last_purchase_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_token_usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entrypoint TEXT NOT NULL DEFAULT 'unknown',
    request_label TEXT NOT NULL DEFAULT 'ai_request',
    provider TEXT NOT NULL DEFAULT 'unknown',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_token_purchase_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    option_id TEXT NOT NULL,
    label TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'placeholder_succeeded',
    before_remaining_tokens INTEGER NOT NULL DEFAULT 0,
    after_remaining_tokens INTEGER NOT NULL DEFAULT 0,
    before_token_limit INTEGER NOT NULL DEFAULT 0,
    after_token_limit INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'placeholder_purchase',
    source_id TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token_amount INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    package_name TEXT NOT NULL,
    token_amount INTEGER NOT NULL,
    code_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by_user_id TEXT NOT NULL,
    exported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemption_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES redemption_batches(id) ON DELETE SET NULL,
    package_id UUID REFERENCES redemption_packages(id) ON DELETE SET NULL,
    code_hash TEXT NOT NULL UNIQUE,
    code_ciphertext TEXT NOT NULL,
    code_prefix TEXT NOT NULL DEFAULT '',
    token_amount INTEGER NOT NULL,
    package_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unused',
    redeemed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at TIMESTAMPTZ,
    revoked_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_master_experiences_user_id ON master_experiences(user_id);
CREATE INDEX IF NOT EXISTS idx_experience_versions_master_id ON experience_versions(master_experience_id);
CREATE INDEX IF NOT EXISTS idx_experience_drafts_user_category ON experience_drafts(user_id, category);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_user_created ON ai_token_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_events_entrypoint ON ai_token_usage_events(entrypoint);
CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_user_created ON ai_token_purchase_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_purchase_events_source ON ai_token_purchase_events(source, source_id);
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
