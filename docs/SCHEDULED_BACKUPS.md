# Scheduled backups and restore checks

The repository includes a daily systemd timer and a backup command that restores
every database from the new snapshot into a disposable private directory and
checks SQLite integrity and foreign keys. A verification failure exits nonzero.
The running application's databases are not replaced during verification.

## Linux server setup

Use Node 24.18+ (below 25), an existing `afterglow` service user and persistent
data at `/srv/afterglow/data`. Install this checkout at `/srv/afterglow`.
Adjust paths, user and the Node `PATH` in the unit to match the server.
`ReadWritePaths` must match the configured data and backup directories.

```sh
sudo install -d -m 0700 -o afterglow -g afterglow /srv/afterglow-backups
sudo install -m 0600 deploy/afterglow-backup.env.example /etc/afterglow-backup.env
sudo install -m 0644 deploy/afterglow-backup.service deploy/afterglow-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start afterglow-backup.service
sudo journalctl -u afterglow-backup.service --no-pager
sudo systemctl enable --now afterglow-backup.timer
systemctl list-timers afterglow-backup.timer
```

The timer runs daily at 03:15 UTC with up to 15 minutes jitter. `Persistent=true`
runs a missed job after startup. systemd does not start the same oneshot service
again while it is running; do not run an overlapping manual maintenance command.
Connect failed-unit monitoring to the operator's existing alert channel.

Manual equivalent, under the application's service user:

```sh
node scripts/verified-backup.mjs /srv/afterglow/data /srv/afterglow-backups
```

Successful output has `status: "verified"` and counts of restored databases and
capsules. Counts are operational totals; no capsule text or credentials are logged.
This is a structural restore check, not a password/decryption check. The existing
maintenance regression test separately verifies decryption with synthetic data.

## Retention and independent storage

`CAPSULE_RETENTION_DAYS` controls expired capsule deletion, not backup lifetime.
Keep backups outside the application directory and copy successful snapshots to
an independently protected disk/object store. Set `AFTERGLOW_BACKUP_RETENTION_DAYS=30`
(1–3650 days) to remove old local snapshots only after a fresh snapshot passes
restoration. Omit it to keep all snapshots. The newest verified snapshot is kept;
incomplete, corrupt, symlinked and unrecognised directories (including unrelated
files) are skipped. Check skipped directories and available space. Set a matching
explicit lifecycle policy in independent storage, accounting for how long
personal data remains in backup copies.

For an actual recovery, stop the application, use `scripts/maintenance.mjs restore`
to create a new database, and switch the application to it only after validation.
Keep the original database until the recovery is confirmed. Capsule passwords
cannot be recovered from the snapshots.

## Verification and deployment status

`node --test tests/verify-snapshot.test.js` checks all-account restoration,
corruption rejection, unsafe manifest paths, duplicate entries and symlinks.
The normal CI suite includes these tests. Server installation, off-host storage,
timer execution and alert delivery require the target host and are not claimed
as configured by adding these files.
