import express from "express";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Each provisioned account owns a separate database. No caller-supplied tenant IDs.
export function createHostedApp({
  createDb,
  createApp,
  origin,
  accounts = {},
  directory,
  signupSecret,
}) {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  )
    throw new Error(
      "APP_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash",
    );
  const entries = Object.entries(accounts);
  if (signupSecret !== undefined && Buffer.byteLength(signupSecret) < 32)
    throw new Error("AFTERGLOW_SIGNUP_SECRET must contain at least 32 bytes");
  if (
    (!entries.length && !signupSecret) ||
    entries.some(
      ([user, hash]) =>
        !/^[a-zA-Z0-9_-]{1,64}$/.test(user) || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error(
      "Configure account secrets or self-service registration",
    );
  const hashes = new Map(entries.map(([u, h]) => [u, Buffer.from(h, "hex")]));
  const applications = new Map(),
    databases = [];
  function applicationFor(user) {
    if (!applications.has(user)) {
      const file = resolve(
        directory,
        createHash("sha256").update(user).digest("hex") + ".db",
      );
      const pending = Promise.resolve().then(() => createDb(file)).then((db) => {
        databases.push(db);
        return createApp(db, { authenticatedOrigin: origin });
      }).catch((error) => { applications.delete(user); throw error; });
      applications.set(user, pending);
    }
    return applications.get(user);
  }
  const app = express();
  const signature = (user, nonce) => createHmac("sha256", signupSecret)
    .update(user + ":" + nonce).digest("base64url");
  const validSignup = (user, password) => {
    if (!signupSecret || !/^ag-[a-f0-9]{32}$/.test(user)) return false;
    const parts = /^([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(password);
    return Boolean(parts && timingSafeEqual(Buffer.from(parts[2]), Buffer.from(signature(user, parts[1]))));
  };
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.get("host") !== parsed.host)
      return res.status(403).json({ message: "Host not allowed" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") && req.get("origin") !== origin))
    )
      return res.status(403).json({ message: "Origin not allowed" });
    next();
  });
  if (signupSecret) {
    const root = fileURLToPath(new URL("./public/", import.meta.url));
    app.get("/register.html", (_req, res) => res.sendFile(resolve(root, "register.html")));
    app.get("/register.js", (_req, res) => res.sendFile(resolve(root, "register.js")));
    app.get("/register.css", (_req, res) => res.sendFile(resolve(root, "register.css")));
    let windowEnd = 0, registrations = 0;
    app.post("/api/accounts/register", (_req, res) => {
      const time = Date.now();
      if (time >= windowEnd) {
        windowEnd = time + 60000;
        registrations = 0;
      }
      if (registrations >= 30)
        return res.status(429).set("Retry-After", String(Math.ceil((windowEnd - time) / 1000)))
          .json({ message: "Повторите регистрацию через минуту" });
      registrations++;
      const username = "ag-" + randomBytes(16).toString("hex");
      const nonce = randomBytes(16).toString("hex");
      res.status(201).json({ username, password: nonce + "." + signature(username, nonce) });
    });
  }
  app.use(async (req, res, next) => {
    const header = req.get("authorization") || "";
    let user = "",
      password = "";
    if (header.startsWith("Basic ") && header.length <= 1024) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8"),
        colon = decoded.indexOf(":");
      if (colon > 0) {
        user = decoded.slice(0, colon);
        password = decoded.slice(colon + 1);
      }
    }
    const expected = hashes.get(user) || Buffer.alloc(32);
    const valid = timingSafeEqual(
      createHash("sha256").update(password).digest(),
      expected,
    );
    const authorized = hashes.has(user) ? password.length >= 32 && valid : validSignup(user, password);
    if (!authorized)
      return res
        .set(
          "WWW-Authenticate",
          'Basic realm="Private account", charset="UTF-8"',
        )
        .status(401)
        .json({ message: "Authentication required" });
    (await applicationFor(user))(req, res, next);
  });
  app.use((_error, _req, res, _next) => {
    console.error({ event: 'account_database_unavailable' });
    res.status(503).json({ message: 'Не удалось обработать запрос' });
  });
  app.initializeAccounts = async () => {
    for (const user of hashes.keys()) await applicationFor(user);
  };
  app.closeAccounts = async () => {
    await Promise.allSettled(applications.values());
    await Promise.all(databases.map((db) => db.close()));
    applications.clear();
    databases.length = 0;
  };
  return app;
}

