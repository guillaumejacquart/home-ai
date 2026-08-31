import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { getScript } from "@/services/scripts/scripts";
import { getScriptRunWithSpans } from "@/services/scripts/runner";

export const GET = route({
  handler: async ({ user, params }) => {
    // Vérifie l'accès au script parent (owner ou app family).
    const row = await getScript(params.id, user.id);
    if (!row) return errorResponse("scriptNotFound", 404);
    const detail = await getScriptRunWithSpans(params.runId);
    if (!detail || detail.run.scriptId !== params.id) return errorResponse("runNotFound", 404);
    return detail;
  },
});
