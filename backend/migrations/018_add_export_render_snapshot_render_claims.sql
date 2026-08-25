-- Persist cross-worker PDF render claims and short-lived retry results.
-- All columns are nullable so this migration is safe for rolling deploys.

ALTER TABLE export_render_snapshots
    ADD COLUMN IF NOT EXISTS render_claim_id UUID,
    ADD COLUMN IF NOT EXISTS render_claim_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rendered_pdf BYTEA,
    ADD COLUMN IF NOT EXISTS rendered_pdf_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_render_claim_expires_at
    ON export_render_snapshots(render_claim_expires_at)
    WHERE render_claim_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_render_snapshots_rendered_pdf_expires_at
    ON export_render_snapshots(rendered_pdf_expires_at)
    WHERE rendered_pdf IS NOT NULL;
