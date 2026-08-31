import { z } from "zod";

import { route } from "@/lib/route";
import { visibilitySchema } from "@/lib/schemas";
import { createScript, listScripts } from "@/services/scripts/scripts";

const scriptTriggerKindSchema = z.enum(["schedule", "manual", "webhook"]);

export const GET = route({
  handler: async ({ user }) => listScripts(user.id),
});

export const POST = route({
  body: z.object({
    name: z.string("scriptFieldsRequired").min(1, "scriptFieldsRequired"),
    triggerKind: scriptTriggerKindSchema.optional(),
    schedule: z.string().optional(),
    code: z.string("scriptFieldsRequired").min(1, "scriptFieldsRequired"),
    visibility: visibilitySchema.optional(),
  }),
  status: 201,
  handler: async ({ user, body }) => {
    const id = await createScript({
      ownerId: user.id,
      triggerKind: body.triggerKind ?? "schedule",
      visibility: body.visibility ?? "private",
      name: body.name,
      schedule: body.schedule ?? "",
      code: body.code,
    });
    return { id };
  },
});
