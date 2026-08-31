import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { AssistantMemoryKind, AssistantMemorySource } from "@/db/schema";
import { HttpError } from "@/lib/errors";

export class MemoryError extends HttpError {
  constructor(message: string, status = 400) {
    super(message, status);
  }
}

const MAX_CONTENT_CHARS = 500;
const MEMORY_BLOCK_MAX_CHARS = 2000;
const MEMORY_BLOCK_MAX_ITEMS = 40;

function now() {
  return new Date();
}

export type MemoryRow = typeof tables.assistantMemory.$inferSelect;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listMemory(userId: string): Promise<MemoryRow[]> {
  return db
    .select()
    .from(tables.assistantMemory)
    .where(eq(tables.assistantMemory.userId, userId))
    .orderBy(desc(tables.assistantMemory.pinned), desc(tables.assistantMemory.updatedAt))
    .all();
}

export async function getMemory(userId: string, id: string): Promise<MemoryRow | null> {
  const row = await db
    .select()
    .from(tables.assistantMemory)
    .where(and(eq(tables.assistantMemory.id, id), eq(tables.assistantMemory.userId, userId)))
    .get();
  return row ?? null;
}

export interface AddMemoryInput {
  kind?: AssistantMemoryKind;
  content: string;
  source?: AssistantMemorySource;
  threadId?: string | null;
  pinned?: boolean;
}

export async function addMemory(userId: string, input: AddMemoryInput): Promise<MemoryRow> {
  const content = input.content.trim();
  if (!content) throw new MemoryError("Contenu vide.");
  if (content.length > MAX_CONTENT_CHARS) throw new MemoryError(`Contenu trop long (max ${MAX_CONTENT_CHARS}).`);
  const kind: AssistantMemoryKind = input.kind ?? "fact";
  if (!["fact", "preference", "project"].includes(kind)) throw new MemoryError("Type invalide.");
  const source: AssistantMemorySource = input.source ?? "user";
  const id = randomUUID();
  const ts = now();
  await db.insert(tables.assistantMemory).values({
    id,
    userId,
    kind,
    content,
    source,
    threadId: input.threadId ?? null,
    pinned: input.pinned ?? false,
    useCount: 0,
    lastUsedAt: null,
    createdAt: ts,
    updatedAt: ts,
  });
  const row = await getMemory(userId, id);
  if (!row) throw new MemoryError("Échec de création.");
  return row;
}

export async function updateMemory(
  userId: string,
  id: string,
  patch: { content?: string; kind?: AssistantMemoryKind; pinned?: boolean },
): Promise<MemoryRow> {
  const row = await getMemory(userId, id);
  if (!row) throw new MemoryError("Souvenir introuvable.", 404);
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (patch.content !== undefined) {
    const c = patch.content.trim();
    if (!c) throw new MemoryError("Contenu vide.");
    if (c.length > MAX_CONTENT_CHARS) throw new MemoryError(`Contenu trop long (max ${MAX_CONTENT_CHARS}).`);
    (updates as Record<string, string>).content = c;
  }
  if (patch.kind !== undefined) {
    if (!["fact", "preference", "project"].includes(patch.kind)) throw new MemoryError("Type invalide.");
    (updates as Record<string, string>).kind = patch.kind;
  }
  if (patch.pinned !== undefined) (updates as Record<string, boolean>).pinned = patch.pinned;
  await db.update(tables.assistantMemory).set(updates).where(eq(tables.assistantMemory.id, id));
  const updated = await getMemory(userId, id);
  if (!updated) throw new MemoryError("Souvenir introuvable.", 404);
  return updated;
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  const row = await getMemory(userId, id);
  if (!row) throw new MemoryError("Souvenir introuvable.", 404);
  await db.delete(tables.assistantMemory).where(eq(tables.assistantMemory.id, id));
}

// ---------------------------------------------------------------------------
// Injection : bloc pour le system prompt
// ---------------------------------------------------------------------------

export async function formatMemoryBlock(userId: string): Promise<{ text: string; ids: string[] }> {
  const rows = await db
    .select()
    .from(tables.assistantMemory)
    .where(eq(tables.assistantMemory.userId, userId))
    .orderBy(desc(tables.assistantMemory.pinned), desc(tables.assistantMemory.updatedAt))
    .all();

  if (rows.length === 0) return { text: "", ids: [] };

  const picked: typeof rows = [];
  let chars = 0;
  for (const r of rows) {
    if (picked.length >= MEMORY_BLOCK_MAX_ITEMS) break;
    // "− [preference] Contenu"
    const lineLen = 6 + r.kind.length + r.content.length;
    if (chars + lineLen > MEMORY_BLOCK_MAX_CHARS && picked.length > 0) break;
    picked.push(r);
    chars += lineLen + 1;
  }

  if (picked.length === 0) return { text: "", ids: [] };

  const lines = picked.map((r) => `- [${r.kind}] ${r.content}`);
  const text = lines.join("\n");
  return { text, ids: picked.map((r) => r.id) };
}

export async function touchMemory(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const ts = now();
  for (const id of ids) {
    const row = await db.select().from(tables.assistantMemory).where(eq(tables.assistantMemory.id, id)).get();
    if (!row) continue;
    await db
      .update(tables.assistantMemory)
      .set({ lastUsedAt: ts, useCount: (row.useCount ?? 0) + 1 })
      .where(eq(tables.assistantMemory.id, id));
  }
}

// ---------------------------------------------------------------------------
// Extraction : best-effort, appelée en fire-and-forget après un tour
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  // Le modèle peut entourer de ```json
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // Tente d'extraire le premier objet JSON
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = withoutFence.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

export function parseExtractionPayload(raw: string): { save: { kind: AssistantMemoryKind; content: string }[] } | null {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  const saveRaw = p.save;
  if (!Array.isArray(saveRaw)) return { save: [] };
  const save: { kind: AssistantMemoryKind; content: string }[] = [];
  for (const item of saveRaw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const content = typeof it.content === "string" ? it.content.trim() : "";
    if (!content || content.length > MAX_CONTENT_CHARS) continue;
    const kind: AssistantMemoryKind =
      it.kind === "preference" || it.kind === "project" ? (it.kind as AssistantMemoryKind) : "fact";
    save.push({ kind, content });
  }
  return { save: save.slice(0, 5) };
}

/** Prompt d'extraction : utilisé avec le modèle planificateur. */
export function buildExtractionPrompt(
  existingMemories: MemoryRow[],
  userMessage: string,
  assistantAnswer: string,
): string {
  const existing =
    existingMemories.length === 0
      ? "(aucun souvenir enregistré)"
      : existingMemories
          .slice(0, 30)
          .map((m) => `- [${m.kind}] ${m.content} (id: ${m.id})`)
          .join("\n");
  return `Tu es un extracteur de souvenirs pour un assistant familial. À partir du dernier échange, décide s'il faut mémoriser des faits durables.

Souvenirs existants :
${existing}

Dernier échange :
Utilisateur : ${userMessage.slice(0, 1200)}
Assistant : ${assistantAnswer.slice(0, 1200)}

RÈGLES :
- Ne sauvegarde QUE des faits durables : préférences, projets en cours, contexte familial, contraintes récurrentes.
- Ignore les questions ponctuelles, les demandes d'action immédiate, les remerciements, les sujets éphémères.
- Ne duplique pas un souvenir déjà présent. Reformule plutôt si la nuance est nouvelle.
- Contenu : une phrase courte, en français, max 200 caractères.
- Si rien de durable, renvoie {"save": []}.

Réponds UNIQUEMENT avec ce JSON :
{"save": [{"kind": "fact"|"preference"|"project", "content": "..."}]}`;
}

export function buildTitlePrompt(userMessage: string, assistantAnswer: string): string {
  return `Génère un titre très court (3 à 6 mots, max 60 caractères) pour cette conversation. Pas de guillemets, pas de point final. Réponds uniquement avec le titre.

Utilisateur : ${userMessage.slice(0, 500)}
Assistant : ${assistantAnswer.slice(0, 500)}`;
}

const FOLLOWUP_MAX = 3;

export function buildFollowupPrompt(userMessage: string, assistantAnswer: string): string {
  return `À partir de cet échange, propose 2 à 3 relances courtes (max 60 caractères chacune) que l'utilisateur pourrait vouloir dire ensuite. Si l'échange est trivial ("merci", "ok"), renvoie un tableau vide.

Utilisateur : ${userMessage.slice(0, 800)}
Assistant : ${assistantAnswer.slice(0, 800)}

Réponds UNIQUEMENT avec ce JSON : {"suggestions": ["...","..."]}`;
}

export function parseFollowups(raw: string): string[] {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== "object") return [];
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p.suggestions)) return [];
  const out: string[] = [];
  for (const s of p.suggestions) {
    if (typeof s !== "string") continue;
    const t = s.trim();
    if (!t || t.length > 80) continue;
    out.push(t);
    if (out.length >= FOLLOWUP_MAX) break;
  }
  return out;
}

export function parseTitle(raw: string): string | null {
  const t = raw.trim().replace(/^["'«»]+|["'«»]+$/g, "").split("\n")[0]?.trim() ?? "";
  if (!t || t.length > 80) return null;
  // Filtre les refus / phrases trop longues
  if (t.length < 3) return null;
  return t.slice(0, 80);
}
