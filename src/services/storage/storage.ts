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

/** Parses a stored value: JSON when possible, raw string otherwise. */
function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Checks that a value is JSON-serialisable (exact round-trip). */
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
  /** Global scope only. */
  visibility?: AppVisibility;
}

export interface StorageEntry extends StorageMeta {
  key: string;
  value: unknown;
  /** ISO timestamp of the last write — the baseline for conflict detection. */
  updatedAt: string;
}

export interface StorageSetOptions {
  kind?: StorageKind;
  schema?: unknown;
  /** Global scope only; ignored elsewhere. */
  visibility?: AppVisibility;
  /** Version the client expects; 409 when it changed in the meantime. */
  baseUpdatedAt?: string | number | Date;
}

/**
 * Compares a baseline sent by the client against the current row.
 * Note: the `updatedAt` column is stored in seconds (drizzle timestamp mode), so
 * the comparison is only accurate to the second.
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

/** Returns the metadata (kind/schema/visibility) when the key is accessible. */
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

/** Writes a key in the scope (upsert). Returns the new ISO `updatedAt`. */
export async function storageSet(
  scope: StorageScope,
  key: string,
  value: unknown,
  opts: StorageSetOptions = {},
): Promise<string> {
  const repo = repoFor(scope);
  // Always serialise to JSON for an exact round-trip (array/object/string).
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
 * Atomic row operation on a key's "table" value.
 * Missing key + "add" op: creates the table with that row (generation UX).
 * Non-table value or missing row: StorageRowError (400/404).
 * Note: the better-sqlite3 driver requires a synchronous transaction callback
 * (.get()/.run() are sync) — the API stays async for callers.
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
