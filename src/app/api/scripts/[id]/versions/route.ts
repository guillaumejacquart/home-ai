import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { getScript, listScriptVersions } from "@/services/scripts/scripts";

export const GET = route({
  handler: async ({ user, params }) => {
    const row = await getScript(params.id, user.id);
    if (!row) return errorResponse("scriptNotFound", 404);
    return listScriptVersions(params.id);
  },
});
