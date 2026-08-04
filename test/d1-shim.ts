// Minimal D1Database stand-in backed by node:sqlite, for running tests on
// machines where workerd/miniflare can't run (needs macOS 13.5+). D1 is
// SQLite, so the dialect matches; only the D1 client surface used by src/db.ts
// is implemented. Real D1 behavior is verified by the deploy smoke test.
//
// One class of bug it cannot surface: node:sqlite is synchronous, so the
// count-guarded writes in `writeBotMoveIfCountMatches` can never actually
// interleave here. Concurrency behaviour has to be checked against real D1.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createTestDb(): D1Database {
  return createSqliteDb(":memory:");
}

/**
 * The same stand-in over an arbitrary SQLite file, so `test/eval/serve.ts` can
 * run the real worker locally. Applying the schema is skipped when the file
 * already has it — the migration uses plain CREATE TABLE, which would throw on
 * a second open.
 */
export function createSqliteDb(filename: string): D1Database {
  const db = new DatabaseSync(filename);
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
    .get();
  if (!existing) {
    // Every migration in order, not just the first — a second one would
    // otherwise be silently missing from the tests and from `npm run serve`.
    const dir = path.join(here, "../migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      db.exec(readFileSync(path.join(dir, file), "utf8"));
    }
  }
  return { prepare: (sql: string) => statement(db, sql, []) } as D1Database;
}

function statement(
  db: DatabaseSync,
  sql: string,
  params: SQLInputValue[]
): D1PreparedStatement {
  return {
    bind: (...values: SQLInputValue[]) => statement(db, sql, values),
    async first<T>() {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>() {
      return { results: db.prepare(sql).all(...params) as T[] };
    },
    async run() {
      const result = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  } as unknown as D1PreparedStatement;
}
