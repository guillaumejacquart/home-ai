import { and, desc, eq, or } from "drizzle-orm";

import { db, tables } from "@/db/client";
import type { AppVisibility, StorageKind } from "@/db/schema";

/**
 * Portée d'un stockage KV. Les trois portées partagent la même logique
 * (cf. `storage.ts`) et ne diffèrent que par la table et la résolution des
 * lectures — c'est tout ce que décrit ce fichier.
 */
export type StorageScope =
  | { kind: "app"; appId: string }
  | { kind: "global"; ownerId: string }
  | { kind: "script"; scriptId: string };

export const appScope = (appId: string): StorageScope => ({ kind: "app", appId });
export const globalScope = (ownerId: string): StorageScope => ({ kind: "global", ownerId });
export const scriptScope = (scriptId: string): StorageScope => ({ kind: "script", scriptId });

/** Ligne normalisée, commune aux trois tables (`visibility` : global seulement). */
export interface StorageRow {
  key: string;
  value: string;
  kind: StorageKind;
  schema: string | null;
  visibility: AppVisibility | null;
  updatedAt: Date;
}

/** Écriture complète d'une ligne : l'appelant a déjà résolu les valeurs à garder. */
export interface StorageWrite {
  value: string;
  kind: StorageKind;
  schema: string | null;
  visibility: AppVisibility;
  updatedAt: Date;
}

/**
 * `db` ou une transaction : seules les quatre méthodes de requête sont
 * utilisées, ce qui rend le repo utilisable dans les deux contextes.
 */
export type Exec = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * Accès brut à une portée. Volontairement bête : pas de JSON, pas de conflit,
 * pas d'opération ligne — tout cela vit une seule fois dans `storage.ts`.
 * Les méthodes sont synchrones (driver better-sqlite3).
 */
export interface ScopeRepo {
  /** Seul le stockage global porte une visibilité private/family. */
  readonly supportsVisibility: boolean;
  /** Ligne appartenant à la portée (base de toute écriture). */
  find(key: string): StorageRow | undefined;
  /** Ligne visible en lecture — global : repli sur une clé partagée famille. */
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
    /** Sa propre clé d'abord, sinon la clé partagée famille la plus récente. */
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
    /** Les siennes + celles partagées en famille par les autres. */
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
    /** Suppression réservée au propriétaire (jamais les clés partagées d'autrui). */
    remove: (key) => {
      exec.delete(t).where(at(key)).run();
    },
    clear: () => {
      exec.delete(t).where(eq(t.ownerId, ownerId)).run();
    },
  };
}

/** Repo de la portée, lié à `db` ou à une transaction. */
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
