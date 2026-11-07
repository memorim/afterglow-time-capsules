import { mkdtempSync, readFileSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { copyDatabase } from "./maintenance.js";

/** Restore into a disposable private directory; never open a live database. */
export async function verifySnapshot(snapshot) {
  if (!lstatSync(snapshot).isDirectory() || lstatSync(snapshot).isSymbolicLink())
    throw new Error("Snapshot must be a regular directory");
  const manifestPath = join(snapshot, "manifest.json");
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink())
    throw new Error("Manifest must be a regular file");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files) ||
      !manifest.files.length || new Set(manifest.files).size !== manifest.files.length ||
      manifest.files.some(file => typeof file !== "string" ||
        !/^(afterglow\.db|accounts\/[a-f0-9]{64}\.db)$/.test(file)))
    throw new Error("Invalid snapshot manifest");
  const destination = mkdtempSync(join(tmpdir(), "afterglow-restore-check-"));
  try {
    let capsules = 0;
    for (const file of manifest.files) {
      const source = join(snapshot, file);
      if (file.startsWith("accounts/") &&
          (!lstatSync(join(snapshot, "accounts")).isDirectory() ||
           lstatSync(join(snapshot, "accounts")).isSymbolicLink()))
        throw new Error("Accounts must be a regular directory");
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink())
        throw new Error("Database must be a regular file");
      const restoredPath = join(destination, file);
      mkdirSync(dirname(restoredPath), { recursive: true, mode: 0o700 });
      await copyDatabase(source, restoredPath);
      const restored = new DatabaseSync(restoredPath, { readOnly: true });
      try {
        if (restored.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
            restored.prepare("PRAGMA foreign_key_check").all().length)
          throw new Error("Restored database verification failed");
        capsules += restored.prepare("SELECT count(*) AS n FROM capsules").get().n;
      } finally { restored.close(); }
    }
    return { databases: manifest.files.length, capsules };
  } finally { rmSync(destination, { recursive: true, force: true }); }
}
