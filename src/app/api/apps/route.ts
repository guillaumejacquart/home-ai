import { z } from "zod";

import { route } from "@/lib/route";
import { nameSchema } from "@/lib/schemas";
import { createApp, listApps } from "@/services/apps/apps";

export const GET = route({
  handler: async ({ user }) => listApps(user.id),
});

export const POST = route({
  body: z.object({
    name: nameSchema,
    description: z.string().optional(),
    hasUi: z.boolean().optional(),
    slug: z.string().optional(),
  }),
  status: 201,
  handler: async ({ user, body }) => createApp(user.id, body),
});
