import { z } from "zod";

import { route } from "@/lib/route";
import { getThreadByContext, listThreads } from "@/services/agent/threads";

export const GET = route({
  query: z.object({
    contextKind: z.enum(["assistant", "app", "script", "journal"]).optional(),
    contextId: z.string().optional(),
  }),
  handler: async ({ user, query }) => {
    if (query.contextKind && query.contextId) {
      const thread = await getThreadByContext(user.id, query.contextKind, query.contextId);
      return thread ? [thread] : [];
    }
    if (query.contextKind) return listThreads(user.id, { contextKind: query.contextKind });
    return listThreads(user.id);
  },
});
