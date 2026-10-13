import {
  AppError,
  labels,
  validateItem,
  validateBackup,
  type Item,
  type ItemInput,
} from "../personal/shared";
import {
  callback,
  checkMutation,
  configured,
  login,
  logout,
  sessionFor,
  throttle,
  type Env,
} from "./auth";
import { metadata } from "./metadata";

type Row = Omit<Item, "pinned" | "tags"> & { pinned: number; tags: string };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const fromRow = (row: Row): Item => ({
  ...row,
  pinned: Boolean(row.pinned),
  tags: JSON.parse(row.tags),
});
const now = () => new Date().toISOString();
const fields = (item: ItemInput) => [
  item.provider,
  item.url,
  item.title,
  item.description,
  item.category,
  JSON.stringify(item.tags),
  item.notes,
  item.pinned ? 1 : 0,
];
const insert = (env: Env, item: ItemInput, ignore = false) =>
  env.DB.prepare(
    `INSERT ${ignore ? "OR IGNORE " : ""}INTO items (id,provider,url,title,description,category,tags,notes,pinned,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM items)<500`,
  ).bind(crypto.randomUUID(), ...fields(item), now(), now());
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "요청 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > 512 * 1024) {
      await reader.cancel();
      throw new AppError(413, "요청은 512KB 이내로 나누어 보내 주세요.");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const part of chunks) {
    bytes.set(part, pos);
    pos += part.length;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new AppError(400, "올바른 JSON 요청이 필요합니다.");
  }
}
const version = (b: Record<string, unknown>) => {
  if (!Number.isSafeInteger(b.version) || Number(b.version) < 1)
    throw new AppError(400, "자료 버전이 올바르지 않습니다.");
  return Number(b.version);
};
function loginPage(ready: boolean) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coreline · 개인 자료함</title><style>body{margin:0;background:#eaf2fb;color:#102849;font:16px/1.7 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}main{max-width:440px;margin:24px;padding:44px;background:white;border:1px solid #cedded;border-radius:24px}small{font:12px monospace;color:#476d5d}h1{font-size:32px;letter-spacing:-1.2px;line-height:1.3}a{display:block;background:#1f4e89;color:white;padding:14px;border-radius:10px;text-align:center;text-decoration:none;font-weight:700}p{color:#5e718a}footer{font-size:12px;margin-top:24px;color:#5e718a}</style><main><small>CORELINE / PERSONAL LIBRARY</small><h1>좋은 발견을,<br>나만의 자료함에.</h1><p>GitHub · YouTube · 북마크를 한곳에 모으세요.<br>허용된 GitHub 소유자만 사용할 수 있습니다.</p>${ready ? '<a href="/auth/login">GitHub로 로그인</a>' : '<p role="status">로그인 설정을 준비하고 있습니다.<br>설정이 완료될 때까지 자료 접근은 차단됩니다.</p>'}<footer>AI 기능 꺼짐 · 비공개 저장소 권한 요청 없음</footer></main></html>`,
    {
      status: ready ? 200 : 503,
      headers: { "Content-Type": "text/html;charset=utf-8" },
    },
  );
}
function protect(response: Response) {
  const r = new Response(response.body, response);
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  r.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  return r;
}
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method === "GET" && path === "/health")
    return json({ ok: true, service: "coreline-personal", aiEnabled: false });
  if (request.method === "GET" && path === "/auth/login")
    return login(request, env);
  if (request.method === "GET" && path === "/auth/callback")
    return callback(request, env);
  const session = await sessionFor(request, env);
  if (!session) {
    if (request.method === "GET" && path === "/")
      return loginPage(configured(env));
    throw new AppError(401, "로그인이 필요합니다.");
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    checkMutation(request, env, session);
    await throttle(env, `write:${session.user_id}`, 90);
  }
  if (path === "/auth/logout" && request.method === "POST")
    return logout(env, session);
  if (path === "/api/me" && request.method === "GET")
    return json({
      login: session.login,
      csrf: session.csrf,
      aiEnabled: false,
      maxItems: 500,
    });
  if (path === "/api/metadata" && request.method === "GET") {
    await throttle(env, `metadata:${session.user_id}`, 20);
    return json(await metadata(url.searchParams.get("url") || ""));
  }
  if (path === "/api/items" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim(),
      provider = url.searchParams.get("provider") || "",
      category = url.searchParams.get("category") || "";
    if (
      q.length > 80 ||
      category.length > 40 ||
      (provider && !Object.keys(labels).includes(provider))
    )
      throw new AppError(400, "검색 조건이 올바르지 않습니다.");
    const page = Math.max(
        1,
        Math.min(100, Math.floor(Number(url.searchParams.get("page"))) || 1),
      ),
      trash = url.searchParams.get("trash") === "1";
    const where = `deleted_at IS ${trash ? "NOT " : ""}NULL AND (?='' OR provider=?) AND (?='' OR category=?) AND (?='' OR instr(lower(title||' '||description||' '||tags||' '||notes||' '||url),lower(?))>0)`;
    const params = [provider, provider, category, category, q, q];
    const [rows, count, categories, stats] = await env.DB.batch([
      env.DB.prepare(
        `SELECT * FROM items WHERE ${where} ORDER BY pinned DESC,updated_at DESC,id ASC LIMIT 12 OFFSET ?`,
      ).bind(...params, (page - 1) * 12),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM items WHERE ${where}`).bind(
        ...params,
      ),
      env.DB.prepare(
        "SELECT DISTINCT category FROM items WHERE deleted_at IS NULL ORDER BY category",
      ),
      env.DB.prepare(
        "SELECT provider,COUNT(*) AS count FROM items WHERE deleted_at IS NULL GROUP BY provider",
      ),
    ]);
    return json({
      items: (rows.results as Row[]).map(fromRow),
      total: (count.results[0] as { count: number }).count,
      categories: (categories.results as { category: string }[]).map(
        (r) => r.category,
      ),
      stats: stats.results,
      page,
    });
  }
  if (path === "/api/items" && request.method === "POST") {
    const input = validateItem(await body(request));
    const result = await insert(env, input).run();
    if (!result.meta.changes)
      throw new AppError(
        409,
        "무료 개인용 자료함은 휴지통 포함 500개까지 저장할 수 있습니다.",
      );
    const row = await env.DB.prepare("SELECT * FROM items WHERE url=?")
      .bind(input.url)
      .first<Row>();
    return json({ item: fromRow(row!) }, 201);
  }
  const match = path.match(/^\/api\/items\/([a-f0-9-]{36})(\/restore)?$/);
  if (match) {
    if (
      !(["PUT", "DELETE"].includes(request.method) && !match[2]) &&
      !(request.method === "POST" && match[2])
    )
      throw new AppError(405, "지원하지 않는 요청입니다.");
    const id = match[1],
      b = await body(request),
      v = version(b);
    let result: D1Result;
    if (request.method === "PUT" && !match[2]) {
      const input = validateItem(b);
      result = await env.DB.prepare(
        "UPDATE items SET provider=?,url=?,title=?,description=?,category=?,tags=?,notes=?,pinned=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL",
      )
        .bind(...fields(input), now(), id, v)
        .run();
    } else if (request.method === "DELETE" && !match[2]) {
      result = await env.DB.prepare(
        "UPDATE items SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL",
      )
        .bind(now(), now(), id, v)
        .run();
    } else if (request.method === "POST" && match[2]) {
      result = await env.DB.prepare(
        "UPDATE items SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NOT NULL",
      )
        .bind(now(), id, v)
        .run();
    } else throw new AppError(405, "지원하지 않는 요청입니다.");
    if (!result.meta.changes)
      throw new AppError(
        409,
        "다른 창에서 변경된 자료입니다. 새로고침 후 다시 시도해 주세요.",
      );
    return json({ ok: true });
  }
  if (path === "/api/export" && request.method === "GET") {
    const data = await env.DB.prepare(
      "SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at",
    ).all<Row>();
    return json({
      format: "coreline-personal-v1",
      exportedAt: now(),
      items: data.results.map(fromRow),
    });
  }
  if (path === "/api/import" && request.method === "POST") {
    const input = validateBackup(await body(request));
    if (input.length > 20)
      throw new AppError(400, "한 번에 20개까지 가져올 수 있습니다.");
    if (!input.length) return json({ inserted: 0, skipped: 0 });
    const results = await env.DB.batch(
      input.map((item) => insert(env, item, true)),
    );
    const inserted = results.reduce((sum, r) => sum + (r.meta.changes || 0), 0);
    return json({ inserted, skipped: input.length - inserted });
  }
  if (path.startsWith("/api/") || path.startsWith("/auth/"))
    throw new AppError(404, "요청한 기능을 찾을 수 없습니다.");
  if (!["GET", "HEAD"].includes(request.method))
    throw new AppError(405, "지원하지 않는 요청입니다.");
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request: Request, env: Env) {
    try {
      return protect(await handle(request, env));
    } catch (error) {
      if (error instanceof AppError)
        return protect(json({ error: error.message }, error.status));
      if (error instanceof Error && error.message.includes("UNIQUE constraint"))
        return protect(
          json(
            { error: "이미 등록된 주소입니다. 휴지통도 확인해 주세요." },
            409,
          ),
        );
      // Never include database queries, OAuth tokens, or private item contents in logs/errors.
      console.error("personal_request_failed", {
        path: new URL(request.url).pathname,
      });
      return protect(
        json(
          { error: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
          500,
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
