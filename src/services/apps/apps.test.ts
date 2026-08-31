import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-apps-"));
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

describe("apps (db)", () => {
  it("stores and reloads tags via createApp/updateApp/listApps", async () => {
    const { createApp, updateApp, listApps } = await import("@/services/apps/apps");
    const { db, tables } = await import("@/db/client");
    const userId = "user-apps-1";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "apps@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { id } = await createApp(userId, { name: "Recap", hasUi: true });

    await updateApp(userId, id, { tags: [" Family ", "groceries", "family"] });
    let rows = await listApps(userId);
    expect(rows[0].tags).toEqual(["family", "groceries"]);

    await updateApp(userId, id, { tags: [] });
    rows = await listApps(userId);
    expect(rows[0].tags).toEqual([]);
  });

  it("leaves the tags column NULL when no tag is set", async () => {
    const { createApp, listApps } = await import("@/services/apps/apps");
    const { db, tables } = await import("@/db/client");
    const userId = "user-apps-2";
    await db.insert(tables.user).values({
      id: userId,
      name: "Test",
      email: "apps2@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { id } = await createApp(userId, { name: "No tag" });
    const raw = db
      .select({ tags: tables.apps.tags })
      .from(tables.apps)
      .where(eq(tables.apps.id, id))
      .get();
    expect(raw?.tags).toBeNull();

    const rows = await listApps(userId);
    expect(rows.find((r) => r.id === id)?.tags).toEqual([]);
  });
});
