import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { getApp } from "@/services/apps/apps";
import {
  globalStorageSetBodySchema,
  storageKeyQuerySchema,
  storageRowOpBodySchema,
} from "@/services/storage/schemas";
import {
  appScope,
  storageClear,
  storageDelete,
  storageGet,
  storageList,
  storageRowOp,
  storageSet,
} from "@/services/storage/storage";

/** App scope after access check, or `null` if the app is inaccessible. */
async function scopeFor(userId: string, appId: string) {
  const app = await getApp(userId, appId);
  return app ? appScope(appId) : null;
}

export const GET = route({
  query: storageKeyQuerySchema,
  handler: async ({ user, params, query }) => {
    const scope = await scopeFor(user.id, params.id);
    if (!scope) return errorResponse("appNotFound", 404);
    if (query.key) return { key: query.key, value: await storageGet(scope, query.key) };
    return storageList(scope);
  },
});

export const POST = route({
  // `visibility` is ignored outside global scope — accepted to keep a common body shape.
  body: globalStorageSetBodySchema,
  handler: async ({ user, params, body }) => {
    const scope = await scopeFor(user.id, params.id);
    if (!scope) return errorResponse("appNotFound", 404);
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
    const scope = await scopeFor(user.id, params.id);
    if (!scope) return errorResponse("appNotFound", 404);
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
    const scope = await scopeFor(user.id, params.id);
    if (!scope) return errorResponse("appNotFound", 404);
    if (query.key) await storageDelete(scope, query.key);
    else await storageClear(scope);
    return { ok: true };
  },
});
