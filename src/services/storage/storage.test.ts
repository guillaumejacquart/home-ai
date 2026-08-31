import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StorageScope } from "@/services/storage/storage";

let dir: string;
let dbPath: string;
let ownerId: string;
let otherId: string;
/** One scope per variant: the same cases run against all three. */
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
// Behaviors shared across the three scopes
// ---------------------------------------------------------------------------

describe("storage KV (round-trip JSON)", () => {
  it("keeps an array of objects without collapsing it into a string", async () => {
    const { storageGet, storageSet } = await import("@/services/storage/storage");
    const chores = [
      { id: "a", title: "Water plants", done: false, creation: 123 },
      { id: "b", title: "Snack", done: true, creation: 456 },
    ];
    for (const { label, scope } of scopes) {
      await storageSet(scope, "todo", chores);
      const back = await storageGet(scope, "todo");
      expect(back, label).toEqual(chores);
      expect(Array.isArray(back), label).toBe(true);
    }
  });

  it("preserves a number stored as a string", async () => {
    const { storageGet, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "counter", "42");
      expect(await storageGet(scope, "counter"), label).toBe("42");
    }
  });

  it("lists keys with parsed values", async () => {
    const { storageList, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "extra", { a: 1 });
      const list = await storageList(scope);
      expect(list.find((e) => e.key === "extra")?.value, label).toEqual({ a: 1 });
    }
  });

  it("keeps kind and schema across the three scopes", async () => {
    const { storageGetMeta, storageSet } = await import("@/services/storage/storage");
    const schema = { columns: [{ key: "id" }, { key: "done" }] };
    for (const { label, scope } of scopes) {
      await storageSet(scope, "typed", [{ id: "a", done: false }], { kind: "table", schema });
      const meta = await storageGetMeta(scope, "typed");
      expect(meta?.kind, label).toBe("table");
      expect(meta?.schema, label).toEqual(schema);
    }
  });

  it("exposes updatedAt as ISO", async () => {
    const { storageList, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "stamped", 1);
      const entry = (await storageList(scope)).find((e) => e.key === "stamped");
      expect(typeof entry?.updatedAt, label).toBe("string");
      expect(Number.isFinite(new Date(entry!.updatedAt).getTime()), label).toBe(true);
    }
  });

  it("stale baseUpdatedAt → StorageConflictError, up to date → ok", async () => {
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

  it("deletes a key, then clears the scope", async () => {
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

describe("storageRowOp (atomic row operations)", () => {
  it("add / update / toggle / removeMany on an existing table", async () => {
    const { storageGet, storageRowOp, storageSet } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      await storageSet(scope, "list", [{ id: "a", label: "Milk", done: false }]);

      const added = await storageRowOp(scope, "list", { kind: "add", row: { id: "z", label: "Coffee" } });
      expect((await storageGet(scope, "list")) as unknown[], label).toHaveLength(2);
      expect(added.changed, label).toEqual({ id: "z", label: "Coffee" });

      await storageRowOp(scope, "list", { kind: "update", id: "a", patch: { done: true } });
      const rows = (await storageGet(scope, "list")) as Record<string, unknown>[];
      expect(rows.find((r) => r.id === "a")?.done, label).toBe(true);

      const toggled = await storageRowOp(scope, "list", { kind: "toggle", id: "a" });
      expect(toggled.changed, label).toEqual({ id: "a", label: "Milk", done: false });

      const removed = await storageRowOp(scope, "list", { kind: "removeMany", ids: ["a", "z"] });
      expect(removed.removed, label).toBe(2);
      expect(await storageGet(scope, "list"), label).toEqual([]);
    }
  });

  it("creates the key on the fly when adding to a missing key", async () => {
    const { storageGet, storageRowOp } = await import("@/services/storage/storage");
    for (const { label, scope } of scopes) {
      const res = await storageRowOp(scope, "fresh-table", { kind: "add", row: { id: "x" } });
      expect(res.rows, label).toHaveLength(1);
      expect(await storageGet(scope, "fresh-table"), label).toEqual([{ id: "x" }]);
    }
  });

  it("throws StorageRowError for a missing update target and a non-table value", async () => {
    const { storageRowOp, storageSet } = await import("@/services/storage/storage");
    const { StorageRowError } = await import("@/lib/errors");
    for (const { label, scope } of scopes) {
      await expect(
        storageRowOp(scope, "ghost", { kind: "update", id: "a", patch: {} }),
        label,
      ).rejects.toThrowError(StorageRowError);
      await storageSet(scope, "not-a-table", "a string");
      await expect(
        storageRowOp(scope, "not-a-table", { kind: "toggle", id: "a" }),
        label,
      ).rejects.toThrowError(StorageRowError);
    }
  });
});

// ---------------------------------------------------------------------------
// Specific to the global scope: private/family visibility
// ---------------------------------------------------------------------------

describe("storage global (visibility)", () => {
  it("exposes visibility in the metadata", async () => {
    const { globalScope, storageGetMeta, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "todos", [{ id: "a" }], {
      kind: "table",
      visibility: "family",
    });
    const meta = await storageGetMeta(globalScope(ownerId), "todos");
    expect(meta?.visibility).toBe("family");
  });

  it("lets another user read a family key but not a private one", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "shared", "shared-value", { visibility: "family" });
    await storageSet(globalScope(ownerId), "secret", "personal");
    expect(await storageGet(globalScope(otherId), "shared")).toBe("shared-value");
    expect(await storageGet(globalScope(otherId), "secret")).toBeNull();
  });

  it("prefers its own key over the shared key", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "counter", 1, { visibility: "family" });
    await storageSet(globalScope(otherId), "counter", 2);
    expect(await storageGet(globalScope(ownerId), "counter")).toBe(1);
    expect(await storageGet(globalScope(otherId), "counter")).toBe(2);
  });

  it("lists its own keys plus family ones, without others' private keys", async () => {
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

  it("only deletes its own keys", async () => {
    const { globalScope, storageClear, storageDelete, storageGet, storageSet } = await import(
      "@/services/storage/storage"
    );
    await storageClear(globalScope(ownerId));
    await storageClear(globalScope(otherId));
    await storageSet(globalScope(ownerId), "shared", "shared-value", { visibility: "family" });
    await storageDelete(globalScope(otherId), "shared");
    expect(await storageGet(globalScope(ownerId), "shared")).toBe("shared-value");
    await storageDelete(globalScope(ownerId), "shared");
    expect(await storageGet(globalScope(ownerId), "shared")).toBeNull();
  });

  it("clears all its keys without touching others'", async () => {
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

  it("a private key doesn't leak through the app or script scope", async () => {
    const { globalScope, storageGet, storageSet } = await import("@/services/storage/storage");
    await storageSet(globalScope(ownerId), "partition", "global-only");
    for (const { label, scope } of scopes) {
      if (scope.kind === "global") continue;
      expect(await storageGet(scope, "partition"), label).toBeNull();
    }
  });
});
