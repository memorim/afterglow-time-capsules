import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("configured disk preserves application records across independent processes", t => {
  const directory = mkdtempSync(join(tmpdir(), "afterglow-disk-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: "test", AFTERGLOW_DATA_DIRECTORY: directory };
  const run = source => execFileSync(process.execPath, ["--input-type=module", "-e", source], { env, encoding: "utf8" });
  run("import {createDb,seal} from './server.js'; const db=createDb(); const d=seal('persisted synthetic','fixture-password'); db.prepare('INSERT INTO capsules(title,sender,recipient,unlock_at,theme,color,hint,ciphertext,salt,iv,tag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('Disk probe','Fixture','Fixture','2040-01-01T00:00:00Z','orbit','#8e7bc7','',d.ciphertext,d.salt,d.iv,d.tag,'2026-11-07T00:00:00Z'); db.close();");
  assert.equal(existsSync(join(directory, "afterglow.db")), true);
  assert.equal(run("import {createDb,unseal} from './server.js'; const db=createDb(); console.log(unseal(db.prepare(\"SELECT * FROM capsules WHERE title='Disk probe'\").get(),'fixture-password')); db.close();").trim(), "persisted synthetic");
});

test("persistent data cannot be served as public static files", () => {
  for (const directory of [resolve("public"), resolve("public/private")])
    assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", "import {dataDirectory} from './storage.js'; dataDirectory();"], { env: { ...process.env, AFTERGLOW_DATA_DIRECTORY: directory }, stdio: "pipe" }));
});
