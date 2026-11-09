import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { maintenanceCycle } from "../maintenance-cycle.js";
import { backupRetentionDays, pruneSnapshots } from "../backup-retention.js";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "afterglow-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, "data"), backups = join(root, "backups");
  mkdirSync(data);
  const db = new DatabaseSync(join(data, "afterglow.db"));
  db.exec("CREATE TABLE capsules(id INTEGER PRIMARY KEY,unlock_at TEXT); INSERT INTO capsules VALUES(1,'2040-01-01')");
  db.close();
  const now = Date.parse("2026-11-07T12:00:00Z");
  const snapshot = async age => (await maintenanceCycle({ dataDirectory: data, backupDirectory: backups, now: now - age * 86400000 })).snapshot;
  return { root, backups, now, snapshot };
}

test("explicit retention removes expired complete snapshots after a fresh restore", async t => {
  const f = await fixture(t);
  const old = await f.snapshot(31), boundary = await f.snapshot(30), recent = await f.snapshot(1), current = await f.snapshot(0);
  assert.deepEqual(await pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: current, retentionDays: 30, now: f.now }), { deleted: 1, skipped: 0 });
  assert.equal(existsSync(old), false);
  for (const path of [boundary, recent, current]) assert.equal(existsSync(path), true);
});

test("failed or stale current restoration never deletes an older copy", async t => {
  const f = await fixture(t), old = await f.snapshot(40), current = await f.snapshot(0);
  writeFileSync(join(current, "afterglow.db"), "broken");
  await assert.rejects(() => pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: current, retentionDays: 30, now: f.now }));
  assert.equal(existsSync(old), true);
  await assert.rejects(() => pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: old, retentionDays: 30, now: f.now }), /fresh verified snapshot/);
});

test("unknown files, corrupt snapshots and symlinks are preserved", async t => {
  const f = await fixture(t), extra = await f.snapshot(45), corrupt = await f.snapshot(44), current = await f.snapshot(0);
  writeFileSync(join(extra, "unrelated.txt"), "keep");
  writeFileSync(join(corrupt, "afterglow.db"), "broken");
  const unknown = join(f.backups, "manual-copy"), link = join(f.backups, "linked-copy");
  mkdirSync(unknown);
  symlinkSync(extra, link);
  assert.deepEqual(await pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: current, retentionDays: 30, now: f.now }), { deleted: 0, skipped: 4 });
  for (const path of [extra, corrupt, unknown, link, current]) assert.equal(existsSync(path), true);
});

test("retention is opt-in and rejects unsafe values before maintenance", async t => {
  const f = await fixture(t), old = await f.snapshot(45), current = await f.snapshot(0);
  assert.deepEqual(await pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: current }), { deleted: 0, skipped: 0 });
  assert.equal(existsSync(old), true);
  for (const value of [0, -1, "NaN", 1.5, 3651, " "]) assert.throws(() => backupRetentionDays(value));
});


test("valid SQLite edits are detected and cannot authorize pruning", async t => {
  const f = await fixture(t), old = await f.snapshot(40), current = await f.snapshot(0);
  const changed = new DatabaseSync(join(current, "afterglow.db"));
  changed.exec("UPDATE capsules SET unlock_at='2041-01-01' WHERE id=1");
  assert.equal(changed.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  changed.close();
  await assert.rejects(() => pruneSnapshots({ backupDirectory: f.backups, verifiedSnapshot: current, retentionDays: 30, now: f.now }), /digest mismatch/);
  assert.equal(existsSync(old), true);
});
