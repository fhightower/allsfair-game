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
// D1. The frontend, the API and the engine are all the deployed code;
// only the runtime around them is Node instead of workerd.
//
// Not a substitute for the deploy smoke test — this does not exercise real D1
// or the platform's assets binding.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { type Env } from "../src/index";
import { createSqliteDb } from "./d1-shim";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, "../public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Serves anything under public/, the way the platform's assets binding does in
 * production. It used to serve index.html alone, which was enough until the bot
 * arrived as a second asset (public/bot.js, built by `npm run build:bot`).
 *
 * Paths are resolved and then checked to still be inside public/, so a request
 * for ../../etc/passwd cannot escape. This is a loopback-only dev server, but a
 * traversal bug is not worth leaving in either way.
 */
function serveAsset(pathname: string, res: ServerResponse): boolean {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return false;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return false;

  res.writeHead(200, {
    "content-type":
      CONTENT_TYPES[path.extname(resolved)] ?? "application/octet-stream",
    // The bot bundle is rebuilt often enough that a cached copy is a trap.
    "cache-control": "no-store",
  });
  res.end(readFileSync(resolved));
  return true;
}
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
    // production, so the worker 404s them; serve them here instead.
    if (req.method === "GET" && url.pathname !== "/api") {
      if (serveAsset(url.pathname, res)) return;
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
        `  pkill -f "tsx test/serve.ts"   (or set PORT=... for a different one)`
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
  console.log("Ctrl-C to stop.");
});
