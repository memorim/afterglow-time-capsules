// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
// ponytail: state lasts for one page session; use the documented server for shared, durable data.
(() => {
  const state = structuredClone(globalThis.DEMO_SEED);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, min = 1, max = 200) => {
    if (
      typeof value !== "string" ||
      value.trim().length < min ||
      value.trim().length > max
    )
      fail("Проверьте введённые данные");
    return value.trim();
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, globalThis.location.href);
    if (
      url.origin !== globalThis.location.origin ||
      !url.pathname.startsWith("/api/")
    )
      return originalFetch(input, options);
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    try {
      return await handle(
        url,
        options.method || "GET",
        options.body ? JSON.parse(options.body) : {},
        new Headers(options.headers),
      );
    } catch (error) {
      return json(
        { message: error.message, detail: error.message },
        error.status || 400,
      );
    }
  };
  globalThis.PORTFOLIO_DEMO = true;

  const vault = new Map();
  async function keyFor(password, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  async function handle(url, method, body) {
    if (url.pathname === "/api/capsules" && method === "GET")
      return json(
        state["/api/capsules"].map((x) => ({
          ...x,
          locked: Date.parse(x.unlock_at) > Date.now(),
        })),
      );
    if (url.pathname === "/api/capsules" && method === "POST") {
      const title = text(body.title, 2, 100),
        message = text(body.message, 1, 5000),
        sender = text(body.sender, 2, 80),
        recipient = text(body.recipient, 2, 80),
        password = text(body.passphrase, 4, 100);
      if (
        !Number.isFinite(Date.parse(body.unlockAt)) ||
        Date.parse(body.unlockAt) <= Date.now()
      )
        fail("Выберите будущую дату");
      if (vault.size >= 20) fail("В этой сессии уже 20 капсул", 429);
      const salt = crypto.getRandomValues(new Uint8Array(16)),
        iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await keyFor(password, salt),
        new TextEncoder().encode(message),
      );
      const id = Math.max(0, ...state["/api/capsules"].map((x) => x.id)) + 1;
      vault.set(id, { salt, iv, ciphertext });
      state["/api/capsules"].push({
        id,
        title,
        sender,
        recipient,
        hint: body.hint || "",
        unlock_at: body.unlockAt,
        theme: "orbit",
        color: "#9684d8",
        locked: true,
      });
      return json({ id }, 201);
    }
    const match = url.pathname.match(/^\/api\/capsules\/(\d+)\/open$/);
    if (match && method === "POST") {
      const id = Number(match[1]),
        capsule = state["/api/capsules"].find((x) => x.id === id);
      if (!capsule) fail("Капсула не найдена", 404);
      if (Date.parse(capsule.unlock_at) > Date.now())
        fail("Капсула ещё закрыта", 423);
      const saved = vault.get(id);
      if (!saved) {
        if (body.passphrase !== "starlight") fail("Неверный пароль", 403);
        return json({
          message:
            "Однажды маленький шаг превратится в большое путешествие. Продолжай.",
        });
      }
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: saved.iv },
          await keyFor(text(body.passphrase, 4, 100), saved.salt),
          saved.ciphertext,
        );
        return json({ message: new TextDecoder().decode(plaintext) });
      } catch {
        fail("Неверный пароль", 403);
      }
    }
    fail("Не найдено", 404);
  }
})();
