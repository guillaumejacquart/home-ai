import { z } from "zod";

import { createApiToken, listApiTokens } from "@/lib/api-tokens";
import { route } from "@/lib/route";

export const GET = route({
  handler: async ({ user }) => listApiTokens(user.id),
});

export const POST = route({
  body: z.object({ name: z.string().trim().min(1).optional() }),
  status: 201,
  handler: async ({ user, body }) => ({
    token: await createApiToken(user.id, body.name ?? "Agent"),
  }),
});
