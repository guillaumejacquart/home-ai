import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { visibilitySchema } from "@/lib/schemas";
import { parseTags } from "@/lib/tags";
import { deleteApp, getApp, updateApp } from "@/services/apps/apps";
import { appManifestSchema } from "@/services/apps/manifest";
import { listVersions, rollbackToVersion } from "@/services/apps/versions";
import { listAppMessages as listMessages } from "@/services/messages/chat";

export const GET = route({
  handler: async ({ user, params }) => {
    const app = await getApp(user.id, params.id);
    if (!app) return errorResponse("appNotFound", 404);
    const [versions, messages] = await Promise.all([
      listVersions(params.id),
      listMessages(params.id),
    ]);
    return { ...app, tags: parseTags(app.tags), versions, messages };
  },
});

/** Manifest accepted as an object, as JSON-encoded string, or `null` to clear it. */
function parseManifestInput(input: unknown): string | null | undefined {
  if (input === null) return null;
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  const parsed = appManifestSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return JSON.stringify(parsed.data);
}

export const PATCH = route({
  body: z.object({
    /** Present = rollback to a version, other fields are ignored. */
    versionId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    visibility: visibilitySchema.optional(),
    tags: z.array(z.coerce.string()).optional(),
    manifest: z.unknown().optional(),
  }),
  handler: async ({ user, params, body }) => {
    if (body.versionId) {
      const v = await rollbackToVersion(params.id, body.versionId);
      return { ok: true, currentVersionId: v.id };
    }

    // `versionId` isn't an app field: it triggers the rollback instead.
    const patch: Parameters<typeof updateApp>[2] = {
      name: body.name,
      description: body.description,
      visibility: body.visibility,
      tags: body.tags,
    };
    if (body.manifest !== undefined) {
      let value: string | null | undefined;
      try {
        value = parseManifestInput(body.manifest);
      } catch {
        return errorResponse("storageValueInvalid", 400);
      }
      if (value === undefined) return errorResponse("storageValueInvalid", 400);
      patch.manifest = value;
    }
    await updateApp(user.id, params.id, patch);
    return { ok: true };
  },
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteApp(user.id, params.id);
    return { ok: true };
  },
});
