import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let dbPath: string;
let appId: string;

const VALID_MANIFEST = {
  storages: [{ key: "todos", kind: "table", description: "Liste des tâches" }],
  tools: [
    {
      name: "add",
      description: "Ajoute une tâche à la liste",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      storage: { op: "append", key: "todos" },
    },
    {
      name: "toggle",
      description: "Marque une tâche faite/non faite",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      storage: { op: "toggle", key: "todos" },
    },
    {
      name: "remove",
      description: "Supprime une tâche",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      storage: { op: "remove", key: "todos" },
    },
    { name: "get", description: "Lit la liste des tâches", storage: { op: "get", key: "todos" } },
  ],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-manifest-"));
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

  const { db, tables } = await import("@/db/client");
  const userId = "user-manifest-1";
  await db.insert(tables.user).values({
    id: userId,
    name: "Test",
    email: "manifest@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const { createApp } = await import("@/services/apps/apps");
  appId = (await createApp(userId, { name: "Todos App" })).id;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

describe("manifest schema / extraction", () => {
  it("extrait et valide un manifeste depuis le HTML", async () => {
    const { extractManifestFromHtml } = await import("@/services/apps/manifest");
    const html = `<html><body><div>todo</div>
<script type="application/json" id="home-manifest">${JSON.stringify(VALID_MANIFEST)}</script>
</body></html>`;
    const manifest = extractManifestFromHtml(html);
    expect(manifest).not.toBeNull();
    expect(manifest!.tools).toHaveLength(4);
    expect(manifest!.storages?.[0].key).toBe("todos");
  });

  it("retourne null si absent ou invalide", async () => {
    const { extractManifestFromHtml, parseManifest } = await import(
      "@/services/apps/manifest"
    );
    expect(extractManifestFromHtml("<html><body></body></html>")).toBeNull();
    expect(
      extractManifestFromHtml(
        `<script type="application/json" id="home-manifest">{"tools":"nope"}</script>`,
      ),
    ).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('{"tools":[{"name":"2bad","storage":{"op":"get","key":"x"}}]}')).toBeNull();
  });

  it("conversion JSON Schema → zod valide les args", async () => {
    const { jsonSchemaToZod } = await import("@/services/apps/manifest");
    const schema = jsonSchemaToZod(VALID_MANIFEST.tools[0].parameters);
    expect(schema.safeParse({ text: "acheter du lait" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false); // required manquant
  });
});

describe("executeManifestTool", () => {
  it("append ajoute un élément avec id, puis get le relit", async () => {
    const { executeManifestTool } = await import("@/services/apps/manifest");
    const { appScope, storageGet } = await import("@/services/storage/storage");
    const tool = VALID_MANIFEST.tools[0] as (typeof VALID_MANIFEST.tools)[number];

    const item = (await executeManifestTool(appId, tool as never, { text: "acheter du lait" })) as {
      id: string;
      text: string;
    };
    expect(item.id).toBeTruthy();
    expect(item.text).toBe("acheter du lait");

    const list = (await executeManifestTool(appId, VALID_MANIFEST.tools[3] as never, {})) as {
      value: unknown;
    };
    expect(list.value).toEqual([{ id: item.id, text: "acheter du lait" }]);
    expect(await storageGet(appScope(appId), "todos")).toEqual([{ id: item.id, text: "acheter du lait" }]);
  });

  it("toggle bascule done par id", async () => {
    const { executeManifestTool } = await import("@/services/apps/manifest");
    const { appScope, storageSet } = await import("@/services/storage/storage");
    await storageSet(appScope(appId), "todos", [{ id: "a", text: "t", done: false }]);

    const toggled = (await executeManifestTool(appId, VALID_MANIFEST.tools[1] as never, {
      id: "a",
    })) as { done: boolean };
    expect(toggled.done).toBe(true);
    expect(
      (await executeManifestTool(appId, VALID_MANIFEST.tools[1] as never, { id: "a" })) as {
        done: boolean;
      },
    ).toEqual({ ...toggled, done: false });
  });

  it("remove supprime par id", async () => {
    const { executeManifestTool } = await import("@/services/apps/manifest");
    const { appScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(appScope(appId), "todos", [
      { id: "a", text: "t1" },
      { id: "b", text: "t2" },
    ]);

    const res = (await executeManifestTool(appId, VALID_MANIFEST.tools[2] as never, {
      id: "a",
    })) as { removed: number };
    expect(res.removed).toBe(1);
    expect(await storageGet(appScope(appId), "todos")).toEqual([{ id: "b", text: "t2" }]);
  });
});