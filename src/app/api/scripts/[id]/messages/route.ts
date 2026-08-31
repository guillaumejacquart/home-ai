import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { getScript } from "@/services/scripts/scripts";
import { listScriptMessages } from "@/services/messages/chat";

export const GET = route({
  handler: async ({ user, params }) => {
    const row = await getScript(params.id, user.id);
    if (!row) return errorResponse("scriptNotFound", 404);
    return listScriptMessages(params.id);
  },
});
