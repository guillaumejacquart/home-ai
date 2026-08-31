/**
 * Applies SQLite migrations at container startup.
 *
 * Run by `docker-entrypoint.sh` before the Next server, via Node 24's native
 * strip-types (`node src/db/migrate.ts`). Deliberately standalone: no import
 * of `@/lib/env` or the schema, only the file path is required (the `@/`
 * alias isn't resolved by `node`).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const Database = createRequire(import.meta.url)("better-sqlite3");

const path = process.env.SQLITE_PATH ?? "./local.db";
mkdirSync(dirname(path), { recursive: true });

const sqlite = new Database(path);
sqlite.pragma("journal_mode = WAL");

// Migration 0011 rebuilds the old `crons` table (now `scripts`) via
// `DROP TABLE crons`, while `cron_runs`/`cron_versions`/`cron_storage` still
// reference it. Drizzle's migrator wraps everything in a `BEGIN`
// (sqlite-core/dialect.js:657), but `PRAGMA foreign_keys=OFF` in the SQL has
// no effect inside a transaction (SQLite). So we turn off FKs *before* the BEGIN.
sqlite.pragma("foreign_keys = OFF");

let migrateError: unknown;
try {
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
} catch (e) {
  migrateError = e;
} finally {
  sqlite.pragma("foreign_keys = ON");
}

if (migrateError) {
  sqlite.close();
  throw migrateError;
}

// Safety net: fail fast if a migration left foreign key violations behind.
const violations = sqlite.pragma("foreign_key_check") as unknown[];
if (violations.length) {
  sqlite.close();
  throw new Error(`foreign_key_check failed: ${JSON.stringify(violations)}`);
}

sqlite.close();

console.log(`✓ SQLite migrations applied (${path})`);
