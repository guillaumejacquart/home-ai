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

/** Journal pinned at the top, the rest sorted by most recent activity. */
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
    // New thread: we fix the id here so the client can update the URL on the
    // first message, without waiting on the server.
    return <AssistantPageClient threadId={randomUUID()} initialMessages={[]} threads={threads} isNew />;
  }

  const thread = await getThread(user.id, requested);
  if (!thread) notFound();
  const messages = await loadMessages(thread.id);
  return <AssistantPageClient threadId={thread.id} initialMessages={messages} threads={threads} />;
}
