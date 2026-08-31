import { z } from "zod";

import { route } from "@/lib/route";
import { addMemory, listMemory } from "@/services/agent/memory";
import { memoryKindSchema } from "@/services/agent/schemas";

export const GET = route({
  handler: async ({ user }) => listMemory(user.id),
});

export const POST = route({
  body: z.object({
    content: z.string("contentRequired").refine((v) => v.trim() !== "", "contentRequired"),
    kind: memoryKindSchema.optional(),
    pinned: z.boolean("invalidPinned").optional(),
  }),
  status: 201,
  handler: async ({ user, body }) =>
    addMemory(user.id, {
      content: body.content,
      kind: body.kind,
      source: "user",
      pinned: body.pinned,
    }),
});
