/**
 * better-sqlite3 + drizzle singleton (kept on globalThis so it survives Next.js dev HMR).
 * DB file: `${DATA_DIR ?? ./data}/gepa.db`. Migrations from `lib/db/migrations/` run on first open.
 */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../storage/paths";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

interface DbGlobal {
  db: Db;
  sqlite: Database.Database;
  file: string;
}

const GLOBAL_KEY = "__gepaDb" as const;

type G = typeof globalThis & { [GLOBAL_KEY]?: DbGlobal };

export function dbFilePath(): string {
  return path.join(dataDir(), "gepa.db");
}

export function migrationsFolder(): string {
  return path.resolve(process.cwd(), "lib", "db", "migrations");
}

function open(): DbGlobal {
  const file = dbFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  markOrphanRuns(db);
  return { db, sqlite, file };
}

/**
 * Runs left in `running` state belong to processes that died with the previous server
 * instance (nothing can resume streaming them). Mark them failed once per process start so the
 * one-active-run-per-stage guard does not block forever.
 */
function markOrphanRuns(db: Db): void {
  const now = new Date().toISOString();
  db.update(schema.runs)
    .set({ status: "failed", endedAt: now, error: "server restarted while the run was active" })
    .where(eq(schema.runs.status, "running"))
    .run();
}

export function getDb(): Db {
  const g = globalThis as G;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = open();
  return g[GLOBAL_KEY].db;
}

/** Callable alias of `getDb()` for modules that prefer `db()`. */
export const db = getDb;

export function getSqlite(): Database.Database {
  getDb();
  return (globalThis as G)[GLOBAL_KEY]!.sqlite;
}

/** Close and forget the singleton (tests). */
export function closeDb(): void {
  const g = globalThis as G;
  const cur = g[GLOBAL_KEY];
  if (!cur) return;
  try {
    cur.sqlite.close();
  } finally {
    delete g[GLOBAL_KEY];
  }
}

export { schema, dataDir };
