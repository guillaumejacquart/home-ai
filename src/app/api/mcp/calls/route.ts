import { z } from "zod";

import { route } from "@/lib/route";
import { listMcpCalls } from "@/services/mcp/calls";

export const GET = route({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    toolName: z.string().optional(),
  }),
  handler: async ({ user, query }) => {
    const rows = await listMcpCalls(user.id, { limit: query.limit, toolName: query.toolName });
    return rows.map((r) => ({
      id: r.id,
      toolName: r.toolName,
      tokenPrefix: r.tokenPrefix,
      args: r.args,
      result: r.result,
      status: r.status,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
  },
});
