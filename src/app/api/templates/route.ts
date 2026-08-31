import { route } from "@/lib/route";
import { listTemplatesForUser } from "@/services/templates/templates";

export const GET = route({
  handler: async ({ user }) => listTemplatesForUser(user.id),
});
