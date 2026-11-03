import { DatabaseSync, backup } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
export function purgeExpired(
  db,
  { now = Date.now(), retentionDays = 365 } = {},
) {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650
  )
    throw new Error("Retention must be 1–3650 days after unlock");
  return db
    .prepare("DELETE FROM capsules WHERE datetime(unlock_at)<=datetime(?)")
    .run(new Date(now - retentionDays * 86400000).toISOString()).changes;
}
export async function copyDatabase(source, destination) {
  if (resolve(source) === resolve(destination) || existsSync(destination))
    throw new Error("Destination must be a new file");
  if (!existsSync(source)) throw new Error("Source database not found");
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("Source integrity check failed");
    if (
      !db.prepare("SELECT name FROM sqlite_master WHERE name='capsules'").get()
    )
      throw new Error("Not an Afterglow database");
    await backup(db, destination);
  } finally {
    db.close();
  }
}
