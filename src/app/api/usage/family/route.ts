import { z } from "zod";

import { route } from "@/lib/route";
import { getFamilySummary } from "@/services/llm/usage";

export const GET = route({
  permission: "platform.settings",
  query: z.object({
    period: z.enum(["day", "week", "month", "all"], "invalidContent").default("month"),
  }),
  handler: async ({ query }) => getFamilySummary(query.period),
});
