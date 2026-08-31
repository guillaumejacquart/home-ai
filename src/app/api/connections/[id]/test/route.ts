import { route } from "@/lib/route";
import { testConnection } from "@/services/connections/connections";

export const POST = route({
  handler: async ({ user, params }) => ({
    ok: true,
    message: await testConnection(user.id, params.id),
  }),
});
