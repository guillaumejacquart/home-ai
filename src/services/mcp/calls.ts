import { randomUUID } from "node:crypto";

import { and, desc, eq, lt } from "drizzle-orm";

import { db, tables } from "@/db/client";

const ARGS_MAX = 4000;
const RESULT_MAX = 4000;

function trunc(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? `${value.slice(0, max)}…(${value.length}c)` : value;
}

function stringify(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface LogMcpCallInput {
  toolName: string;
  args?: unknown;
  result?: unknown;
  status: "success" | "error";
  error?: string | null;
  durationMs?: number | null;
  tokenPrefix?: string | null;
}

/** Persists an MCP call — best-effort, never fails the caller. */
export async function logMcpCall(userId: string, input: LogMcpCallInput): Promise<void> {
  try {
    await db.insert(tables.mcpToolCalls).values({
      id: randomUUID(),
      userId,
      toolName: input.toolName,
      tokenPrefix: input.tokenPrefix ?? null,
      args: trunc(stringify(input.args), ARGS_MAX),
      result: trunc(stringify(input.result), RESULT_MAX),
      status: input.status,
      error: input.error ? trunc(input.error, 800) : null,
      durationMs: input.durationMs ?? null,
      createdAt: new Date(),
    });
  } catch {
    // Logging must not break tool execution
  }
}

export interface ListMcpCallsOptions {
  limit?: number;
  toolName?: string;
}

export async function listMcpCalls(userId: string, opts: ListMcpCallsOptions = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = opts.toolName
    ? and(eq(tables.mcpToolCalls.userId, userId), eq(tables.mcpToolCalls.toolName, opts.toolName))
    : eq(tables.mcpToolCalls.userId, userId);
  const rows = await db
    .select()
    .from(tables.mcpToolCalls)
    .where(where)
    .orderBy(desc(tables.mcpToolCalls.createdAt))
    .limit(limit);
  return rows;
}

/** Deletes calls older than `maxAgeMs` (defaults to 30 days) and keeps at most `keepMax` per user. */
export async function pruneMcpCalls(
  userId?: string,
  opts: { maxAgeMs?: number; keepMax?: number } = {},
): Promise<void> {
  const maxAgeMs = opts.maxAgeMs ?? 30 * 24 * 3600 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);
  if (userId) {
    await db.delete(tables.mcpToolCalls).where(and(eq(tables.mcpToolCalls.userId, userId), lt(tables.mcpToolCalls.createdAt, cutoff)));
    if (opts.keepMax) {
      const keepIds = await db
        .select({ id: tables.mcpToolCalls.id })
        .from(tables.mcpToolCalls)
        .where(eq(tables.mcpToolCalls.userId, userId))
        .orderBy(desc(tables.mcpToolCalls.createdAt))
        .limit(opts.keepMax);
      if (keepIds.length === opts.keepMax) {
        const keepSet = new Set(keepIds.map((r) => r.id));
        const all = await db
          .select({ id: tables.mcpToolCalls.id })
          .from(tables.mcpToolCalls)
          .where(eq(tables.mcpToolCalls.userId, userId));
        const toDelete = all.filter((r) => !keepSet.has(r.id)).map((r) => r.id);
        for (const id of toDelete) {
          await db.delete(tables.mcpToolCalls).where(eq(tables.mcpToolCalls.id, id));
        }
      }
    }
  } else {
    await db.delete(tables.mcpToolCalls).where(lt(tables.mcpToolCalls.createdAt, cutoff));
  }
}
