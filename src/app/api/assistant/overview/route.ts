import { route } from "@/lib/route";
import { getPlatformOverview } from "@/services/agent/overview";

export const GET = route({
  handler: async ({ user }) => getPlatformOverview(user.id),
});
