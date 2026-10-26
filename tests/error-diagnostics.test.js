import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
process.env.NODE_ENV = "test";
const { createDb, createApp } = await import("../server.js");
test("database failure is logged server-side and returns a generic JSON error", async () => {
  const db = createDb(":memory:"),
    app = createApp(db),
    logs = [],
    original = console.error;
  db.close();
  console.error = (entry) => logs.push(entry);
  try {
    const result = await request(app).get("/api/capsules");
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { message: "Не удалось обработать запрос" });
    assert.deepEqual(logs, [
      { event: "request_error", error: "internal_error" },
    ]);
  } finally {
    console.error = original;
  }
});
