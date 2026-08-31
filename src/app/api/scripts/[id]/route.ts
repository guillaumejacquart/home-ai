import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { visibilitySchema } from "@/lib/schemas";
import {
  deleteScript,
  getScript,
  restoreScriptVersion,
  updateScript,
} from "@/services/scripts/scripts";

export const GET = route({
  handler: async ({ user, params }) => {
    const row = await getScript(params.id, user.id);
    if (!row) return errorResponse("scriptNotFound", 404);
    const script = row;
    // The webhook secret is only visible to the owner.
    if (script.ownerId !== user.id) script.webhookSecret = null;
    return script;
  },
});

export const PATCH = route({
  body: z.object({
    /** Present = restore a version, other fields are ignored. */
    versionId: z.string().optional(),
    name: z.string().optional(),
    triggerKind: z.enum(["schedule", "manual", "webhook"]).optional(),
    schedule: z.string().optional(),
    code: z.string().optional(),
    enabled: z.boolean().optional(),
    visibility: visibilitySchema.optional(),
  }),
  handler: async ({ user, params, body }) => {
    if (body.versionId !== undefined) {
      const { version } = await restoreScriptVersion(user.id, params.id, body.versionId);
      return { ok: true, restoredVersion: version };
    }
    // `versionId` isn't a script field: it triggers the restore instead.
    await updateScript(user.id, params.id, {
      name: body.name,
      triggerKind: body.triggerKind,
      schedule: body.schedule,
      code: body.code,
      enabled: body.enabled,
      visibility: body.visibility,
    });
    return { ok: true };
  },
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteScript(user.id, params.id);
    return { ok: true };
  },
});
