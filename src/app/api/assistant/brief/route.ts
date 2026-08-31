import { z } from "zod";

import { route } from "@/lib/route";
import { isLocale } from "@/i18n/config";
import { generateBrief, getOrCreateJournalThread } from "@/services/agent/brief";
import { getThread, loadMessages } from "@/services/agent/threads";

export const POST = route({
  body: z.object({ locale: z.unknown().optional() }),
  handler: async ({ user, body }) =>
    generateBrief(user.id, isLocale(body.locale) ? body.locale : "fr"),
});

/** Dernier brief du fil « Journal », pour l'afficher sans en générer un neuf. */
export const GET = route({
  handler: async ({ user }) => {
    const threadId = await getOrCreateJournalThread(user.id);
    const [thread, messages] = await Promise.all([
      getThread(user.id, threadId),
      loadMessages(threadId),
    ]);
    const lastBrief = [...messages].reverse().find((m) => m.role === "assistant") ?? null;
    return { threadId, thread, lastBrief, messages: messages.slice(-10) };
  },
});
