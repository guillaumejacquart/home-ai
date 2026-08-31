import { z } from "zod";

import { route } from "@/lib/route";
import { listRecentUsage } from "@/services/llm/usage";

export const GET = route({
  query: z.object({
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    appId: z.string().optional(),
    scriptId: z.string().optional(),
    feature: z.string().optional(),
  }),
  handler: async ({ user, query }) => listRecentUsage(user.id, query),
});
