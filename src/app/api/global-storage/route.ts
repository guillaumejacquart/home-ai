import { route } from "@/lib/route";
import {
  globalStorageSetBodySchema,
  storageKeyQuerySchema,
  storageRowOpBodySchema,
} from "@/services/storage/schemas";
import {
  globalScope,
  storageClear,
  storageDelete,
  storageGet,
  storageGetMeta,
  storageList,
  storageRowOp,
  storageSet,
} from "@/services/storage/storage";

export const GET = route({
  query: storageKeyQuerySchema,
  handler: async ({ user, query }) => {
    const scope = globalScope(user.id);
    if (!query.key) return storageList(scope);
    const value = await storageGet(scope, query.key);
    const meta = await storageGetMeta(scope, query.key);
    if (value === null && !meta) return { key: query.key, value: null };
    return { key: query.key, value, ...(meta ?? {}) };
  },
});

export const POST = route({
  body: globalStorageSetBodySchema,
  handler: async ({ user, body }) => {
    const updatedAt = await storageSet(globalScope(user.id), body.key, body.value, {
      kind: body.kind,
      schema: body.schema,
      visibility: body.visibility,
      baseUpdatedAt: body.baseUpdatedAt,
    });
    return { ok: true, updatedAt };
  },
});

/** Opération ligne atomique sur une valeur « table » : { key, op }. */
export const PATCH = route({
  body: storageRowOpBodySchema,
  handler: async ({ user, body }) => {
    const result = await storageRowOp(globalScope(user.id), body.key, body.op);
    return {
      ok: true,
      ...(result.changed ? { changed: result.changed } : {}),
      ...(result.removed !== undefined ? { removed: result.removed } : {}),
    };
  },
});

export const DELETE = route({
  query: storageKeyQuerySchema,
  handler: async ({ user, query }) => {
    const scope = globalScope(user.id);
    if (query.key) await storageDelete(scope, query.key);
    else await storageClear(scope);
    return { ok: true };
  },
});
