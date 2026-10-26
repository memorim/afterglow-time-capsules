import express from "express";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = dirname(fileURLToPath(import.meta.url));
const hex = (value) => Buffer.from(value).toString("hex");
// Keep the original Node defaults explicit so stored capsules remain decryptable.
const kdf = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export function seal(message, passphrase) {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, kdf);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(message, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: hex(ciphertext),
    salt: hex(salt),
    iv: hex(iv),
    tag: hex(cipher.getAuthTag()),
  };
}

export function unseal(row, passphrase) {
  const key = scryptSync(passphrase, Buffer.from(row.salt, "hex"), 32, kdf);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(row.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(row.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function createDb(file = resolve(root, "data", "afterglow.db")) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    const initialized = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='capsules'",
      )
      .get();
    db.exec(`CREATE TABLE IF NOT EXISTS capsules(
    id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,sender TEXT NOT NULL,
    recipient TEXT NOT NULL,unlock_at TEXT NOT NULL,theme TEXT NOT NULL,color TEXT NOT NULL,
    hint TEXT NOT NULL,ciphertext TEXT NOT NULL,salt TEXT NOT NULL,iv TEXT NOT NULL,tag TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
    if (!initialized) {
      const add = db.prepare(
        "INSERT INTO capsules(title,sender,recipient,unlock_at,theme,color,hint,ciphertext,salt,iv,tag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      const seeds = [
        [
          "Свет самого длинного дня",
          "Роман",
          "Будущему себе",
          "2026-06-21T09:00:00",
          "solstice",
          "#f0c96b",
          "Пароль для демо: light",
          "Ты хотел помнить не планы, а ощущение: тёплый воздух, открытое окно и редкий день без спешки.",
          "light",
          "2026-05-11T18:20:00",
        ],
        [
          "До следующего июля",
          "Команда",
          "Всем нам",
          "2026-07-01T12:00:00",
          "orbit",
          "#8e7bc7",
          "Пароль для демо: orbit",
          "За этот год мы научились не бояться сложных задач и чаще показывать работу до того, как она стала идеальной.",
          "orbit",
          "2025-07-01T12:00:00",
        ],
        [
          "Первый снег будущего года",
          "Аня",
          "Мише",
          "2026-12-01T08:00:00",
          "winter",
          "#8eb5c9",
          "Откроется зимой",
          "Секретная зимняя капсула.",
          "snow",
          "2026-03-02T09:14:00",
        ],
        [
          "Когда город станет тише",
          "Неизвестный автор",
          "Москва",
          "2027-01-01T00:00:00",
          "city",
          "#df8067",
          "Откроется в новом году",
          "Сообщение городу будущего.",
          "city",
          "2026-01-01T00:01:00",
        ],
      ];
      for (const [
        title,
        sender,
        recipient,
        unlockAt,
        theme,
        color,
        hint,
        message,
        password,
        createdAt,
      ] of seeds) {
        const encrypted = seal(message, password);
        add.run(
          title,
          sender,
          recipient,
          unlockAt,
          theme,
          color,
          hint,
          encrypted.ciphertext,
          encrypted.salt,
          encrypted.iv,
          encrypted.tag,
          createdAt,
        );
      }
    }
    db.exec(
      "CREATE INDEX IF NOT EXISTS capsules_unlock_order ON capsules(unlock_at,id); COMMIT",
    );
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(80),
  sender: z.string().trim().min(2).max(50),
  recipient: z.string().trim().min(2).max(50),
  unlockAt: z.string().datetime({ offset: true }),
  message: z.string().trim().min(10).max(3000),
  passphrase: z.string().min(4).max(100),
  hint: z.string().trim().max(100).default(""),
  theme: z.enum(["solstice", "orbit", "winter", "city"]).default("orbit"),
});
const colors = {
  solstice: "#f0c96b",
  orbit: "#8e7bc7",
  winter: "#8eb5c9",
  city: "#df8067",
};
function unlockTime(row) {
  // Only bundled legacy rows lack an offset; interpret those consistently as UTC.
  const value = String(row.unlock_at),
    explicit = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : value + "Z";
  if (!createSchema.shape.unlockAt.safeParse(explicit).success)
    throw new Error("invalid_unlock_time");
  return Date.parse(explicit);
}
const publicCapsule = (row, now) => ({
  id: row.id,
  title: row.title,
  sender: row.sender,
  recipient: row.recipient,
  unlock_at: row.unlock_at,
  theme: row.theme,
  color: row.color,
  hint: row.hint,
  created_at: row.created_at,
  locked: unlockTime(row) > now,
});

export function createApp(db = createDb(), { now = Date.now } = {}) {
  const app = express();
  app.use("/api", (req, res, next) => {
    if (
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(req.hostname) ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      )
    )
      return res
        .status(403)
        .json({ message: "Доступ разрешён только локально" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("sec-fetch-site") === "cross-site" ||
        (req.get("origin") &&
          req.get("origin") !== `${req.protocol}://${req.get("host")}`))
    )
      return res
        .status(403)
        .json({ message: "Запрос с другого сайта запрещён" });
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  // ponytail: two bounded in-process budgets suit one local operator; a shared
  // limiter is required before adding multiple workers or public accounts.
  const budgets = {
    create: { count: 0, reset: 0 },
    open: { count: 0, reset: 0 },
  };
  const limit = (kind, max) => (_req, res, next) => {
    const time = now(),
      budget = budgets[kind];
    if (time >= budget.reset) {
      budget.count = 0;
      budget.reset = time + 60000;
    }
    if (budget.count >= max)
      return res
        .set(
          "Retry-After",
          String(Math.max(1, Math.ceil((budget.reset - time) / 1000))),
        )
        .status(429)
        .json({ message: "Слишком много попыток. Повторите позже" });
    budget.count++;
    next();
  };
  app.param("id", (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      return res.status(400).json({ message: "Некорректный идентификатор" });
    next();
  });
  app.get("/api/capsules", (req, res) => {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ message: "Проверьте параметры списка" });
    const time = now();
    res.json(
      db
        .prepare(
          "SELECT * FROM capsules ORDER BY unlock_at,id LIMIT ? OFFSET ?",
        )
        .all(parsed.data.limit, parsed.data.offset)
        .map((row) => publicCapsule(row, time)),
    );
  });
  app.get("/api/capsules/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM capsules WHERE id=?")
      .get(Number(req.params.id));
    return row
      ? res.json(publicCapsule(row, now()))
      : res.status(404).json({ message: "Капсула не найдена" });
  });
  app.post("/api/capsules", limit("create", 10), (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Проверьте данные капсулы" });
    const c = parsed.data,
      time = now(),
      unlockAt = new Date(c.unlockAt).toISOString();
    if (Date.parse(unlockAt) <= time)
      return res
        .status(400)
        .json({ message: "Дата открытия должна быть в будущем" });
    const encrypted = seal(c.message, c.passphrase);
    const out = db
      .prepare(
        "INSERT INTO capsules(title,sender,recipient,unlock_at,theme,color,hint,ciphertext,salt,iv,tag,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        c.title,
        c.sender,
        c.recipient,
        unlockAt,
        c.theme,
        colors[c.theme],
        c.hint,
        encrypted.ciphertext,
        encrypted.salt,
        encrypted.iv,
        encrypted.tag,
        new Date(time).toISOString(),
      );
    res.status(201).json({ id: Number(out.lastInsertRowid), unlockAt });
  });
  app.post("/api/capsules/:id/open", limit("open", 30), (req, res) => {
    const parsed = z
      .object({ passphrase: z.string().min(1).max(100) })
      .safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Введите пароль длиной до 100 символов" });
    const row = db
      .prepare("SELECT * FROM capsules WHERE id=?")
      .get(Number(req.params.id));
    if (!row) return res.status(404).json({ message: "Капсула не найдена" });
    const time = now();
    if (unlockTime(row) > time)
      return res
        .status(423)
        .json({ message: "Капсула ещё запечатана", unlockAt: row.unlock_at });
    try {
      return res.json({
        message: unseal(row, parsed.data.passphrase),
        openedAt: new Date(time).toISOString(),
      });
    } catch {
      return res.status(401).json({ message: "Пароль не подходит" });
    }
  });
  app.use(express.static(resolve(root, "public")));
  app.get(/^(?!\/api).*/, (_q, res) =>
    res.sendFile(resolve(root, "public", "index.html")),
  );
  app.use((error, _req, res, _next) => {
    const status =
      error?.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 503;
    if (status === 503)
      console.error({ event: "request_error", error: "internal_error" });
    res.status(status).json({ message: "Не удалось обработать запрос" });
  });
  return app;
}
if (process.env.NODE_ENV !== "test") {
  if (
    process.env.HOST &&
    !["localhost", "127.0.0.1", "::1"].includes(process.env.HOST)
  )
    throw new Error("Afterglow requires a loopback HOST");
  createApp().listen(
    process.env.PORT || 4800,
    process.env.HOST || "127.0.0.1",
    () => console.log("Afterglow: http://localhost:4800"),
  );
}
