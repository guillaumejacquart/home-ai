import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { canWriteScript, getScript } from "@/services/scripts/scripts";
import { startScriptRun } from "@/services/scripts/runner";

export const POST = route({
  handler: async ({ user, params }) => {
    const row = await getScript(params.id, user.id);
    if (!row) return errorResponse("scriptNotFound", 404);
    if (!canWriteScript(user.id, row)) return errorResponse("forbidden", 403);
    const { runId, done } = await startScriptRun(params.id);
    // The failure is already persisted on the run; the client will read it via polling.
    void done.catch(() => {});
    return { ok: true, runId, status: "running" as const };
  },
});
