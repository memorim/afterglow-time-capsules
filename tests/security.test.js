import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
process.env.NODE_ENV = "test";
const { createDb, createApp, seal, unseal } = await import("../server.js");

test("local-only API rejects rebinding hosts and cross-origin writes", async () => {
  const db = createDb(":memory:");
  try {
    const app = createApp(db);
    assert.equal(
      (await request(app).get("/api/capsules").set("Host", "attacker.example"))
        .status,
      403,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/capsules/1/open")
          .set("Origin", "https://attacker.example")
          .send({ passphrase: "light" })
      ).status,
      403,
    );
    assert.equal((await request(app).get("/api/capsules")).status, 200);
  } finally {
    db.close();
  }
});

test("invalid stored unlock times fail closed instead of releasing plaintext", async () => {
  const db = createDb(":memory:");
  try {
    db.prepare("UPDATE capsules SET unlock_at=? WHERE id=1").run("not-a-date");
    const result = await request(createApp(db))
      .post("/api/capsules/1/open")
      .send({ passphrase: "light" });
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result.body).includes("тёплый воздух"));
  } finally {
    db.close();
  }
});

test("opening has the same bounded passphrase length as creation", async () => {
  const db = createDb(":memory:");
  try {
    assert.equal(
      (
        await request(createApp(db))
          .post("/api/capsules/1/open")
          .send({ passphrase: "x".repeat(101) })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});

test("password attempts have a bounded per-process budget", async () => {
  const db = createDb(":memory:");
  try {
    let time = Date.parse("2030-01-01T00:00:00Z");
    const app = createApp(db, { now: () => time });
    let limited = false;
    for (let attempt = 0; attempt < 35; attempt++) {
      const response = await request(app)
        .post("/api/capsules/1/open")
        .send({ passphrase: "wrong" });
      if (response.status === 429) {
        assert.ok(Number(response.headers["retry-after"]) > 0);
        limited = true;
        break;
      }
      assert.equal(response.status, 401);
    }
    assert.ok(limited);
    time += 60000;
    assert.equal(
      (
        await request(app)
          .post("/api/capsules/1/open")
          .send({ passphrase: "light" })
      ).status,
      200,
    );
  } finally {
    db.close();
  }
});

test("AES-GCM uses fresh salts/IVs and authenticates the complete encrypted message", () => {
  const text = "Содержимое защищённой капсулы",
    password = "regression-secret";
  const first = seal(text, password),
    second = seal(text, password);
  assert.equal(first.salt.length, 32);
  assert.equal(first.iv.length, 24);
  assert.equal(first.tag.length, 32);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.iv, second.iv);
  assert.equal(unseal(first, password), text);
  assert.throws(() => unseal(first, "incorrect"));
  for (const key of ["ciphertext", "tag", "iv", "salt"]) {
    const changed = {
      ...first,
      [key]: (first[key].startsWith("00") ? "01" : "00") + first[key].slice(2),
    };
    assert.throws(() => unseal(changed, password), key);
  }
});

test("the server clock controls unlock boundaries and offsets are canonical UTC", async () => {
  const db = createDb(":memory:");
  let time = Date.parse("2030-01-01T00:00:00Z") - 1;
  const app = createApp(db, { now: () => time });
  try {
    db.prepare("UPDATE capsules SET unlock_at=? WHERE id=1").run(
      "2030-01-01T00:00:00",
    );
    const before = await request(app)
      .post("/api/capsules/1/open")
      .send({ passphrase: "light", now: "2099-01-01T00:00:00Z" });
    assert.equal(before.status, 423);
    time++;
    assert.equal(
      (await request(app).get("/api/capsules/1")).body.locked,
      false,
    );
    assert.equal(
      (
        await request(app)
          .post("/api/capsules/1/open")
          .send({ passphrase: "light" })
      ).status,
      200,
    );
    time++;
    assert.equal(
      (
        await request(app)
          .post("/api/capsules/1/open")
          .send({ passphrase: "light" })
      ).status,
      200,
    );
    const body = {
      title: "Offset capsule",
      sender: "Sender",
      recipient: "Recipient",
      unlockAt: "2030-01-02T03:00:00+03:00",
      message: "Private future message",
      passphrase: "test-secret",
    };
    const created = await request(app).post("/api/capsules").send(body);
    assert.equal(created.status, 201);
    const saved = db
      .prepare("SELECT * FROM capsules WHERE id=?")
      .get(created.body.id);
    assert.equal(saved.unlock_at, "2030-01-02T00:00:00.000Z");
    assert.equal(unseal(saved, body.passphrase), body.message);
    assert.ok(!Object.values(saved).includes(body.message));
    assert.ok(!Object.values(saved).includes(body.passphrase));
    assert.equal(
      (
        await request(app)
          .post("/api/capsules")
          .send({ ...body, unlockAt: new Date(time).toISOString() })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});

test("malformed identifiers, unbounded bodies and invalid pages are rejected", async () => {
  const db = createDb(":memory:"),
    app = createApp(db);
  try {
    for (const id of ["0", "-1", "1 OR 1=1", "9007199254740992"])
      assert.equal(
        (await request(app).get("/api/capsules/" + encodeURIComponent(id)))
          .status,
        400,
      );
    assert.equal(
      (
        await request(app)
          .post("/api/capsules/1/open")
          .send({ passphrase: "x".repeat(40000) })
      ).status,
      413,
    );
    assert.equal((await request(app).get("/api/capsules?limit=0")).status, 400);
    const a = await request(app).get("/api/capsules?limit=2"),
      b = await request(app).get("/api/capsules?limit=2&offset=2");
    assert.equal(a.body.length, 2);
    assert.equal(b.body.length, 2);
    assert.equal(new Set([...a.body, ...b.body].map((x) => x.id)).size, 4);
    assert.ok(!JSON.stringify(a.body).includes("ciphertext"));
  } finally {
    db.close();
  }
});

test("database errors leave no partial capsule and never log sensitive text", async () => {
  const db = createDb(":memory:"),
    app = createApp(db),
    logs = [],
    original = console.error;
  const body = {
    title: "Rollback capsule",
    sender: "Sender",
    recipient: "Recipient",
    unlockAt: new Date(Date.now() + 86400000).toISOString(),
    message: "Confidential original payload",
    passphrase: "private-secret",
  };
  try {
    db.exec(
      "CREATE TRIGGER reject_capsule BEFORE INSERT ON capsules BEGIN SELECT RAISE(ABORT,'Confidential original payload');END;",
    );
    console.error = (x) => logs.push(x);
    assert.equal(
      (await request(app).post("/api/capsules").send(body)).status,
      503,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM capsules").get().n, 4);
    assert.ok(!JSON.stringify(logs).includes(body.message));
    assert.ok(!JSON.stringify(logs).includes(body.passphrase));
    db.exec("DROP TRIGGER reject_capsule");
    assert.equal(
      (await request(app).post("/api/capsules").send(body)).status,
      201,
    );
  } finally {
    console.error = original;
    db.close();
  }
});
