// Local synthetic QA only. Never deployed; never connects to production D1/GitHub.
import { createServer } from "node:http";
import { fixture, origin } from "../../personal-tests/runtime.mjs";
const f = await fixture();
const { cookie } = await f.authenticate();
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== "127.0.0.1:8788") {
      res.writeHead(403).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(key, value);
    headers.set("Cookie", cookie);
    if (headers.get("Origin") === "http://127.0.0.1:8788")
      headers.set("Origin", origin);
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const response = await f.fetch(req.url, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    res.writeHead(
      response.status,
      Object.fromEntries(
        [...response.headers].filter(([key]) => key !== "set-cookie"),
      ),
    );
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end("Local QA error");
  }
});
server.listen(8788, "127.0.0.1", () =>
  console.log(
    "Synthetic local QA: http://127.0.0.1:8788 (no real account/data)",
  ),
);
async function stop() {
  server.close();
  await f.mf.dispose();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
