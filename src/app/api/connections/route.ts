import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import {
  ConnectionError,
  createConnection,
  listConnections,
} from "@/services/connections/connections";
import { getProvider } from "@/services/connections/registry";

export const GET = route({
  handler: async ({ user }) => listConnections(user.id),
});

export const POST = route({
  body: z.object({
    type: z.string().default(""),
    label: z.string().optional(),
    config: z.unknown().optional(),
  }),
  status: 201,
  handler: async ({ user, body }) => {
    // Google passe par le flux OAuth (`/api/connections/google/start`).
    if (body.type === "google") return errorResponse("unknownConnectionType", 400);

    const provider = getProvider(body.type as never);
    if (!provider) return errorResponse("unknownConnectionType", 400);

    // Chaque provider valide sa propre config (cf. connections/registry.ts).
    const parsed = provider.schema.safeParse(body.config);
    if (!parsed.success) {
      throw new ConnectionError(parsed.error.issues[0]?.message ?? "Config invalide");
    }

    const id = await createConnection(user.id, {
      type: body.type as never,
      label: body.label ?? provider.label,
      data: parsed.data as never,
    });
    return { id };
  },
});
