import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/session";
import { getThread, listThreads, loadMessages } from "@/services/agent/threads";
import type { ThreadRow } from "@/components/agent/types";
import { AssistantPageClient } from "./AssistantPageClient";

export const metadata: Metadata = {
  title: "Assistant — Home AI",
};

/** Journal épinglé en tête, le reste par activité décroissante. */
async function sidebarThreads(userId: string): Promise<ThreadRow[]> {
  const rows = await listThreads(userId);
  return rows
    .map((r) => ({
      id: r.id,
      title: r.title,
      contextKind: r.contextKind,
      contextId: r.contextId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => {
      const journal = Number(b.contextKind === "journal") - Number(a.contextKind === "journal");
      if (journal !== 0) return journal;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export default async function Page({ params }: { params: Promise<{ threadId?: string[] }> }) {
  const { threadId } = await params;
  const requested = threadId?.[0] ?? null;
  const user = await requireUser();
  const threads = await sidebarThreads(user.id);

  if (!requested) {
    // Fil neuf : on fixe l'id ici pour que le client puisse mettre l'URL à jour
    // dès le premier message, sans attendre le serveur.
    return <AssistantPageClient threadId={randomUUID()} initialMessages={[]} threads={threads} isNew />;
  }

  const thread = await getThread(user.id, requested);
  if (!thread) notFound();
  const messages = await loadMessages(thread.id);
  return <AssistantPageClient threadId={thread.id} initialMessages={messages} threads={threads} />;
}
