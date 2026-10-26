import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
function browser() {
  let offset = 0;
  class Clock extends Date {
    static now() {
      return Date.now() + offset;
    }
  }
  let network = 0;
  const scope = {
    DEMO_SEED: JSON.parse(
      readFileSync(new URL("./seed.json", import.meta.url), "utf8"),
    ),
    structuredClone,
    Response,
    Headers,
    URL,
    DOMException,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    location: new URL("https://example.test/project/"),
    fetch: async () => {
      network++;
      throw Error("Unexpected network request");
    },
  };
  runInNewContext(
    readFileSync(new URL("./browser.js", import.meta.url), "utf8"),
    scope,
  );
  return {
    call: async (path, method = "GET", body, headers) => {
      const response = await scope.fetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    advance: (ms) => {
      offset += ms;
    },
    network: () => network,
  };
}
test("capsule uses Web Crypto, date gate and password before revealing", async () => {
  const b = browser();
  const body = {
    sender: "Roman",
    recipient: "Future me",
    title: "Encrypted letter",
    message: "Only after the date",
    passphrase: "secret phrase",
    unlockAt: new Date(Date.now() + 2000).toISOString(),
  };
  const created = await b.call("/api/capsules", "POST", body);
  assert.equal(created.status, 201);
  const path = "/api/capsules/" + created.body.id + "/open";
  assert.equal(
    (await b.call(path, "POST", { passphrase: body.passphrase })).status,
    423,
  );
  b.advance(5000);
  assert.equal(
    (await b.call(path, "POST", { passphrase: "wrong password" })).status,
    403,
  );
  assert.equal(
    (await b.call(path, "POST", { passphrase: body.passphrase })).body.message,
    body.message,
  );
  assert.equal(b.network(), 0);
});
