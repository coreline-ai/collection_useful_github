import { AppError } from "../personal/shared";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  OWNER_GITHUB_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}
export type Session = {
  token_hash: string;
  login: string;
  user_id: string;
  csrf: string;
  expires_at: number;
};
const cookieName = "__Host-coreline_session";
const stateCookie = "__Host-coreline_oauth";
export const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const cookie = (name: string, value: string, age: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function readCookie(request: Request, name: string) {
  return (
    (request.headers.get("Cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
export function configured(env: Env) {
  return (
    /^https:\/\/[^/]+$/.test(env.APP_ORIGIN || "") &&
    /^\d+$/.test(env.OWNER_GITHUB_ID || "") &&
    Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
  );
}
export async function sessionFor(
  request: Request,
  env: Env,
): Promise<Session | null> {
  if (!configured(env)) return null;
  const token = readCookie(request, cookieName);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND user_id = ?",
  )
    .bind(await sha256(token), Date.now(), env.OWNER_GITHUB_ID)
    .first<Session>();
  return session || null;
}
export function checkMutation(request: Request, env: Env, session: Session) {
  if (
    request.headers.get("Origin") !== env.APP_ORIGIN ||
    request.headers.get("X-CSRF-Token") !== session.csrf
  )
    throw new AppError(
      403,
      "요청 검증에 실패했습니다. 새로고침 후 다시 시도해 주세요.",
    );
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new AppError(415, "JSON 요청만 허용됩니다.");
}
export async function throttle(
  env: Env,
  key: string,
  limit: number,
  windowMs = 60_000,
) {
  const bucket = Math.floor(Date.now() / windowMs);
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key, count, expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(`${key}:${bucket}`, (bucket + 1) * windowMs)
    .first<{ count: number }>();
  if (!row || row.count > limit)
    throw new AppError(429, "요청이 많습니다. 잠시 후 다시 시도해 주세요.");
}
export async function login(request: Request, env: Env) {
  if (!configured(env))
    throw new AppError(
      503,
      "개인 로그인 설정을 준비하고 있습니다. 자료 접근은 차단되어 있습니다.",
    );
  const ipHash = await sha256(
    request.headers.get("CF-Connecting-IP") || "unknown",
  );
  await throttle(env, `login:${ipHash}`, 12, 3600_000);
  const state = random(),
    verifier = random();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(
      Date.now(),
    ),
    env.DB.prepare(
      "INSERT INTO oauth_states(state_hash,verifier,expires_at) VALUES (?,?,?)",
    ).bind(await sha256(state), verifier, Date.now() + 600_000),
  ]);
  const challenge = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const target = new URL("https://github.com/login/oauth/authorize");
  target.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
    state,
    scope: "",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      "Set-Cookie": cookie(stateCookie, state, 600),
    },
  });
}
export async function callback(request: Request, env: Env) {
  if (!configured(env))
    throw new AppError(503, "로그인 설정이 완료되지 않았습니다.");
  const url = new URL(request.url),
    state = url.searchParams.get("state") || "",
    code = url.searchParams.get("code") || "";
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    state !== readCookie(request, stateCookie) ||
    !code ||
    code.length > 512
  )
    throw new AppError(
      400,
      "로그인이 만료되었거나 취소되었습니다. 다시 시작해 주세요.",
    );
  const pending = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING verifier",
  )
    .bind(await sha256(state), Date.now())
    .first<{ verifier: string }>();
  if (!pending)
    throw new AppError(400, "이미 사용되었거나 만료된 로그인입니다.");
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${env.APP_ORIGIN}/auth/callback`,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const token = (await tokenResponse.json()) as {
    access_token?: string;
    scope?: string;
  };
  if (
    !tokenResponse.ok ||
    !token.access_token ||
    (token.scope || "").trim() !== ""
  )
    throw new AppError(
      502,
      "GitHub 인증에 실패했습니다. 다시 로그인해 주세요.",
    );
  const userResponse = await fetch("https://api.github.com/user", {
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Coreline-Personal-Library",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const user = (await userResponse.json()) as { id?: number; login?: string };
  if (
    !userResponse.ok ||
    String(user.id) !== env.OWNER_GITHUB_ID ||
    !user.login
  )
    throw new AppError(403, "이 자료함은 소유자 계정만 이용할 수 있습니다.");
  // The provider token is never persisted or sent to the browser.
  const sessionToken = random(),
    csrf = random(),
    age = 7 * 24 * 3600;
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,login,user_id,csrf,expires_at) VALUES (?,?,?,?,?)",
  )
    .bind(
      await sha256(sessionToken),
      user.login,
      String(user.id),
      csrf,
      Date.now() + age * 1000,
    )
    .run();
  const headers = new Headers({ Location: env.APP_ORIGIN });
  headers.append("Set-Cookie", cookie(cookieName, sessionToken, age));
  headers.append("Set-Cookie", cookie(stateCookie, "", 0));
  return new Response(null, { status: 302, headers });
}
export async function logout(env: Env, session: Session) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
    .bind(session.token_hash)
    .run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie(cookieName, "", 0),
    },
  });
}
