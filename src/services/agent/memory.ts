import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import type { AssistantMemoryKind, AssistantMemorySource } from "@/db/schema";
import { HttpError } from "@/lib/errors";
import { languageInstruction } from "@/services/generation/shared";

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
  if (!content) throw new MemoryError("Content is empty.");
  if (content.length > MAX_CONTENT_CHARS) throw new MemoryError(`Content too long (max ${MAX_CONTENT_CHARS}).`);
  const kind: AssistantMemoryKind = input.kind ?? "fact";
  if (!["fact", "preference", "project"].includes(kind)) throw new MemoryError("Invalid type.");
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
  if (!row) throw new MemoryError("Creation failed.");
  return row;
}

export async function updateMemory(
  userId: string,
  id: string,
  patch: { content?: string; kind?: AssistantMemoryKind; pinned?: boolean },
): Promise<MemoryRow> {
  const row = await getMemory(userId, id);
  if (!row) throw new MemoryError("Memory not found.", 404);
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (patch.content !== undefined) {
    const c = patch.content.trim();
    if (!c) throw new MemoryError("Content is empty.");
    if (c.length > MAX_CONTENT_CHARS) throw new MemoryError(`Content too long (max ${MAX_CONTENT_CHARS}).`);
    (updates as Record<string, string>).content = c;
  }
  if (patch.kind !== undefined) {
    if (!["fact", "preference", "project"].includes(patch.kind)) throw new MemoryError("Invalid type.");
    (updates as Record<string, string>).kind = patch.kind;
  }
  if (patch.pinned !== undefined) (updates as Record<string, boolean>).pinned = patch.pinned;
  await db.update(tables.assistantMemory).set(updates).where(eq(tables.assistantMemory.id, id));
  const updated = await getMemory(userId, id);
  if (!updated) throw new MemoryError("Memory not found.", 404);
  return updated;
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  const row = await getMemory(userId, id);
  if (!row) throw new MemoryError("Memory not found.", 404);
  await db.delete(tables.assistantMemory).where(eq(tables.assistantMemory.id, id));
}

// ---------------------------------------------------------------------------
// Injection: block for the system prompt
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
    // "- [preference] Content"
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
// Extraction: best-effort, called fire-and-forget after a turn
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  // The model may wrap it in ```json
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  // Try to extract the first JSON object
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

/** Extraction prompt: used with the planner model. */
export function buildExtractionPrompt(
  existingMemories: MemoryRow[],
  userMessage: string,
  assistantAnswer: string,
): string {
  const existing =
    existingMemories.length === 0
      ? "(no memories recorded)"
      : existingMemories
          .slice(0, 30)
          .map((m) => `- [${m.kind}] ${m.content} (id: ${m.id})`)
          .join("\n");
  return `You extract memories for a household assistant. From the latest exchange, decide whether any durable facts are worth remembering.

Existing memories:
${existing}

Latest exchange:
User: ${userMessage.slice(0, 1200)}
Assistant: ${assistantAnswer.slice(0, 1200)}

RULES:
- Save ONLY durable facts: preferences, ongoing projects, household context, recurring constraints.
- Ignore one-off questions, immediate action requests, thanks, and ephemeral topics.
- Do not duplicate a memory that is already there. Rephrase instead when the nuance is new.
- Content: one short sentence, max 200 characters.
- If nothing is durable, return {"save": []}.

Answer ONLY with this JSON:
{"save": [{"kind": "fact"|"preference"|"project", "content": "..."}]}${languageInstruction()}`;
}

export function buildTitlePrompt(userMessage: string, assistantAnswer: string): string {
  return `Generate a very short title (3 to 6 words, max 60 characters) for this conversation. No quotes, no trailing period. Answer with the title only.

User: ${userMessage.slice(0, 500)}
Assistant: ${assistantAnswer.slice(0, 500)}${languageInstruction()}`;
}

const FOLLOWUP_MAX = 3;

export function buildFollowupPrompt(userMessage: string, assistantAnswer: string): string {
  return `From this exchange, suggest 2 to 3 short follow-ups (max 60 characters each) the user might want to say next. If the exchange is trivial ("thanks", "ok"), return an empty array.

User: ${userMessage.slice(0, 800)}
Assistant: ${assistantAnswer.slice(0, 800)}

Answer ONLY with this JSON: {"suggestions": ["...","..."]}${languageInstruction()}`;
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
  // Filter out refusals and over-long sentences
  if (t.length < 3) return null;
  return t.slice(0, 80);
}
