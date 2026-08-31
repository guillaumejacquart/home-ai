import { z } from "zod";

import { route } from "@/lib/route";
import { nameSchema, visibilitySchema } from "@/lib/schemas";
import { createDashboard, listDashboards } from "@/services/dashboards/dashboards";

export const GET = route({
  handler: async ({ user }) => listDashboards(user.id),
});

export const POST = route({
  body: z.object({
    name: nameSchema,
    description: z.string().optional(),
    visibility: visibilitySchema.optional(),
    slug: z.string().optional(),
  }),
  status: 201,
  handler: async ({ user, body }) => createDashboard(user.id, body),
});
