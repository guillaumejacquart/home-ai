import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-conn-"));
  dbPath = join(dir, "test.db");
  process.env.SQLITE_PATH = dbPath;
  process.env.ENCRYPTION_KEY = "test-encryption-key-12345678901234567890";

  // Runs migrations on the temp db, then dynamically imports the DB client
  // (lazy client → will open the same file).
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

describe("connections (db)", () => {
  it("creates, lists and reads an SMTP connection without exposing the password", async () => {
    const { createConnection, getConnection, listConnections } = await import(
      "@/services/connections/connections"
    );
    const { db, tables } = await import("@/db/client");
    const userId = "user-1";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "test@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const id = await createConnection(userId, {
      type: "smtp",
      label: "Personal inbox",
      data: { host: "smtp.example.com", port: 465, secure: true, user: "u", pass: "secret" },
    });

    const rows = await listConnections(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Personal inbox");
    // The encrypted config must not leak into the list.
    expect(JSON.stringify(rows)).not.toContain("secret");

    const row = await getConnection(userId, id);
    expect(row).toBeTruthy();
    // The raw config is encrypted (no plaintext secret).
    expect(JSON.stringify(row!.config)).not.toContain("secret");
  });
});
