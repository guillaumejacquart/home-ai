import { revokeApiToken } from "@/lib/api-tokens";
import { route } from "@/lib/route";

export const DELETE = route({
  handler: async ({ user, params }) => {
    await revokeApiToken(user.id, params.id);
    return { ok: true };
  },
});
