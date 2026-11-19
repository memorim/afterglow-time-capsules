import { maintenanceCycle } from "../maintenance-cycle.js";
import { verifySnapshot } from "../verify-snapshot.js";
import { backupRetentionDays, pruneSnapshots } from "../backup-retention.js";
import { configuredRetentionDays } from "../maintenance.js";

const [dataDirectory, backupDirectory] = process.argv.slice(2);
if (!dataDirectory || !backupDirectory)
  throw new Error("Usage: verified-backup.mjs DATA_DIRECTORY BACKUP_DIRECTORY");
const retentionDays = backupRetentionDays(process.env.AFTERGLOW_BACKUP_RETENTION_DAYS);
const result = await maintenanceCycle({
  dataDirectory,
  backupDirectory,
  retentionDays: configuredRetentionDays(),
});
const restored = await verifySnapshot(result.snapshot);
const pruned = await pruneSnapshots({ backupDirectory, verifiedSnapshot: result.snapshot, retentionDays });
console.log(JSON.stringify({ status: "verified", ...result, restored, pruned }));
