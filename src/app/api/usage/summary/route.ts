import { z } from "zod";

import { route } from "@/lib/route";
import { getUsageSummary } from "@/services/llm/usage";

export const GET = route({
  query: z.object({
    appId: z.string().optional(),
    scriptId: z.string().optional(),
  }),
  handler: async ({ user, query }) => getUsageSummary(user.id, query),
});
