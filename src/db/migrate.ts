/**
 * Applique les migrations SQLite au démarrage du conteneur.
 *
 * Exécuté par `docker-entrypoint.sh` avant le serveur Next, via le strip-types
 * natif de Node 24 (`node src/db/migrate.ts`). Volontairement autonome : pas
 * d'import de `@/lib/env` ni du schéma, seul le chemin du fichier est requis
 * (l'alias `@/` n'est pas résolu par `node`).
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

// La migration 0011 rebuild l'ancienne table `crons` (aujourd'hui `scripts`) via
// `DROP TABLE crons` alors que `cron_runs`/`cron_versions`/`cron_storage`
// le référencent. Le migrateur drizzle wrap tout dans un `BEGIN` (sqlite-core/dialect.js:657), or
// `PRAGMA foreign_keys=OFF` dans le SQL est sans effet à l'intérieur
// d'une transaction (SQLite). On coupe donc les FK *avant* le BEGIN.
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

// Garde-fou : échoue vite si une migration a laissé des violations.
const violations = sqlite.pragma("foreign_key_check") as unknown[];
if (violations.length) {
  sqlite.close();
  throw new Error(`Vérification foreign_key_check échouée: ${JSON.stringify(violations)}`);
}

sqlite.close();

console.log(`✓ Migrations SQLite appliquées (${path})`);
