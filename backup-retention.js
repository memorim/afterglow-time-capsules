import { lstatSync, readdirSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { verifySnapshot } from "./verify-snapshot.js";

export function backupRetentionDays(value) {
  if (value === undefined || value === "") return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("Backup retention must be 1–3650 days");
  return days;
}

// A fresh restore must succeed before pruning any complete, owned snapshot.
export async function pruneSnapshots({ backupDirectory, verifiedSnapshot, retentionDays, now = Date.now() }) {
  const days = backupRetentionDays(retentionDays);
  if (days === undefined) return { deleted: 0, skipped: 0 };
  const root = resolve(backupDirectory), current = resolve(verifiedSnapshot);
  if (dirname(current) !== root || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
    throw new Error("Use a real backup directory containing the verified snapshot");
  await verifySnapshot(current);
  const currentManifest = JSON.parse(readFileSync(join(current, "manifest.json"), "utf8"));
  const created = Date.parse(currentManifest.createdAt);
  if (!Number.isFinite(now) || !Number.isFinite(created) || created > now || now - created > 86400000)
    throw new Error("A fresh verified snapshot is required before pruning");
  let deleted = 0, skipped = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === basename(current)) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}$/.test(entry.name)) {
      skipped++;
      continue;
    }
    const candidate = join(root, entry.name);
    try {
      const manifestPath = join(candidate, "manifest.json");
      if (lstatSync(manifestPath).isSymbolicLink()) throw new Error("Symlink manifest");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const date = new Date(manifest.createdAt);
      const timestamp = date.getTime();
      if (!Number.isFinite(timestamp) || !entry.name.startsWith(date.toISOString().replace(/[:.]/g, "-") + "-"))
        throw new Error("Unknown snapshot date");
      if (timestamp >= now - days * 86400000) continue;
      await verifySnapshot(candidate);
      const expected = new Set(["manifest.json", ...manifest.files.map(file => file.split("/")[0])]);
      if (readdirSync(candidate).some(file => !expected.has(file))) throw new Error("Unrelated files");
      if (expected.has("accounts")) {
        const files = new Set(manifest.files.filter(file => file.startsWith("accounts/")).map(file => file.slice(9)));
        if (readdirSync(join(candidate, "accounts")).some(file => !files.has(file))) throw new Error("Unrelated account files");
      }
      rmSync(candidate, { recursive: true });
      deleted++;
    } catch {
      // Leave corrupt, incomplete and unrecognised directories for the operator.
      skipped++;
    }
  }
  return { deleted, skipped };
}
