import { db, tables } from "@/db/client";
import { and, eq } from "drizzle-orm";
import {
  addMessage as addAssistantMessage,
  getOrCreateThread,
  listMessages as listAssistantMessages,
} from "@/services/messages/threads";

export interface NewGenerationMessage {
  ownerId: string;
  appId?: string | null;
  scriptId?: string | null;
  role: "user" | "assistant" | "plan";
  content: string;
  model?: string;
  versionId?: string;
  durationMs?: number;
}

/** Ajoute un message de chat de génération, désormais via assistant_threads/messages. */
export async function addGenerationMessage(msg: NewGenerationMessage) {
  if (!msg.appId && !msg.scriptId) {
    throw new Error("Un message de génération doit être rattaché à une app ou un script.");
  }
  const kind = msg.scriptId ? "script" : "app";
  const contextId = (msg.scriptId ?? msg.appId) as string;
  // Titre = début du contenu, sera utilisé seulement à la création du thread
  const title = msg.content.slice(0, 80) || (kind === "app" ? "App chat" : "Script chat");
  const threadId = await getOrCreateThread(msg.ownerId, kind as "app" | "script", contextId, title);
  return addAssistantMessage(threadId, {
    role: msg.role,
    content: msg.content,
    model: msg.model,
    versionId: msg.versionId,
    durationMs: msg.durationMs,
  });
}

export async function listGenerationMessages(filter: { appId?: string; scriptId?: string }) {
  if (filter.scriptId) return listScriptMessages(filter.scriptId);
  if (filter.appId) return listAppMessages(filter.appId);
  return [];
}

/** Messages du chat d'une app. */
export async function listAppMessages(appId: string) {
  // On cherche le thread par context sans userId (apps ont un owner unique)
  // On parcourt les threads app avec ce contextId.
  const thread = await db
    .select()
    .from(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "app"), eq(tables.assistantThreads.contextId, appId)))
    .get();
  if (!thread) return [];
  const rows = await listAssistantMessages(thread.id);
  // Mapper vers l'ancien shape (generation_messages)
  return rows.map((r) => ({
    id: r.id,
    appId,
    scriptId: null,
    ownerId: thread.userId,
    role: r.role as "user" | "assistant" | "plan",
    content: r.content,
    model: r.model,
    versionId: r.versionId,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
  }));
}

/** Messages du chat de génération d'un script. */
export async function listScriptMessages(scriptId: string) {
  const thread = await db
    .select()
    .from(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "script"), eq(tables.assistantThreads.contextId, scriptId)))
    .get();
  if (!thread) return [];
  const rows = await listAssistantMessages(thread.id);
  return rows.map((r) => ({
    id: r.id,
    appId: null,
    scriptId,
    ownerId: thread.userId,
    role: r.role as "user" | "assistant" | "plan",
    content: r.content,
    model: r.model,
    versionId: r.versionId,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
  }));
}

/** Helpers bas niveau pour les callers qui veulent le threadId (utilisé par les tests). */
export async function getAppThreadId(appId: string): Promise<string | null> {
  const t = await db
    .select({ id: tables.assistantThreads.id })
    .from(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "app"), eq(tables.assistantThreads.contextId, appId)))
    .get();
  return t?.id ?? null;
}

export async function getScriptThreadId(scriptId: string): Promise<string | null> {
  const t = await db
    .select({ id: tables.assistantThreads.id })
    .from(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "script"), eq(tables.assistantThreads.contextId, scriptId)))
    .get();
  return t?.id ?? null;
}
