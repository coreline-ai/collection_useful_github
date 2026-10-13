// Isolated test-only workerd/D1 fixture. Never imported by the production Worker.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
export const origin = "https://library.example.com";
export async function fixture({ ready = true } = {}) {
  let userId = 123,
    scope = "";
  const calls = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: ".personal-test-build/index.js",
      compatibilityDate: "2026-10-13",
      d1Databases: ["DB"],
      bindings: {
        APP_ORIGIN: origin,
        OWNER_GITHUB_ID: "123",
        GITHUB_CLIENT_ID: "synthetic-client",
        GITHUB_CLIENT_SECRET: ready ? "synthetic-secret" : "",
      },
      serviceBindings: {
        ASSETS: async (request) => {
          const pathname = new URL(request.url).pathname;
          let filename = resolve(
            "dist-personal",
            `.${pathname === "/" ? "/index.html" : pathname}`,
          );
          if (!filename.startsWith(resolve("dist-personal") + "/"))
            return new Response("not found", { status: 404 });
          try {
            return new Response(await readFile(filename), {
              headers: {
                "Content-Type":
                  {
                    ".html": "text/html",
                    ".js": "text/javascript",
                    ".css": "text/css",
                  }[extname(filename)] || "application/octet-stream",
              },
            });
          } catch {
            return new Response("not found", { status: 404 });
          }
        },
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push(url.origin + url.pathname);
        if (url.href === "https://github.com/login/oauth/access_token")
          return Response.json({
            access_token: "synthetic-provider-token",
            scope,
          });
        if (url.href === "https://api.github.com/user")
          return Response.json({
            id: userId,
            login: userId === 123 ? "test-owner" : "outsider",
          });
        if (url.pathname === "/repos/sample/redirect")
          return new Response(null, {
            status: 302,
            headers: { Location: "http://127.0.0.1/private" },
          });
        if (
          url.hostname === "api.github.com" &&
          url.pathname.startsWith("/repos/")
        )
          return Response.json({
            full_name: "sample/repo",
            description: "공개 GitHub 설명",
          });
        if (url.hostname === "www.youtube.com" && url.pathname === "/oembed")
          return Response.json({ title: "테스트 영상", author_name: "작성자" });
        throw new Error(
          "Unexpected external request: " + url.origin + url.pathname,
        );
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  const schema = await readFile("migrations/0001_personal.sql", "utf8");
  for (const statement of schema
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  const fetch = (path, options = {}) =>
    mf.dispatchFetch(origin + path, { redirect: "manual", ...options });
  async function authenticate() {
    const response = await fetch("/auth/login");
    const location = new URL(response.headers.get("location"));
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const state = location.searchParams.get("state");
    const result = await fetch(`/auth/callback?code=synthetic&state=${state}`, {
      headers: { Cookie: cookie },
    });
    return {
      response: result,
      start: response,
      state,
      cookie: result.headers
        .get("set-cookie")
        ?.match(/__Host-coreline_session=[a-f0-9]{64}/)?.[0],
    };
  }
  return {
    mf,
    db,
    fetch,
    authenticate,
    calls,
    setUser: (id) => (userId = id),
    setScope: (s) => (scope = s),
  };
}
