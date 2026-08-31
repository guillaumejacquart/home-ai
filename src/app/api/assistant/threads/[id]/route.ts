import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { deleteThread, getThread, loadMessages } from "@/services/agent/threads";

export const GET = route({
  handler: async ({ user, params }) => {
    const thread = await getThread(user.id, params.id);
    if (!thread) return errorResponse("threadNotFound", 404);
    return { thread, messages: await loadMessages(thread.id) };
  },
});

export const DELETE = route({
  handler: async ({ user, params }) => {
    await deleteThread(user.id, params.id);
    return { ok: true };
  },
});
