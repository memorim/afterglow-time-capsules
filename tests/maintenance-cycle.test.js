import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maintenanceCycle } from "../maintenance-cycle.js";
process.env.NODE_ENV = "test";
const { createDb, unseal } = await import("../server.js");
test("maintenance snapshots every account privately and restores decryptable future data", async () => {
  const root = mkdtempSync(join(tmpdir(), "capsule-cycle-")),
    data = join(root, "data"),
    backups = join(root, "backups");
  mkdirSync(join(data, "accounts"), { recursive: true });
  try {
    const files = ["afterglow.db", "accounts/" + "a".repeat(64) + ".db"];
    for (const file of files) {
      const db = createDb(join(data, file));
      db.prepare(
        "UPDATE capsules SET unlock_at='2040-01-01T00:00:00Z' WHERE id=1",
      ).run();
      db.close();
    }
    const result = await maintenanceCycle({
      dataDirectory: data,
      backupDirectory: backups,
      now: Date.parse("2028-01-01"),
    });
    assert.equal(result.databases, 2);
    assert.ok(result.removed > 0);
    const manifest = JSON.parse(
      readFileSync(join(result.snapshot, "manifest.json"), "utf8"),
    );
    assert.deepEqual(manifest.files, files);
    for (const file of files) {
      const restored = createDb(join(result.snapshot, file));
      try {
        assert.ok(
          unseal(
            restored.prepare("SELECT * FROM capsules WHERE id=1").get(),
            "light",
          ),
        );
      } finally {
        restored.close();
      }
      assert.equal(statSync(join(result.snapshot, file)).mode & 0o777, 0o600);
    }
    assert.ok(!readdirSync(backups).some((n) => n.startsWith(".partial")));
    await assert.rejects(() =>
      maintenanceCycle({
        dataDirectory: data,
        backupDirectory: join(data, "backup"),
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
