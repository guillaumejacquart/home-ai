import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { canReadScript, canWriteScript, getScript } from "@/services/scripts/scripts";
import {
  globalStorageSetBodySchema,
  storageKeyQuerySchema,
  storageRowOpBodySchema,
} from "@/services/storage/schemas";
import {
  scriptScope,
  storageClear,
  storageDelete,
  storageGet,
  storageList,
  storageRowOp,
  storageSet,
} from "@/services/storage/storage";

/** Script scope after access check. Returns the error response otherwise. */
async function scopeFor(userId: string, scriptId: string, write: boolean) {
  const row = await getScript(scriptId, userId);
  if (!row) return { error: await errorResponse("scriptNotFound", 404) };
  const allowed = write ? canWriteScript(userId, row) : canReadScript(userId, row);
  if (!allowed) return { error: await errorResponse("forbidden", 403) };
  return { scope: scriptScope(scriptId) };
}

export const GET = route({
  query: storageKeyQuerySchema,
  handler: async ({ user, params, query }) => {
    const { scope, error } = await scopeFor(user.id, params.id, false);
    if (!scope) return error;
    if (query.key) return { key: query.key, value: await storageGet(scope, query.key) };
    return storageList(scope);
  },
});

export const POST = route({
  body: globalStorageSetBodySchema,
  handler: async ({ user, params, body }) => {
    const { scope, error } = await scopeFor(user.id, params.id, true);
    if (!scope) return error;
    const updatedAt = await storageSet(scope, body.key, body.value, {
      kind: body.kind,
      schema: body.schema,
      baseUpdatedAt: body.baseUpdatedAt,
    });
    return { ok: true, updatedAt };
  },
});

/** Atomic row operation on a "table" value: { key, op }. */
export const PATCH = route({
  body: storageRowOpBodySchema,
  handler: async ({ user, params, body }) => {
    const { scope, error } = await scopeFor(user.id, params.id, true);
    if (!scope) return error;
    const result = await storageRowOp(scope, body.key, body.op);
    return {
      ok: true,
      ...(result.changed ? { changed: result.changed } : {}),
      ...(result.removed !== undefined ? { removed: result.removed } : {}),
    };
  },
});

export const DELETE = route({
  query: storageKeyQuerySchema,
  handler: async ({ user, params, query }) => {
    const { scope, error } = await scopeFor(user.id, params.id, true);
    if (!scope) return error;
    if (query.key) await storageDelete(scope, query.key);
    else await storageClear(scope);
    return { ok: true };
  },
});
