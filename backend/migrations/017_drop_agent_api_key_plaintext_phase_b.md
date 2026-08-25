# Agent API key plaintext Phase-B runbook

`017_drop_agent_api_key_plaintext_phase_b.sql` is an irreversible, manual
cutover. Do not include it in a rolling-deployment startup path.

## Preconditions

1. Deploy the hash-only Agent API key writer everywhere.
2. Drain every older instance that can write or read `key_plaintext`, and make
   sure it cannot restart.
3. Confirm rollback to an older instance is no longer required and take the
   normal database backup for the release.
4. Notify operators that active keys with stored legacy plaintext will be
   revoked and their owners must create a replacement. Active hash-only keys
   remain valid.

## Execute

Use one trusted `psql` session for both the guard and the migration:

```sql
SET resumeflow.agent_api_key_plaintext_phase_b = 'old-writers-drained';
\i migrations/017_drop_agent_api_key_plaintext_phase_b.sql
```

The migration takes the same transaction-scoped advisory lock as runtime
startup, locks `agent_api_keys`, revokes active rows that still contain legacy
plaintext, scrubs every plaintext value, drops the column, and records a
durable marker. Missing guard state aborts the transaction.

## Verify

```sql
SELECT marker, completed_at
FROM runtime_schema_migration_markers
WHERE marker = 'agent_api_keys.key_plaintext_phase_b';

SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'agent_api_keys'
      AND column_name = 'key_plaintext'
) AS plaintext_column_still_exists;
```

The marker must exist and `plaintext_column_still_exists` must be `false`.
Restart one current application instance and repeat the column check; the
runtime marker must prevent the compatibility column from being recreated.

## Recovery boundary

Re-running the guarded migration is idempotent. Restoring an older application
writer is not: Phase B intentionally destroys stored plaintext and revokes the
affected active credentials. Restore the pre-cutover database backup only as a
coordinated rollback, or keep the current application and rotate affected keys.
