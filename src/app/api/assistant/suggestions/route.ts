import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { generateSuggestions } from "@/services/agent/post-turn";
import { getThread, loadMessages, messageText } from "@/services/agent/threads";

/**
 * Relances proposées après un tour. Route séparée pour ne pas retarder la
 * fermeture du stream de chat — le client l'appelle quand le tour est fini.
 */
export const POST = route({
  body: z.object({ threadId: z.string().min(1, "invalidBody") }),
  handler: async ({ user, body }) => {
    const thread = await getThread(user.id, body.threadId);
    if (!thread) return errorResponse("threadNotFound", 404);

    const messages = await loadMessages(thread.id);
    const answer = messages.at(-1);
    const question = [...messages].reverse().find((m) => m.role === "user");
    if (!answer || answer.role !== "assistant" || !question) return { suggestions: [] };

    const suggestions = await generateSuggestions(
      user.id,
      messageText(question),
      messageText(answer),
    ).catch(() => []);
    return { suggestions };
  },
});
