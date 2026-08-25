-- MANUAL PHASE-B MIGRATION. Do not run during a rolling deployment.
--
-- Preconditions:
--   1. Every application instance that can write agent_api_keys.key_plaintext
--      has been drained and cannot restart.
--   2. Rollback to such an instance is no longer required.
--   3. In the same PostgreSQL session, the operator has explicitly run:
--        SET resumeflow.agent_api_key_plaintext_phase_b = 'old-writers-drained';
--
-- The guard deliberately makes accidental execution fail closed. Phase A
-- keeps the legacy column and values so old instances remain rollback-safe.
-- Phase B revokes every still-active key whose reusable plaintext was stored;
-- those credentials must be rotated because their at-rest exposure cannot be
-- undone by dropping the column. Hash-only active keys remain valid.

BEGIN;

DO $agent_api_key_phase_b_guard$
BEGIN
    IF current_setting(
        'resumeflow.agent_api_key_plaintext_phase_b',
        true
    ) IS DISTINCT FROM 'old-writers-drained' THEN
        RAISE EXCEPTION
            'Agent API key Phase B requires all legacy plaintext writers to be drained';
    END IF;
END;
$agent_api_key_phase_b_guard$;

-- Runtime startup takes the same transaction-scoped lock before reading the
-- durable marker. Whichever transaction enters first completes the whole
-- marker/column transition before the other can decide whether to ALTER.
SELECT pg_advisory_xact_lock(5928497734025232972);

LOCK TABLE agent_api_keys IN ACCESS EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS runtime_schema_migration_markers (
    marker TEXT PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_agent_api_keys_discard_plaintext
    ON agent_api_keys;
DROP FUNCTION IF EXISTS discard_agent_api_key_plaintext();

DO $agent_api_key_phase_b_scrub$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'agent_api_keys'::regclass
          AND attname = 'key_plaintext'
          AND NOT attisdropped
    ) THEN
        UPDATE agent_api_keys
        SET revoked_at = now()
        WHERE key_plaintext IS NOT NULL
          AND revoked_at IS NULL;

        UPDATE agent_api_keys
        SET key_plaintext = NULL
        WHERE key_plaintext IS NOT NULL;
    END IF;
END;
$agent_api_key_phase_b_scrub$;

ALTER TABLE agent_api_keys
    DROP COLUMN IF EXISTS key_plaintext;

-- New runtime startup checks this durable marker before issuing its legacy
-- compatibility ADD COLUMN. Recording it after scrub/drop keeps Phase B
-- retry-safe without allowing a restart to recreate the retired column.
INSERT INTO runtime_schema_migration_markers (marker)
VALUES ('agent_api_keys.key_plaintext_phase_b')
ON CONFLICT (marker) DO NOTHING;

COMMIT;
