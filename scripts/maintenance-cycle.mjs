import { maintenanceCycle } from "../maintenance-cycle.js";
const [dataDirectory, backupDirectory] = process.argv.slice(2);
if (!dataDirectory || !backupDirectory)
  throw new Error(
    "Usage: maintenance-cycle.mjs DATA_DIRECTORY BACKUP_DIRECTORY",
  );
const result = await maintenanceCycle({
  dataDirectory,
  backupDirectory,
  retentionDays: Number(process.env.CAPSULE_RETENTION_DAYS || 365),
});
console.log(JSON.stringify({ status: "ok", ...result }));
