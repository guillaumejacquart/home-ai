import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";

import { db, tables } from "@/db/client";
import type { AgentContextKind } from "@/db/schema";
import { HttpError } from "@/lib/errors";

export class AgentError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

export type AgentThread = typeof tables.agentThreads.$inferSelect;

const TITLE_MAX = 80;

function now() {
  return new Date();
}

function title(raw: string): string {
  return raw.trim().slice(0, TITLE_MAX) || "Conversation";
}

/** Fil de l'utilisateur, ou null s'il n'existe pas / ne lui appartient pas. */
export async function getThread(userId: string, threadId: string): Promise<AgentThread | null> {
  const row = await db
    .select()
    .from(tables.agentThreads)
    .where(and(eq(tables.agentThreads.id, threadId), eq(tables.agentThreads.userId, userId)))
    .get();
  return row ?? null;
}

export async function createThread(
  userId: string,
  rawTitle: string,
  opts?: { id?: string; contextKind?: AgentContextKind; contextId?: string | null },
): Promise<string> {
  const id = opts?.id ?? randomUUID();
  const ts = now();
  await db.insert(tables.agentThreads).values({
    id,
    userId,
    title: title(rawTitle),
    contextKind: opts?.contextKind ?? "assistant",
    contextId: opts?.contextId ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

export function listThreads(userId: string, opts?: { contextKind?: AgentContextKind }) {
  const where = opts?.contextKind
    ? and(eq(tables.agentThreads.userId, userId), eq(tables.agentThreads.contextKind, opts.contextKind))
    : eq(tables.agentThreads.userId, userId);
  return db
    .select()
    .from(tables.agentThreads)
    .where(where)
    .orderBy(desc(tables.agentThreads.updatedAt));
}

export async function getThreadByContext(
  userId: string,
  contextKind: AgentContextKind,
  contextId: string,
): Promise<AgentThread | null> {
  const row = await db
    .select()
    .from(tables.agentThreads)
    .where(
      and(
        eq(tables.agentThreads.userId, userId),
        eq(tables.agentThreads.contextKind, contextKind),
        eq(tables.agentThreads.contextId, contextId),
      ),
    )
    .get();
  return row ?? null;
}

export async function getOrCreateThreadForContext(
  userId: string,
  contextKind: AgentContextKind,
  contextId: string,
  titleFallback: string,
): Promise<string> {
  const existing = await getThreadByContext(userId, contextKind, contextId);
  if (existing) return existing.id;
  return createThread(userId, titleFallback, { contextKind, contextId });
}

/**
 * Le client génère l'id du fil et le garde d'un tour à l'autre : on crée à la
 * demande sous cet id. Évite d'avoir à renvoyer un id au client en cours de
 * stream, et rend la reprise d'un fil idempotente.
 */
export async function ensureThread(
  userId: string,
  threadId: string,
  titleFallback: string,
  opts?: { contextKind?: AgentContextKind; contextId?: string | null },
): Promise<{ thread: AgentThread; created: boolean }> {
  const existing = await getThread(userId, threadId);
  if (existing) return { thread: existing, created: false };

  // Id déjà pris par un autre utilisateur : on refuse plutôt que d'écraser.
  const foreign = await db
    .select({ id: tables.agentThreads.id })
    .from(tables.agentThreads)
    .where(eq(tables.agentThreads.id, threadId))
    .get();
  if (foreign) throw new AgentError("Conversation introuvable.");

  await createThread(userId, titleFallback, { id: threadId, ...opts });
  const thread = await getThread(userId, threadId);
  if (!thread) throw new AgentError("Création du fil impossible.");
  return { thread, created: true };
}

export async function deleteThread(userId: string, threadId: string): Promise<void> {
  const thread = await getThread(userId, threadId);
  if (!thread) throw new AgentError("Conversation introuvable.");
  await db.delete(tables.agentThreads).where(eq(tables.agentThreads.id, threadId));
}

export async function updateThreadTitle(userId: string, threadId: string, rawTitle: string): Promise<void> {
  const t = rawTitle.trim().slice(0, TITLE_MAX);
  if (!t) return;
  await db
    .update(tables.agentThreads)
    .set({ title: t, updatedAt: now() })
    .where(and(eq(tables.agentThreads.id, threadId), eq(tables.agentThreads.userId, userId)));
}

// ---------------------------------------------------------------------------
// Messages : UIMessage <-> ligne. `parts` est stocké tel quel en JSON.
// ---------------------------------------------------------------------------

function parseParts(raw: string): UIMessage["parts"] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage["parts"]) : [];
  } catch {
    return [];
  }
}

/** Historique d'un fil, prêt pour l'UI et pour convertToModelMessages. */
export async function loadMessages(threadId: string): Promise<UIMessage[]> {
  const rows = await db
    .select()
    .from(tables.agentMessages)
    .where(eq(tables.agentMessages.threadId, threadId))
    .orderBy(asc(tables.agentMessages.seq));
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: parseParts(row.parts),
  }));
}

/**
 * Écrit l'état complet du fil. Le SDK fournit la liste à jour dans `onEnd`,
 * donc on upsert par id : pas de persistance incrémentale à resynchroniser.
 */
export async function saveMessages(
  threadId: string,
  messages: UIMessage[],
  opts?: { model?: string | null },
): Promise<void> {
  if (messages.length === 0) return;
  const ts = now();
  for (const [seq, message] of messages.entries()) {
    const values = {
      id: message.id,
      threadId,
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      parts: JSON.stringify(message.parts ?? []),
      model: message.role === "assistant" ? (opts?.model ?? null) : null,
      seq,
      createdAt: ts,
    };
    await db
      .insert(tables.agentMessages)
      .values(values)
      .onConflictDoUpdate({
        target: tables.agentMessages.id,
        set: { parts: values.parts, seq, role: values.role },
      });
  }
  await db
    .update(tables.agentThreads)
    .set({ updatedAt: ts })
    .where(eq(tables.agentThreads.id, threadId));
}

/** Ajoute un message déjà formé (brief quotidien, message système d'app…). */
export async function appendMessage(
  threadId: string,
  message: Pick<UIMessage, "role" | "parts">,
  opts?: { model?: string | null },
): Promise<string> {
  const existing = await db
    .select({ seq: tables.agentMessages.seq })
    .from(tables.agentMessages)
    .where(eq(tables.agentMessages.threadId, threadId))
    .orderBy(desc(tables.agentMessages.seq))
    .limit(1)
    .get();
  const id = randomUUID();
  const ts = now();
  await db.insert(tables.agentMessages).values({
    id,
    threadId,
    role: message.role === "assistant" ? "assistant" : "user",
    parts: JSON.stringify(message.parts ?? []),
    model: opts?.model ?? null,
    seq: (existing?.seq ?? -1) + 1,
    createdAt: ts,
  });
  await db
    .update(tables.agentThreads)
    .set({ updatedAt: ts })
    .where(eq(tables.agentThreads.id, threadId));
  return id;
}

/** Concatène le texte d'un message : utilisé pour les titres et l'extraction mémoire. */
export function messageText(message: Pick<UIMessage, "parts">): string {
  return (message.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}
