// Run the real app locally in a browser, without workerd.
//
//   npm run serve                     # http://localhost:8787
//   PORT=3000 npm run serve
//   ALLSFAIR_DB=local.db npm run serve   # persist games across restarts
//
// Use the npm script rather than tsx directly: node:sqlite is behind
// --experimental-sqlite on this Node version, which the script sets.
//
// `wrangler dev` needs workerd, which needs macOS 13.5+ — the same reason
// test/d1-shim.ts exists. This gets the same result a different way: a plain
// node:http server that serves public/index.html and hands every other request
// to the actual worker entry point (src/index.ts) with the shim standing in for
// D1. The frontend, the API, the engine and the bot are all the deployed code;
// only the runtime around them is Node instead of workerd.
//
// Not a substitute for the deploy smoke test — this does not exercise real D1
// or the platform's assets binding.
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { type Env } from "../../src/index";
import { createSqliteDb } from "../d1-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(here, "../../public/index.html");
const port = Number(process.env.PORT ?? 8787);
const env: Env = { DB: createSqliteDb(process.env.ALLSFAIR_DB ?? ":memory:") };

// The worker's fetch signature is Cloudflare's; Node's Request/Response are
// structurally different types for the same runtime shapes, so the boundary is
// cast once here rather than threaded through.
type WorkerFetch = (
  request: unknown,
  env: Env,
  ctx: unknown
) => Promise<{ status: number; headers: Headers; text(): Promise<string> }>;
const fetchWorker = worker.fetch as unknown as WorkerFetch;
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    // Static assets are served by the platform before the worker runs in
    // production, so the worker 404s them; serve the one asset there is.
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = readFileSync(INDEX);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    const body = await readBody(req);
    const request = new Request(url.toString(), {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : []
      ),
      body: body.length > 0 ? body : undefined,
    });

    const response = await fetchWorker(request, env, ctx);
    const text = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(text);
    console.log(`${req.method} ${url.pathname} -> ${response.status}`);
  } catch (error) {
    console.error(`${req.method} ${url.pathname} failed:`, error);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Local server error — see the terminal.");
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use — another copy is probably still running.\n` +
        `  pkill -f "tsx test/eval/serve.ts"   (or set PORT=... for a different one)`
    );
  } else {
    console.error("Local server failed to start:", error);
  }
  process.exit(1);
});

// Loopback only: this is a dev server with no auth, and binding the IPv6 any
// address also made a stale process holding 127.0.0.1 invisible — the new server
// bound ::, reported success, and every request went to the old one.
server.listen(port, "127.0.0.1", () => {
  console.log(`Allsfair running at http://localhost:${port}`);
  console.log(
    process.env.ALLSFAIR_DB
      ? `Games stored in ${process.env.ALLSFAIR_DB}`
      : "Games are in memory — they vanish when this stops."
  );
  console.log("Tick 'play against the bot' when creating a game. Ctrl-C to stop.");
});
