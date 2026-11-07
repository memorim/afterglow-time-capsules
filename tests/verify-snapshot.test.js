import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { maintenanceCycle } from "../maintenance-cycle.js";
import { verifySnapshot } from "../verify-snapshot.js";

test("restore verification checks every database and rejects corrupted snapshots", async () => {
  const root = mkdtempSync(join(tmpdir(), "afterglow-verify-test-"));
  const data = join(root, "data");
  mkdirSync(join(data, "accounts"), { recursive: true });
  try {
    for (const file of ["afterglow.db", "accounts/" + "a".repeat(64) + ".db"]) {
      const db = new DatabaseSync(join(data, file));
      db.exec("CREATE TABLE capsules(id INTEGER PRIMARY KEY,unlock_at TEXT); INSERT INTO capsules VALUES(1,'2040-01-01')");
      db.close();
    }
    const { snapshot } = await maintenanceCycle({ dataDirectory: data, backupDirectory: join(root, "backups") });
    assert.deepEqual(await verifySnapshot(snapshot), { databases: 2, capsules: 2 });
    writeFileSync(join(snapshot, "accounts", "a".repeat(64) + ".db"), "not a database");
    await assert.rejects(() => verifySnapshot(snapshot));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("untrusted manifests cannot read paths outside the snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "afterglow-manifest-test-"));
  try {
    for (const files of [["../outside.db"], ["afterglow.db", "afterglow.db"], []]) {
      writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: 1, files }));
      await assert.rejects(() => verifySnapshot(root), /Invalid snapshot manifest/);
    }
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: 1, files: ["afterglow.db"] }));
    symlinkSync(join(root, "outside.db"), join(root, "afterglow.db"));
    await assert.rejects(() => verifySnapshot(root), /regular file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
