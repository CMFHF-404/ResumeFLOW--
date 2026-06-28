ALTER TABLE redemption_packages
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;

ALTER TABLE redemption_batches
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;

ALTER TABLE redemption_codes
    ADD COLUMN IF NOT EXISTS unlimited_duration_hours INTEGER;
