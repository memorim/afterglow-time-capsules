import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyDatabase, purgeExpired } from "../maintenance.js";
process.env.NODE_ENV = "test";
const { createDb, unseal } = await import("../server.js");
test("consistent backup restores decryptable data and refuses overwrites; retention preserves future capsules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "capsule-backup-")),
    source = join(dir, "source.db"),
    destination = join(dir, "restored.db");
  const db = createDb(source);
  try {
    const original = db.prepare("SELECT * FROM capsules WHERE id=1").get();
    await copyDatabase(source, destination);
    const restored = createDb(destination);
    try {
      assert.equal(
        unseal(
          restored.prepare("SELECT * FROM capsules WHERE id=1").get(),
          "light",
        ),
        unseal(original, "light"),
      );
    } finally {
      restored.close();
    }
    await assert.rejects(() => copyDatabase(source, destination));
    assert.throws(() => purgeExpired(db, { retentionDays: 0 }));
    const before = db.prepare("SELECT count(*) n FROM capsules").get().n;
    purgeExpired(db, {
      now: Date.parse("2027-07-02T00:00:00Z"),
      retentionDays: 365,
    });
    assert.ok(db.prepare("SELECT count(*) n FROM capsules").get().n < before);
    assert.ok(db.prepare("SELECT * FROM capsules WHERE id=4").get());
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
