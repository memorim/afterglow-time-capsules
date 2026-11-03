import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedApp } from "../hosted.js";
process.env.NODE_ENV = "test";
const { createApp, createDb } = await import("../server.js");
test("hosted accounts require credentials and isolate stored records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "accounts-"));
  const tokenA = "a".repeat(40),
    tokenB = "b".repeat(40),
    hash = (v) => createHash("sha256").update(v).digest("hex");
  const app = createHostedApp({
    createDb,
    createApp,
    origin: "https://private.example",
    accounts: { alice: hash(tokenA), bob: hash(tokenB) },
    directory,
  });
  const call = (method, path, user, secret) =>
    request(app)
      [method](path)
      .set("Host", "private.example")
      .auth(user, secret);
  try {
    assert.equal(
      (await call("get", "/api/capsules", "alice", "wrong")).status,
      401,
    );
    const made = await call("post", "/api/capsules", "alice", tokenA).send({
      title: "Private capsule",
      sender: "Owner A",
      recipient: "Future A",
      message: "Private message content",
      passphrase: "secret-password",
      unlockAt: "2099-01-01T00:00:00Z",
    });
    assert.equal(made.status, 201);
    const own = await call("get", "/api/capsules", "alice", tokenA),
      other = await call("get", "/api/capsules", "bob", tokenB);
    assert.ok(JSON.stringify(own.body).includes("Private"));
    assert.ok(!JSON.stringify(other.body).includes("Private"));
    assert.equal(
      (
        await call("post", "/api/capsules", "alice", tokenA)
          .set("Origin", "https://evil.example")
          .send({
            title: "Private capsule",
            sender: "Owner A",
            recipient: "Future A",
            message: "Private message content",
            passphrase: "secret-password",
            unlockAt: "2099-01-01T00:00:00Z",
          })
      ).status,
      403,
    );
  } finally {
    app.closeAccounts();
    rmSync(directory, { recursive: true, force: true });
  }
});
