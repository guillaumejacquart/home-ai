import { route } from "@/lib/route";
import { listScriptRuns } from "@/services/scripts/runner";

export const GET = route({
  handler: async ({ params }) => listScriptRuns(params.id),
});
