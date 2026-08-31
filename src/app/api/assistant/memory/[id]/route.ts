import { route } from "@/lib/route";
import { deleteMemory, updateMemory } from "@/services/agent/memory";
import { memoryPatchSchema } from "@/services/agent/schemas";

export const PATCH = route({
  body: memoryPatchSchema,
  handler: async ({ user, params, body }) => updateMemory(user.id, params.id, body),
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteMemory(user.id, params.id);
    return { ok: true };
  },
});
