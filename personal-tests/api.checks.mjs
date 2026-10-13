import test from "node:test";
import assert from "node:assert/strict";
import { fixture, origin } from "./runtime.mjs";
const input = {
  url: "sample/repo",
  title: "좋은 발견",
  description: "D1 자료 저장",
  category: "개발",
  tags: ["참고"],
  notes: "나만의 메모",
  pinned: true,
};
test("workerd + actual D1 integration", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  let cookie = "",
    csrf = "",
    id = "";
  const auth = () => ({ Cookie: cookie });
  const mutate = (path, method, data, headers = {}) =>
    f.fetch(path, {
      method,
      headers: {
        ...auth(),
        Origin: origin,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        ...headers,
      },
      body: JSON.stringify(data),
    });
  await t.test(
    "anonymous has login page, no data/assets and no AI",
    async () => {
      assert.equal((await f.fetch("/")).status, 200);
      for (const path of ["/api/items", "/api/export", "/assets/test.js"])
        assert.equal((await f.fetch(path)).status, 401);
      assert.equal((await (await f.fetch("/health")).json()).aiEnabled, false);
    },
  );
  await t.test(
    "OAuth owner, PKCE, secure cookie, single-use state, hashed session",
    async () => {
      const a = await f.authenticate();
      assert.equal(a.response.status, 302);
      cookie = a.cookie;
      const target = new URL(a.start.headers.get("location"));
      assert.equal(target.searchParams.get("scope"), "");
      assert.equal(target.searchParams.get("code_challenge_method"), "S256");
      assert.match(
        a.response.headers.get("set-cookie"),
        /Secure; SameSite=Lax/,
      );
      assert.match(a.response.headers.get("set-cookie"), /HttpOnly/);
      const me = await (await f.fetch("/api/me", { headers: auth() })).json();
      csrf = me.csrf;
      assert.equal(me.login, "test-owner");
      assert.equal(me.aiEnabled, false);
      const row = await f.db.prepare("SELECT * FROM sessions").first();
      assert.notEqual(row.token_hash, cookie.split("=")[1]);
      assert.equal(
        (
          await f.fetch(`/auth/callback?code=synthetic&state=${a.state}`, {
            headers: { Cookie: `__Host-coreline_oauth=${a.state}` },
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "outsider, invalid state/cookie, expired/tampered session denied",
    async () => {
      f.setUser(999);
      assert.equal((await f.authenticate()).response.status, 403);
      f.setUser(123);
      f.setScope("repo");
      assert.equal((await f.authenticate()).response.status, 502);
      f.setScope("");
      assert.equal(
        (await f.fetch("/auth/callback?code=x&state=bad")).status,
        400,
      );
      assert.equal(
        (
          await f.fetch("/api/me", {
            headers: { Cookie: "__Host-coreline_session=" + "b".repeat(64) },
          })
        ).status,
        401,
      );
    },
  );
  await t.test("CSRF origin/token/content-type required", async () => {
    for (const h of [
      { Origin: "https://evil.example" },
      { "X-CSRF-Token": "" },
    ])
      assert.equal((await mutate("/api/items", "POST", input, h)).status, 403);
    assert.equal(
      (
        await mutate("/api/items", "POST", input, {
          "Content-Type": "text/plain",
        })
      ).status,
      415,
    );
  });
  await t.test(
    "create, duplicate, retrieve and escaped literal search",
    async () => {
      const r = await mutate("/api/items", "POST", input);
      assert.equal(r.status, 201, await r.clone().text());
      id = (await r.json()).item.id;
      assert.equal((await mutate("/api/items", "POST", input)).status, 409);
      const r2 = await f.fetch("/api/items?q=" + encodeURIComponent("메모"), {
        headers: auth(),
      });
      const data = await r2.json();
      assert.equal(data.total, 1);
      assert.deepEqual(data.items[0].tags, ["참고"]);
      assert.equal(data.items[0].pinned, true);
      assert.equal(
        (
          await (
            await f.fetch("/api/items?q=" + encodeURIComponent("' OR 1=1 --"), {
              headers: auth(),
            })
          ).json()
        ).total,
        0,
      );
      assert.equal(r2.headers.get("cache-control"), "no-store");
      assert.match(
        r2.headers.get("content-security-policy"),
        /frame-ancestors 'none'/,
      );
    },
  );
  await t.test(
    "optimistic edit conflict, soft delete and restore",
    async () => {
      assert.equal(
        (
          await mutate("/api/items/" + id, "PUT", {
            ...input,
            title: "수정됨",
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (await mutate("/api/items/" + id, "PUT", { ...input, version: 1 }))
          .status,
        409,
      );
      assert.equal(
        (await mutate("/api/items/" + id, "DELETE", { version: 2 })).status,
        200,
      );
      assert.equal(
        (await (await f.fetch("/api/items", { headers: auth() })).json()).total,
        0,
      );
      assert.equal(
        (
          await (
            await f.fetch("/api/items?trash=1", { headers: auth() })
          ).json()
        ).total,
        1,
      );
      assert.equal(
        (await mutate(`/api/items/${id}/restore`, "POST", { version: 3 }))
          .status,
        200,
      );
    },
  );
  await t.test(
    "backup/import is validated, append-only and deduplicated",
    async () => {
      const backup = await (
        await f.fetch("/api/export", { headers: auth() })
      ).json();
      assert.equal(backup.format, "coreline-personal-v1");
      assert.equal(backup.items.length, 1);
      const r = await mutate("/api/import", "POST", backup);
      assert.deepEqual(await r.json(), { inserted: 0, skipped: 1 });
      const invalid = {
        ...backup,
        items: [
          { ...input, url: "https://example.com/one" },
          { ...input, url: "javascript:1" },
        ],
      };
      assert.equal((await mutate("/api/import", "POST", invalid)).status, 400);
      assert.equal(
        (await (await f.fetch("/api/items", { headers: auth() })).json()).total,
        1,
      );
      assert.equal(
        (
          await mutate("/api/import", "POST", {
            ...backup,
            items: Array.from({ length: 21 }, (_, i) => ({
              ...input,
              url: `https://example.com/${i}`,
            })),
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "metadata fetch is allowlisted; bookmark never fetched",
    async () => {
      const before = f.calls.length;
      const m = await (
        await f.fetch(
          "/api/metadata?url=" +
            encodeURIComponent("https://example.com/private"),
          { headers: auth() },
        )
      ).json();
      assert.equal(m.title, "example.com");
      assert.equal(f.calls.length, before);
      assert.equal(
        (
          await (
            await f.fetch("/api/metadata?url=sample/repo", { headers: auth() })
          ).json()
        ).title,
        "sample/repo",
      );
      assert.equal(
        (
          await f.fetch("/api/metadata?url=http://127.0.0.1", {
            headers: auth(),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.fetch("/api/metadata?url=sample/redirect", {
            headers: auth(),
          })
        ).status,
        422,
      );
    },
  );
  await t.test(
    "bad payloads, disabled AI route and private static assets",
    async () => {
      assert.equal(
        (
          await mutate("/api/items", "POST", {
            ...input,
            notes: "x".repeat(12001),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await mutate("/api/items", "POST", {
            ...input,
            notes: "x".repeat(530000),
          })
        ).status,
        413,
      );
      assert.equal(
        (await f.fetch("/api/ai/summary", { headers: auth() })).status,
        404,
      );
      assert.equal(
        (await f.fetch("/api/items/" + id, { headers: auth() })).status,
        405,
      );
      const html = await f.fetch("/", { headers: auth() });
      assert.equal(html.status, 200);
      assert.match(await html.text(), /main|assets\/index/);
      assert.equal(
        (await f.fetch("/api/items?page=1.5", { headers: auth() })).status,
        200,
      );
    },
  );
  await t.test(
    "expired sessions fail closed and metadata throttles",
    async () => {
      const other = await f.authenticate();
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(other.cookie.split("=")[1]),
      );
      await f.db
        .prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?")
        .bind(Buffer.from(hash).toString("hex"))
        .run();
      assert.equal(
        (await f.fetch("/api/me", { headers: { Cookie: other.cookie } }))
          .status,
        401,
      );
      await f.db
        .prepare(
          "INSERT OR REPLACE INTO rate_limits(key,count,expires_at) VALUES (?,20,?)",
        )
        .bind(
          `metadata:123:${Math.floor(Date.now() / 60000)}`,
          Date.now() + 60000,
        )
        .run();
      assert.equal(
        (await f.fetch("/api/metadata?url=sample/repo", { headers: auth() }))
          .status,
        429,
      );
    },
  );
  await t.test(
    "500 item cap includes trash, never overwrites saved data",
    async () => {
      const rows = await f.db
        .prepare("SELECT COUNT(*) AS count FROM items")
        .first();
      const statements = Array.from({ length: 500 - rows.count }, (_, i) =>
        f.db
          .prepare(
            "INSERT INTO items(id,provider,url,title,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            crypto.randomUUID(),
            "bookmark",
            `https://quota.example.com/${i}`,
            "synthetic",
            "2026-01-01",
            "2026-01-01",
            "2026-01-01",
          ),
      );
      for (let n = 0; n < statements.length; n += 20)
        await f.db.batch(statements.slice(n, n + 20));
      assert.equal(
        (
          await mutate("/api/items", "POST", {
            ...input,
            url: "https://quota.example.com/extra",
          })
        ).status,
        409,
      );
      assert.equal(
        (await f.db.prepare("SELECT COUNT(*) AS count FROM items").first())
          .count,
        500,
      );
    },
  );
  await t.test("logout invalidates persisted session", async () => {
    assert.equal((await mutate("/auth/logout", "POST", {})).status, 200);
    assert.equal((await f.fetch("/api/me", { headers: auth() })).status, 401);
  });
  await t.test("missing server secret fails closed", async () => {
    const unready = await fixture({ ready: false });
    try {
      assert.equal((await unready.fetch("/")).status, 503);
      assert.equal((await unready.fetch("/auth/login")).status, 503);
      assert.equal((await unready.fetch("/api/items")).status, 401);
    } finally {
      await unready.mf.dispose();
    }
  });
});
