import { z } from "zod";

import { route } from "@/lib/route";
import { listModels } from "@/services/llm/llm";

export const GET = route({
  query: z.object({
    provider: z.enum(["opencode-go", "openrouter"]).catch("opencode-go"),
  }),
  handler: async ({ query }) => ({
    provider: query.provider,
    models: await listModels(query.provider),
  }),
});
