import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { AssistantContextKind, AssistantMessageRole } from "@/db/schema";

/**
 * Storage of the generation chat (apps and scripts), on the tables
 * `assistant_threads` / `assistant_messages`.
 *
 * The conversational assistant has its own tables (`agent_*`, one row =
 * a UIMessage); this chat stays on the flat role/content schema, which is
 * enough for what it displays.
 */

function now() {
  return new Date();
}

export async function getOrCreateThread(
  userId: string,
  contextKind: Extract<AssistantContextKind, "app" | "script">,
  contextId: string,
  titleFallback: string,
): Promise<string> {
  const existing = await db
    .select({ id: tables.assistantThreads.id })
    .from(tables.assistantThreads)
    .where(
      and(
        eq(tables.assistantThreads.userId, userId),
        eq(tables.assistantThreads.contextKind, contextKind),
        eq(tables.assistantThreads.contextId, contextId),
      ),
    )
    .get();
  if (existing) return existing.id;

  const id = randomUUID();
  const ts = now();
  await db.insert(tables.assistantThreads).values({
    id,
    userId,
    title: (titleFallback.trim() || "Conversation").slice(0, 80),
    contextKind,
    contextId,
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

export interface NewMessage {
  role: AssistantMessageRole;
  content?: string;
  model?: string | null;
  versionId?: string | null;
  durationMs?: number | null;
}

export async function addMessage(threadId: string, msg: NewMessage): Promise<string> {
  const id = randomUUID();
  const ts = now();
  await db.insert(tables.assistantMessages).values({
    id,
    threadId,
    role: msg.role,
    content: msg.content ?? "",
    model: msg.model ?? null,
    versionId: msg.versionId ?? null,
    durationMs: msg.durationMs ?? null,
    createdAt: ts,
  });
  await db
    .update(tables.assistantThreads)
    .set({ updatedAt: ts })
    .where(eq(tables.assistantThreads.id, threadId));
  return id;
}

export function listMessages(threadId: string) {
  return db
    .select()
    .from(tables.assistantMessages)
    .where(eq(tables.assistantMessages.threadId, threadId))
    .orderBy(tables.assistantMessages.createdAt);
}
