import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StorageScope } from "@/services/storage/storage";

let dir: string;
let dbPath: string;
let ownerId: string;
let otherId: string;
/** Une portée par variante : les mêmes cas tournent sur les trois. */
let scopes: { label: string; scope: StorageScope }[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "homeai-store-"));
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
  ownerId = "user-store-1";
  otherId = "user-store-2";
  for (const [id, email] of [
    [ownerId, "owner@test.com"],
    [otherId, "other@test.com"],
  ] as const) {
    await db.insert(tables.user).values({
      id,
      name: "Test",
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const { createApp } = await import("@/services/apps/apps");
  const { createScript } = await import("@/services/scripts/scripts");
  const { appScope, scriptScope, globalScope } = await import("@/services/storage/storage");
  const appId = (await createApp(ownerId, { name: "Store App" })).id;
  const scriptId = await createScript({
    ownerId,
    name: "Store Script",
    schedule: "0 * * * *",
    code: "async function main(home) {}",
  });

  scopes = [
    { label: "app", scope: appScope(appId) },
    { label: "script", scope: scriptScope(scriptId) },
    { label: "global", scope: globalScope(ownerId) },
  ];
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SQLITE_PATH;
});

// ---------------------------------------------------------------------------
// Comportements communs aux trois portées
// ---------------------------------------------------------------------------

describe("storage KV (round-trip JSON)", () => {
  it("conserve un tableau d'objets sans le réduire en chaîne", async () => {
    const { storageGet, storageSet } = await import("@/services/storage/storage");
    const taches = [
      { id: "a", titre: "Arroser", terminee: false, creation: 123 },
      { id: "b", titre: "Goûter", terminee: true, creation: 456 },
    ];
    for (const { label, scope } of scopes) {
      await storageSet(scope, "todo", taches);
      const back = await storageGet(scope, "todo");
      expect(back, label).toEqual(taches);
      expect(Array.isArray(back), label).toBe(true);
    }
  });

  it("préserve un nombre stocké en chaîne", async () => {
    const { storageGet, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "counter", "42");
      expect(await storageGet(scope, "counter"), label).toBe("42");
    }
  });

  it("liste les clés avec valeurs parsées", async () => {
    const { storageList, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "extra", { a: 1 });
      const list = await storageList(scope);
      expect(list.find((e) => e.key === "extra")?.value, label).toEqual({ a: 1 });
    }
  });

  it("conserve kind et schema sur les trois portées", async () => {
    const { storageGetMeta, storageSet } = await import("@/services/storage/storage");
    const schema = { columns: [{ key: "id" }, { key: "done" }] };
    for (const { label, scope } of scopes) {
      await storageSet(scope, "typed", [{ id: "a", done: false }], { kind: "table", schema });
      const meta = await storageGetMeta(scope, "typed");
      expect(meta?.kind, label).toBe("table");
      expect(meta?.schema, label).toEqual(schema);
    }
  });

  it("expose updatedAt en ISO", async () => {
    const { storageList, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "stamped", 1);
      const entry = (await storageList(scope)).find((e) => e.key === "stamped");
      expect(typeof entry?.updatedAt, label).toBe("string");
      expect(Number.isFinite(new Date(entry!.updatedAt).getTime()), label).toBe(true);
    }
  });

  it("baseUpdatedAt périmé → StorageConflictError, à jour → ok", async () => {
    const { storageGet, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      const v1 = await storageSet(scope, "conflict-key", { n: 1 });
      await expect(
        storageSet(scope, "conflict-key", { n: 2 }, { baseUpdatedAt: new Date(0).toISOString() }),
        label,
      ).rejects.toThrow();
      await storageSet(scope, "conflict-key", { n: 3 }, { baseUpdatedAt: v1 });
      expect(await storageGet(scope, "conflict-key"), label).toEqual({ n: 3 });
    }
  });

  it("supprime une clé, puis vide la portée", async () => {
    const { storageClear, storageDelete, storageGet, storageList, storageSet } = await import(
      "@/services/storage/storage"
    );
    for (const { label, scope } of scopes) {
      await storageSet(scope, "a", 1);
      await storageSet(scope, "b", 2);
      await storageDelete(scope, "a");
      expect(await storageGet(scope, "a"), label).toBeNull();
      expect((await storageList(scope)).length, label).toBeGreaterThan(0);
      await storageClear(scope);
      expect(await storageList(scope), label).toEqual([]);
    }
  });
});

describe("storageRowOp (opérations ligne atomiques)", () => {
  it("add / update / toggle / removeMany sur une table existante", async () => {
    const { storageGet, storageRowOp, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "list", [{ id: "a", label: "Lait", done: false }]);

      const added = await storageRowOp(scope, "list", { kind: "add", row: { id: "z", label: "Café" } });
      expect((await storageGet(scope, "list")) as unknown[], label).toHaveLength(2);
      expect(added.changed, label).toEqual({ id: "z", label: "Café" });

      await storageRowOp(scope, "list", { kind: "update", id: "a", patch: { done: true } });
      const rows = (await storageGet(scope, "list")) as Record<string, unknown>[];
      expect(rows.find((r) => r.id === "a")?.done, label).toBe(true);

      const toggled = await storageRowOp(scope, "list", { kind: "toggle", id: "a" });
      expect(toggled.changed, label).toEqual({ id: "a", label: "Lait", done: false });

      const removed = await storageRowOp(scope, "list", { kind: "removeMany", ids: ["a", "z"] });
      expect(removed.removed, label).toBe(2);
      expect(await storageGet(scope, "list"), label).toEqual([]);
    }
  });

  it("crée la clé à la volée sur add d'une clé absente", async () => {
    const { storageGet, storageRowOp } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      const res = await storageRowOp(scope, "fresh-table", { kind: "add", row: { id: "x" } });
      expect(res.rows, label).toHaveLength(1);
      expect(await storageGet(scope, "fresh-table"), label).toEqual([{ id: "x" }]);
    }
  });

  it("jette StorageRowError pour update introuvable et valeur non-table", async () => {
    const { storageRowOp, storageSet } = await import("@/services/storage/storage");
    const { StorageRowError } = await import("@/lib/errors");
    for (const { label, scope } of scopes) {
      await expect(
        storageRowOp(scope, "ghost", { kind: "update", id: "a", patch: {} }),
        label,
      ).rejects.toThrowError(StorageRowError);
      await storageSet(scope, "not-a-table", "chaîne");
      await expect(
        storageRowOp(scope, "not-a-table", { kind: "toggle", id: "a" }),
        label,
      ).rejects.toThrowError(StorageRowError);
    }
  });
});

// ---------------------------------------------------------------------------
// Spécifique à la portée globale : visibilité private/family
// ---------------------------------------------------------------------------

describe("storage global (visibilité)", () => {
  it("expose la visibilité dans les métadonnées", async () => {
    const { globalScope, storageGetMeta, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "todos", [{ id: "a" }], {
      kind: "table",
      visibility: "family",
    });
    const meta = await storageGetMeta(globalScope(ownerId), "todos");
    expect(meta?.visibility).toBe("family");
  });

  it("laisse un autre utilisateur lire une clé family mais pas private", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "partage", "valeur-commune", { visibility: "family" });
    await storageSet(globalScope(ownerId), "secret", "perso");
    expect(await storageGet(globalScope(otherId), "partage")).toBe("valeur-commune");
    expect(await storageGet(globalScope(otherId), "secret")).toBeNull();
  });

  it("privilégie sa propre clé sur la clé partagée", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "compteur", 1, { visibility: "family" });
    await storageSet(globalScope(otherId), "compteur", 2);
    expect(await storageGet(globalScope(ownerId), "compteur")).toBe(1);
    expect(await storageGet(globalScope(otherId), "compteur")).toBe(2);
  });

  it("liste les siennes + les family, sans les private des autres", async () => {
    const { globalScope, storageClear, storageList, storageSet } = await import(
      "@/services/storage/storage"
    );
    await storageClear(globalScope(ownerId));
    await storageClear(globalScope(otherId));
    await storageSet(globalScope(ownerId), "a", 1);
    await storageSet(globalScope(ownerId), "b", 2, { visibility: "family" });
    await storageSet(globalScope(otherId), "c", 3, { visibility: "family" });
    await storageSet(globalScope(otherId), "d", 4);
    const keys = (await storageList(globalScope(ownerId))).map((e) => e.key).sort();
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("ne supprime que ses propres clés", async () => {
    const { globalScope, storageClear, storageDelete, storageGet, storageSet } = await import(
      "@/services/storage/storage"
    );
    await storageClear(globalScope(ownerId));
    await storageClear(globalScope(otherId));
    await storageSet(globalScope(ownerId), "partage", "valeur-commune", { visibility: "family" });
    await storageDelete(globalScope(otherId), "partage");
    expect(await storageGet(globalScope(ownerId), "partage")).toBe("valeur-commune");
    await storageDelete(globalScope(ownerId), "partage");
    expect(await storageGet(globalScope(ownerId), "partage")).toBeNull();
  });

  it("vide toutes ses clés sans toucher à celles des autres", async () => {
    const { globalScope, storageClear, storageList, storageSet } = await import(
      "@/services/storage/storage"
    );
    await storageClear(globalScope(ownerId));
    await storageClear(globalScope(otherId));
    await storageSet(globalScope(ownerId), "a", 1);
    await storageSet(globalScope(otherId), "c", 3, { visibility: "family" });
    await storageClear(globalScope(ownerId));
    const keys = (await storageList(globalScope(ownerId))).map((e) => e.key);
    expect(keys).toContain("c");
    expect(keys).not.toContain("a");
  });

  it("une clé private ne fuit pas via la portée app ou script", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "cloison", "global-only");
    for (const { label, scope } of scopes) {
      if (scope.kind === "global") continue;
      expect(await storageGet(scope, "cloison"), label).toBeNull();
    }
  });
});
