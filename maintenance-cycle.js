import {
  mkdirSync,
  readdirSync,
  existsSync,
  lstatSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyDatabase, purgeExpired } from "./maintenance.js";

export async function maintenanceCycle({
  dataDirectory,
  backupDirectory,
  retentionDays = 365,
  now = Date.now(),
}) {
  const data = resolve(dataDirectory),
    backups = resolve(backupDirectory);
  if (data === backups || backups.startsWith(data + "/"))
    throw new Error("Store backups outside the application data directory");
  const files = [];
  if (existsSync(join(data, "afterglow.db"))) files.push("afterglow.db");
  const accounts = join(data, "accounts");
  if (existsSync(accounts)) {
    if (lstatSync(accounts).isSymbolicLink())
      throw new Error("Account directory must not be a symlink");
    for (const name of readdirSync(accounts).sort())
      if (/^[a-f0-9]{64}\.db$/.test(name)) files.push("accounts/" + name);
  }
  if (!files.length) throw new Error("No application databases found");
  mkdirSync(backups, { recursive: true, mode: 0o700 });
  const id =
    new Date(now).toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
  const staging = join(backups, ".partial-" + id),
    destination = join(backups, id);
  mkdirSync(staging, { mode: 0o700 });
  let removed = 0;
  try {
    for (const file of files) {
      const source = join(data, file);
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
        throw new Error("Database must be a regular file");
      const db = new DatabaseSync(source, { open: true });
      try {
        db.exec("PRAGMA busy_timeout=5000");
        removed += purgeExpired(db, { retentionDays, now });
      } finally {
        db.close();
      }
      const target = join(staging, file);
      mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
      await copyDatabase(source, target);
    }
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date(now).toISOString(),
          files,
          retentionDays,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    renameSync(staging, destination);
    return { snapshot: destination, databases: files.length, removed };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
