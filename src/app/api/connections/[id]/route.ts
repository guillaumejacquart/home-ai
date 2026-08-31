import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { deleteConnection, getConnection, updateLabel } from "@/services/connections/connections";

export const GET = route({
  handler: async ({ user, params }) => {
    const row = await getConnection(user.id, params.id);
    if (!row) return errorResponse("connectionNotFound", 404);
    // La config est un blob chiffré : jamais renvoyée au client.
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      status: row.status,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

export const PATCH = route({
  body: z.object({ label: z.string("labelRequired").min(1, "labelRequired") }),
  handler: async ({ user, params, body }) => {
    await updateLabel(user.id, params.id, body.label);
    return { ok: true };
  },
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteConnection(user.id, params.id);
    return { ok: true };
  },
});
