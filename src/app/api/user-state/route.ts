import { route } from "@/lib/route";
import { getUserStateGraph } from "@/services/user-state/graph";

export const GET = route({
  handler: async ({ user }) => getUserStateGraph(user.id),
});