import { db } from "@/db/client";
import type { AppVisibility, StorageKind } from "@/db/schema";
import { StorageConflictError, StorageRowError } from "@/lib/errors";
import { applyRowOp, type RowOpResult, type TableRowOp } from "@/lib/storage-table";

import { repoFor, type Exec, type StorageScope } from "./scope";

export type { StorageScope } from "./scope";
export { appScope, scriptScope, globalScope } from "./scope";

function now() {
  return new Date();
}

/** Parse une valeur stockée : JSON si possible, sinon chaîne brute. */
function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Vérifie qu'une valeur est sérialisable en JSON (round-trip exact). */
export function isJsonSerializable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function parseSchema(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface StorageMeta {
  kind: StorageKind;
  schema?: unknown;
  /** Portée globale uniquement. */
  visibility?: AppVisibility;
}

export interface StorageEntry extends StorageMeta {
  key: string;
  value: unknown;
  /** Horodatage ISO de la dernière écriture — sert de base aux conflits. */
  updatedAt: string;
}

export interface StorageSetOptions {
  kind?: StorageKind;
  schema?: unknown;
  /** Portée globale uniquement ; ignoré ailleurs. */
  visibility?: AppVisibility;
  /** Version attendue du côté client ; 409 si modifiée entre-temps. */
  baseUpdatedAt?: string | number | Date;
}

/**
 * Compare une base transmise par le client à la ligne courante.
 * NB : la colonne `updatedAt` est stockée en secondes (drizzle mode timestamp),
 * la comparaison se fait donc à la seconde près.
 */
function assertFreshUpdate(
  baseUpdatedAt: string | number | Date | undefined,
  current: Date | string,
) {
  if (baseUpdatedAt === undefined || baseUpdatedAt === null) return;
  const base = Math.floor(new Date(baseUpdatedAt).getTime() / 1000);
  if (!Number.isFinite(base)) return;
  if (base !== Math.floor(new Date(current).getTime() / 1000)) throw new StorageConflictError();
}

export async function storageGet(scope: StorageScope, key: string): Promise<unknown> {
  const row = repoFor(scope).findForRead(key);
  return row ? parseStored(row.value) : null;
}

/** Retourne les métadonnées (kind/schema/visibility) si la clé est accessible. */
export async function storageGetMeta(
  scope: StorageScope,
  key: string,
): Promise<StorageMeta | null> {
  const repo = repoFor(scope);
  const row = repo.findForRead(key);
  if (!row) return null;
  return {
    kind: row.kind,
    schema: parseSchema(row.schema),
    ...(repo.supportsVisibility && row.visibility ? { visibility: row.visibility } : {}),
  };
}

/** Écrit une clé de la portée (upsert). Retourne le nouvel `updatedAt` ISO. */
export async function storageSet(
  scope: StorageScope,
  key: string,
  value: unknown,
  opts: StorageSetOptions = {},
): Promise<string> {
  const repo = repoFor(scope);
  // Toujours sérialiser en JSON pour un round-trip exact (array/objet/string).
  const stored = JSON.stringify(value);
  const schema = opts.schema === undefined ? undefined : JSON.stringify(opts.schema);
  const existing = repo.find(key);
  const updatedAt = now();

  if (existing) {
    assertFreshUpdate(opts.baseUpdatedAt, existing.updatedAt);
    repo.update(key, {
      value: stored,
      kind: opts.kind ?? existing.kind,
      schema: schema !== undefined ? schema : existing.schema,
      visibility: opts.visibility ?? existing.visibility ?? "private",
      updatedAt,
    });
    return updatedAt.toISOString();
  }

  repo.insert(key, {
    value: stored,
    kind: opts.kind ?? "kv",
    schema: schema ?? null,
    visibility: opts.visibility ?? "private",
    updatedAt,
  });
  return updatedAt.toISOString();
}

/**
 * Opération ligne atomique sur une valeur « table » d'une clé.
 * Clé absente + op « add » : crée la table avec la ligne (UX génération).
 * Valeur non-table ou ligne introuvable : StorageRowError (400/404).
 * NB : le driver better-sqlite3 impose un callback de transaction synchrone
 * (.get()/.run() sont sync) — l'API reste async pour les appelants.
 */
export async function storageRowOp(
  scope: StorageScope,
  key: string,
  op: TableRowOp,
): Promise<RowOpResult> {
  return db.transaction((tx): RowOpResult => {
    const repo = repoFor(scope, tx as Exec);
    const raw = repo.find(key);

    if (!raw) {
      if (op.kind !== "add") throw new StorageRowError("keyRequired");
      const created = applyRowOp([], op);
      repo.insert(key, {
        value: JSON.stringify(created.rows),
        kind: "table",
        schema: null,
        visibility: "private",
        updatedAt: now(),
      });
      return created;
    }

    let result: RowOpResult;
    try {
      result = applyRowOp(parseStored(raw.value), op);
    } catch (err) {
      if (err instanceof Error && err.message === "rowNotFound") throw new StorageRowError("rowNotFound");
      if (err instanceof Error && err.message === "notATable") throw new StorageRowError("storageNotATable");
      throw err;
    }

    repo.update(key, {
      value: JSON.stringify(result.rows),
      kind: "table",
      schema: raw.schema,
      visibility: raw.visibility ?? "private",
      updatedAt: now(),
    });
    return result;
  });
}

export async function storageList(scope: StorageScope): Promise<StorageEntry[]> {
  const repo = repoFor(scope);
  return repo.findAll().map((r) => ({
    key: r.key,
    value: parseStored(r.value),
    kind: r.kind,
    schema: parseSchema(r.schema),
    ...(repo.supportsVisibility && r.visibility ? { visibility: r.visibility } : {}),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function storageDelete(scope: StorageScope, key: string): Promise<void> {
  repoFor(scope).remove(key);
}

export async function storageClear(scope: StorageScope): Promise<void> {
  repoFor(scope).clear();
}
