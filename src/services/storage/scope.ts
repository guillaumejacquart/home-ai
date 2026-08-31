import { and, desc, eq, or } from "drizzle-orm";

import { db, tables } from "@/db/client";
import type { AppVisibility, StorageKind } from "@/db/schema";

/**
 * Scope of a KV storage. The three scopes share the same logic (see
 * `storage.ts`) and differ only in their table and how reads resolve — that is
 * all this file describes.
 */
export type StorageScope =
  | { kind: "app"; appId: string }
  | { kind: "global"; ownerId: string }
  | { kind: "script"; scriptId: string };

export const appScope = (appId: string): StorageScope => ({ kind: "app", appId });
export const globalScope = (ownerId: string): StorageScope => ({ kind: "global", ownerId });
export const scriptScope = (scriptId: string): StorageScope => ({ kind: "script", scriptId });

/** Normalised row, shared by the three tables (`visibility`: global only). */
export interface StorageRow {
  key: string;
  value: string;
  kind: StorageKind;
  schema: string | null;
  visibility: AppVisibility | null;
  updatedAt: Date;
}

/** Full row write: the caller has already resolved which values to keep. */
export interface StorageWrite {
  value: string;
  kind: StorageKind;
  schema: string | null;
  visibility: AppVisibility;
  updatedAt: Date;
}

/**
 * `db` or a transaction: only the four query methods are used, which makes the
 * repo usable in both contexts.
 */
export type Exec = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * Raw access to a scope. Deliberately dumb: no JSON, no conflict handling, no
 * row operations — all of that lives once, in `storage.ts`.
 * The methods are synchronous (better-sqlite3 driver).
 */
export interface ScopeRepo {
  /** Only global storage carries a private/family visibility. */
  readonly supportsVisibility: boolean;
  /** Row owned by the scope (the basis of every write). */
  find(key: string): StorageRow | undefined;
  /** Row visible for reads — global: falls back to a family-shared key. */
  findForRead(key: string): StorageRow | undefined;
  findAll(): StorageRow[];
  insert(key: string, write: StorageWrite): void;
  update(key: string, write: StorageWrite): void;
  remove(key: string): void;
  clear(): void;
}

function appRepo(appId: string, exec: Exec): ScopeRepo {
  const t = tables.appStorage;
  const at = (key: string) => and(eq(t.appId, appId), eq(t.key, key));
  const toRow = (r: typeof t.$inferSelect): StorageRow => ({ ...r, visibility: null });
  const find = (key: string) => {
    const row = exec.select().from(t).where(at(key)).get();
    return row ? toRow(row) : undefined;
  };
  return {
    supportsVisibility: false,
    find,
    findForRead: find,
    findAll: () => exec.select().from(t).where(eq(t.appId, appId)).all().map(toRow),
    insert: (key, w) => {
      exec.insert(t).values({ appId, key, value: w.value, kind: w.kind, schema: w.schema, updatedAt: w.updatedAt }).run();
    },
    update: (key, w) => {
      exec.update(t).set({ value: w.value, kind: w.kind, schema: w.schema, updatedAt: w.updatedAt }).where(at(key)).run();
    },
    remove: (key) => {
      exec.delete(t).where(at(key)).run();
    },
    clear: () => {
      exec.delete(t).where(eq(t.appId, appId)).run();
    },
  };
}

function scriptRepo(scriptId: string, exec: Exec): ScopeRepo {
  const t = tables.scriptStorage;
  const at = (key: string) => and(eq(t.scriptId, scriptId), eq(t.key, key));
  const toRow = (r: typeof t.$inferSelect): StorageRow => ({ ...r, visibility: null });
  const find = (key: string) => {
    const row = exec.select().from(t).where(at(key)).get();
    return row ? toRow(row) : undefined;
  };
  return {
    supportsVisibility: false,
    find,
    findForRead: find,
    findAll: () => exec.select().from(t).where(eq(t.scriptId, scriptId)).all().map(toRow),
    insert: (key, w) => {
      exec.insert(t).values({ scriptId, key, value: w.value, kind: w.kind, schema: w.schema, updatedAt: w.updatedAt }).run();
    },
    update: (key, w) => {
      exec.update(t).set({ value: w.value, kind: w.kind, schema: w.schema, updatedAt: w.updatedAt }).where(at(key)).run();
    },
    remove: (key) => {
      exec.delete(t).where(at(key)).run();
    },
    clear: () => {
      exec.delete(t).where(eq(t.scriptId, scriptId)).run();
    },
  };
}

function globalRepo(ownerId: string, exec: Exec): ScopeRepo {
  const t = tables.globalStorage;
  const at = (key: string) => and(eq(t.ownerId, ownerId), eq(t.key, key));
  const find = (key: string) => exec.select().from(t).where(at(key)).get();
  return {
    supportsVisibility: true,
    find,
    /** Their own key first, otherwise the most recent family-shared key. */
    findForRead: (key) => {
      const own = find(key);
      if (own) return own;
      return exec
        .select()
        .from(t)
        .where(and(eq(t.visibility, "family"), eq(t.key, key)))
        .orderBy(desc(t.updatedAt))
        .get();
    },
    /** Their own plus those shared with the family by others. */
    findAll: () =>
      exec
        .select()
        .from(t)
        .where(or(eq(t.ownerId, ownerId), eq(t.visibility, "family")))
        .orderBy(desc(t.updatedAt))
        .all(),
    insert: (key, w) => {
      exec
        .insert(t)
        .values({ ownerId, key, value: w.value, kind: w.kind, schema: w.schema, visibility: w.visibility, updatedAt: w.updatedAt })
        .run();
    },
    update: (key, w) => {
      exec
        .update(t)
        .set({ value: w.value, kind: w.kind, schema: w.schema, visibility: w.visibility, updatedAt: w.updatedAt })
        .where(at(key))
        .run();
    },
    /** Deletion is owner-only (never someone else's shared keys). */
    remove: (key) => {
      exec.delete(t).where(at(key)).run();
    },
    clear: () => {
      exec.delete(t).where(eq(t.ownerId, ownerId)).run();
    },
  };
}

/** Scope repo, bound to `db` or to a transaction. */
export function repoFor(scope: StorageScope, exec: Exec = db): ScopeRepo {
  switch (scope.kind) {
    case "app":
      return appRepo(scope.appId, exec);
    case "script":
      return scriptRepo(scope.scriptId, exec);
    case "global":
      return globalRepo(scope.ownerId, exec);
  }
}
