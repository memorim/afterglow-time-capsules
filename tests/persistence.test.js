import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.NODE_ENV = "test";
const { createDb, unseal } = await import("../server.js");

test(
  "independent processes initialize once, allocate unique IDs and survive reopen",
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "afterglow-audit-")),
      file = join(dir, "capsules.db"),
      children = [];
    try {
      const starts = [1, 2].map(async () => {
        const child = fork(
          new URL("./fixtures/capsule-server.js", import.meta.url),
          [file],
          {
            env: { ...process.env, NODE_ENV: "test" },
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            windowsHide: true,
          },
        );
        children.push(child);
        const [message] = await once(child, "message");
        return "http://127.0.0.1:" + message.port;
      });
      const urls = await Promise.all(starts);
      let db = createDb(file);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM capsules").get().n, 4);
      db.close();
      const body = {
        title: "Concurrent capsule",
        sender: "Sender",
        recipient: "Recipient",
        unlockAt: new Date(Date.now() + 86400000).toISOString(),
        message: "Persistent secret message",
        passphrase: "private-secret",
      };
      const responses = await Promise.all(
        urls.map((url) =>
          fetch(url + "/api/capsules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      );
      assert.ok(responses.every((r) => r.status === 201));
      const values = await Promise.all(responses.map((r) => r.json()));
      assert.notEqual(values[0].id, values[1].id);
      await Promise.all(
        children.map(async (child) => {
          const exited = once(child, "exit");
          child.send("stop");
          await exited;
        }),
      );
      db = createDb(file);
      try {
        assert.equal(
          db.prepare("PRAGMA integrity_check").get().integrity_check,
          "ok",
        );
        assert.equal(db.prepare("SELECT COUNT(*) n FROM capsules").get().n, 6);
        for (const value of values)
          assert.equal(
            unseal(
              db.prepare("SELECT * FROM capsules WHERE id=?").get(value.id),
              body.passphrase,
            ),
            body.message,
          );
        db.exec("DELETE FROM capsules");
      } finally {
        db.close();
      }
      db = createDb(file);
      try {
        assert.equal(db.prepare("SELECT COUNT(*) n FROM capsules").get().n, 0);
      } finally {
        db.close();
      }
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode === null) {
            const exited = once(child, "exit");
            child.kill();
            await exited;
          }
        }),
      );
      await rm(dir, { recursive: true, force: true });
    }
  },
);
