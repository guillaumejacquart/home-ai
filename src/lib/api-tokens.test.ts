import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-tokens-"));
  dbPath = join(dir, "test.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";

  const { createRequire } = await import("node:module");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();

  await import("@/db/client");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

describe("api tokens", () => {
  async function seedUser(id: string, email: string) {
    const { db, tables } = await import("@/db/client");
    await db.insert(tables.user).values({
      id,
      name: "Test",
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("extrait un jeton Bearer du préfixe hai_", async () => {
    const { extractBearerToken } = await import("@/lib/api-tokens");
    expect(extractBearerToken("Bearer hai_abcd1234")).toBe("hai_abcd1234");
    expect(extractBearerToken("bearer  hai_x")).toBe("hai_x");
    expect(extractBearerToken("Bearer token-sans-prefixe")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
  });

  it("crée, résout et révoque un token", async () => {
    const { createApiToken, resolveApiToken, revokeApiToken, listApiTokens } =
      await import("@/lib/api-tokens");
    await seedUser("user-token-1", "token1@example.com");

    const raw = await createApiToken("user-token-1", "hermes");
    expect(raw.startsWith("hai_")).toBe(true);

    // Le clair n'est pas stocké : on retrouve l'utilisateur par empreinte.
    expect(await resolveApiToken(raw)).toEqual({ userId: "user-token-1" });
    // Un jeton inconnu ne résout rien.
    expect(await resolveApiToken("hai_ffffffffffffffffffffffffffffffffffffffffffffff")).toBeNull();

    const list = await listApiTokens("user-token-1");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("hermes");
    // Les champs sensibles ne sont pas exposés.
    expect(list[0]).not.toHaveProperty("tokenHash");

    // Après révocation, le même jeton ne résout plus.
    await revokeApiToken("user-token-1", list[0].id);
    expect(await resolveApiToken(raw)).toBeNull();
  });

  it("n'expose les tokens que de leur propriétaire", async () => {
    const { createApiToken, listApiTokens, revokeApiToken, resolveApiToken } =
      await import("@/lib/api-tokens");
    await seedUser("user-token-2", "token2@example.com");
    await seedUser("user-token-3", "token3@example.com");

    const raw = await createApiToken("user-token-2", "privé");
    expect(await listApiTokens("user-token-3")).toHaveLength(0);

    // Révoquer un token d'un autre utilisateur lève une erreur.
    const list2 = await listApiTokens("user-token-2");
    await expect(revokeApiToken("user-token-3", list2[0].id)).rejects.toThrow();
    expect(await resolveApiToken(raw)).toEqual({ userId: "user-token-2" });
  });
});
