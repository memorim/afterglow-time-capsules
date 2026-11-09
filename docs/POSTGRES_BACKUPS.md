# External PostgreSQL backups

The worker runs separately from Render and the application's Neon project. Its
private bucket and temporary restore database belong to `portfolio-backups`.
Daily target schedule: 00:15 UTC (03:15 Europe/Moscow). Deployment configuration
is in `deploy/backup.json`; that file alone does not provision or enable it.

`SOURCE_DATABASE_URL` must be a dedicated read-only database login for Afterglow.
The source transaction is repeatable-read and read-only. The worker exports all
account capsules and persisted attempt budgets, preserving ciphertext, salts,
IVs, tags and IDs. It does not export credentials, roles, or Render configuration;
retain APP_ACCOUNTS and account access secrets separately for disaster recovery.

Every run uploads a gzip JSON snapshot, downloads it again, compares its SHA-256,
and restores rows into session-private PostgreSQL tables in the backup project.
Only a successful row comparison publishes a matching `.verified.json` marker.
Failure returns 503 and sends a generic alert through the configured ntfy topic.
No capsule content or database credentials are logged or sent to ntfy.

Existing copies are never automatically deleted. Snapshot size is capped at
20 MiB of row JSON, and the worker stops with an alert once stored backup objects
exceed 2 GiB. This bounds resource use without silently upgrading a plan. Review
capacity and archive older copies before reaching that limit. This is a separate
project on the same provider/account, not protection against loss of the entire
Neon account. Backup RPO is one daily interval plus scheduler delays.

## Build and deploy

Run `node scripts/build-backup.mjs`; the source ZIP is
`.neon-build/backup.zip`. The build checks that anonymous invocation is rejected.
Deploy it as Node.js 24 with the two required environment variables to the backup
project, where DATABASE_URL and AWS_* refer to backup resources. Enable the
signed Neon schedule trigger only after validating the first real run.

## Recover to an empty database

Download a snapshot and its verified marker from the private bucket. Verify the
snapshot file's SHA-256 matches `sha256` in the marker. Keep both files private.
Set RESTORE_DATABASE_URL to a NEW empty PostgreSQL database, then run:

```sh
node scripts/restore-postgres.mjs /private/snapshot.json.gz
```

Restoration creates account schemas, indexes, identity sequences and attempt
budgets in one transaction. Existing schemas cause failure instead of overwrite.
Rows are compared before commit. Point a separate application instance at the
restored database with the existing account configuration and verify access
before considering a production cutover. Do not run the restore against production.

## Verification and rollout state

CI exercises a real PostgreSQL export/restore, decrypts a recovered demo capsule,
checks identity continuation, rejects tampering and verifies that corrupted
storage reads cannot publish a success marker.

Live verification completed on 2026-11-09:

- The dedicated `afterglow_backup` source login can SELECT capsule rows but cannot
  INSERT, UPDATE or DELETE them, and has no superuser, role-creation or
  database-creation privileges.
- Function deployment 1 in the separate free `portfolio-backups` project exported
  one account and four encrypted capsules at 14:32:02 UTC.
- The private object was downloaded and verified, then restored and compared in
  temporary PostgreSQL tables. Its matching verified marker was published.
- Snapshot: `snapshots/2026-11-09T14-32-01.411Z-7f08784aad1d119e.json.gz`
- Size: 1515 bytes. SHA-256:
  `7f08784aad1d119e3c4666eb769818cff8a0b00cac9b7f1a4efe95faf240fab8`.
- The signed `afterglow-backup` trigger is enabled with `15 0 * * *`;
  next scheduled run is 2026-11-10 00:15 UTC (03:15 Europe/Moscow).
  The initial one-minute verification schedule was replaced by this daily schedule.

The first live backup and restore comparison succeeded. A subsequent unattended
nightly run and a recovered application's interactive login have not yet been
observed. Source account secrets remain separately required for recovery.
