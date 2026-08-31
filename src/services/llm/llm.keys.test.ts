import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-keys-"));
  dbPath = join(dir, "test.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";
  // Clé env connue AVANT l'import de `@/lib/env` (module figé au chargement).
  process.env.OPENCODE_API_KEY = "env-key-test";
  delete process.env.OPENROUTER_API_KEY;

  const { createRequire } = await import("node:module");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

describe("clés API LLM (db > env)", () => {
  it("retombe sur l'env quand aucune clé en base", async () => {
    const { resolveApiKey, keySource, clearApiKey } = await import("@/services/llm/llm");
    await clearApiKey("opencode-go");

    expect(await keySource("opencode-go")).toBe("env");
    expect(await resolveApiKey("opencode-go")).toBe("env-key-test");
  });

  it("privilégie la clé en base sur l'env", async () => {
    const { resolveApiKey, keySource, setApiKey } = await import("@/services/llm/llm");
    await setApiKey("opencode-go", "db-key-secret");

    expect(await keySource("opencode-go")).toBe("db");
    expect(await resolveApiKey("opencode-go")).toBe("db-key-secret");
  });

  it("clearApiKey revient à l'env", async () => {
    const { resolveApiKey, keySource, clearApiKey } = await import("@/services/llm/llm");
    await clearApiKey("opencode-go");

    expect(await keySource("opencode-go")).toBe("env");
    expect(await resolveApiKey("opencode-go")).toBe("env-key-test");
  });

  it("resolveApiKey retourne null si aucune clé", async () => {
    const { resolveApiKey, keySource, clearApiKey } = await import("@/services/llm/llm");
    // openrouter : pas de clé env (supprimée dans beforeAll) ni de clé en base.
    await clearApiKey("openrouter");

    expect(await keySource("openrouter")).toBeNull();
    expect(await resolveApiKey("openrouter")).toBeNull();
  });
});