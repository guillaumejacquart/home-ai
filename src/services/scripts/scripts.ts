import { and, desc, eq, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";

import { db, tables } from "@/db/client";
import type { AppVisibility, ScriptTriggerKind } from "@/db/schema";
import { HttpError } from "@/lib/errors";

export class ScriptError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

function now() {
  return new Date();
}

/** A script is scheduled when its trigger is "schedule". */
export function isScheduled(triggerKind: ScriptTriggerKind): boolean {
  return triggerKind === "schedule";
}

function isWebhook(triggerKind: ScriptTriggerKind): boolean {
  return triggerKind === "webhook";
}

/** Unique public slug for an incoming webhook's URL. */
export function generateWebhookSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Shared secret of the inbound webhook (32 hex chars). */
export function generateWebhookSecret(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Computes the next run time of a 5-field cron expression. */
export function computeNextRun(schedule: string, from = new Date()): Date {
  if (!schedule.trim()) throw new ScriptError("A schedule is required for a scheduled script.");
  try {
    const interval = CronExpressionParser.parse(schedule, { currentDate: from });
    return interval.next().toDate();
  } catch {
    throw new ScriptError(`Invalid cron expression: "${schedule}"`);
  }
}

/** Returns null for an empty (unscheduled) or invalid schedule. */
export function nextRunOrNull(schedule: string): Date | null {
  if (!schedule.trim()) return null;
  try {
    return computeNextRun(schedule);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface NewScriptInput {
  ownerId: string;
  visibility?: AppVisibility;
  triggerKind?: ScriptTriggerKind;
  name: string;
  /** 5-field cron expression; empty ("") for an unscheduled trigger. */
  schedule: string;
  code: string;
  prompt?: string;
}

/** Records a snapshot of the script (incremented version). */
async function snapshotScriptVersion(
  scriptId: string,
  name: string,
  schedule: string,
  code: string,
  prompt?: string,
) {
  const last = await db
    .select({ version: tables.scriptVersions.version })
    .from(tables.scriptVersions)
    .where(eq(tables.scriptVersions.scriptId, scriptId))
    .orderBy(desc(tables.scriptVersions.version))
    .get();
  const version = (last?.version ?? 0) + 1;
  const id = randomUUID();
  await db.insert(tables.scriptVersions).values({
    id,
    scriptId,
    version,
    name,
    schedule,
    code,
    prompt,
    createdAt: now(),
  });
  return { id, version };
}

export async function createScript(input: NewScriptInput) {
  const id = randomUUID();
  const triggerKind = input.triggerKind ?? "schedule";
  const schedule = input.schedule ?? "";
  if (isScheduled(triggerKind) && !schedule.trim()) {
    throw new ScriptError("A schedule (5-field cron expression) is required for a scheduled script.");
  }
  const nextRunAt = isScheduled(triggerKind) ? computeNextRun(schedule) : null;
  const webhookSlug = isWebhook(triggerKind) ? generateWebhookSlug() : null;
  const webhookSecret = isWebhook(triggerKind) ? generateWebhookSecret() : null;
  await db.insert(tables.scripts).values({
    id,
    ownerId: input.ownerId,
    visibility: input.visibility ?? "private",
    triggerKind,
    name: input.name,
    schedule: isScheduled(triggerKind) ? schedule : "",
    webhookSlug,
    webhookSecret,
    code: input.code,
    enabled: true,
    nextRunAt,
    createdAt: now(),
    updatedAt: now(),
  });
  // Version initiale v1.
  await snapshotScriptVersion(id, input.name, isScheduled(triggerKind) ? schedule : "", input.code, input.prompt);
  return id;
}

export async function listScripts(userId: string) {
  return db
    .select({
      id: tables.scripts.id,
      ownerId: tables.scripts.ownerId,
      visibility: tables.scripts.visibility,
      triggerKind: tables.scripts.triggerKind,
      name: tables.scripts.name,
      schedule: tables.scripts.schedule,
      webhookSlug: tables.scripts.webhookSlug,
      enabled: tables.scripts.enabled,
      nextRunAt: tables.scripts.nextRunAt,
      lastRunAt: tables.scripts.lastRunAt,
      updatedAt: tables.scripts.updatedAt,
    })
    .from(tables.scripts)
    .where(or(eq(tables.scripts.ownerId, userId), eq(tables.scripts.visibility, "family")))
    .orderBy(desc(tables.scripts.updatedAt));
}

/**
 * Returns a script. `userId` is optional: without it the row is returned with
 * no access check (internal use by the runner).
 */
export async function getScript(scriptId: string, userId?: string) {
  const conditions = [eq(tables.scripts.id, scriptId)];
  if (userId) conditions.push(canReadScriptSql(userId));
  return db
    .select()
    .from(tables.scripts)
    .where(and(...conditions))
    .get();
}

/** SQL condition for "the user can read this script" (owner or family). */
function canReadScriptSql(userId: string) {
  return sql`(${tables.scripts.ownerId} = ${userId} OR ${tables.scripts.visibility} = 'family')`;
}

/** Lecture : owner ou script family. */
export function canReadScript(
  userId: string,
  script: { ownerId: string; visibility: string },
): boolean {
  return script.ownerId === userId || script.visibility === "family";
}

/** Writes: only the owner can modify/run/delete. */
export function canWriteScript(userId: string, script: { ownerId: string }): boolean {
  return script.ownerId === userId;
}

/** Scripts the user can trigger (only the owner runs them). */
export async function listOwnedScripts(ownerId: string) {
  return db
    .select({
      id: tables.scripts.id,
      name: tables.scripts.name,
      triggerKind: tables.scripts.triggerKind,
      enabled: tables.scripts.enabled,
      lastRunAt: tables.scripts.lastRunAt,
    })
    .from(tables.scripts)
    .where(eq(tables.scripts.ownerId, ownerId))
    .orderBy(desc(tables.scripts.updatedAt));
}

/** Resolves one of the owner's scripts by id or exact name (case-insensitive). */
export async function findOwnedScript(ownerId: string, idOrName: string) {
  const needle = idOrName.trim();
  if (!needle) return undefined;
  return db
    .select()
    .from(tables.scripts)
    .where(
      and(
        eq(tables.scripts.ownerId, ownerId),
        or(
          eq(tables.scripts.id, needle),
          sql`lower(${tables.scripts.name}) = lower(${needle})`,
        ),
      ),
    )
    .get();
}

/** Cherche un script par son slug de webhook entrant (route publique). */
export async function getScriptByWebhookSlug(slug: string) {
  const row = await db
    .select()
    .from(tables.scripts)
    .where(eq(tables.scripts.webhookSlug, slug))
    .get();
  return row;
}

export async function updateScript(
  userId: string,
  scriptId: string,
  patch: {
    name?: string;
    triggerKind?: ScriptTriggerKind;
    schedule?: string;
    code?: string;
    enabled?: boolean;
    prompt?: string;
    visibility?: AppVisibility;
  },
) {
  const script = await getScript(scriptId, userId);
  if (!script) throw new ScriptError("Script not found.");
  if (!canWriteScript(userId, script)) throw new ScriptError("Action not allowed.");

  const update: Record<string, unknown> = { updatedAt: now() };

  // Resolve the trigger (the script's own by default) and the schedule.
  const triggerKind = patch.triggerKind ?? (script.triggerKind as ScriptTriggerKind);
  const triggerChanged = patch.triggerKind !== undefined && patch.triggerKind !== script.triggerKind;
  if (triggerChanged) {
    update.triggerKind = triggerKind;
  }
  // We only recompute the next run if the schedule changes or we flip
  // to a scheduled trigger (a plain rename does not shift the run time).
  const recomputeSchedule =
    patch.schedule !== undefined || (triggerChanged && triggerKind === "schedule");

  if (isScheduled(triggerKind)) {
    const effectiveSchedule = patch.schedule !== undefined ? patch.schedule : script.schedule;
    if (!effectiveSchedule.trim()) {
      throw new ScriptError("A schedule (5-field cron expression) is required for a scheduled script.");
    }
    update.schedule = effectiveSchedule;
    if (recomputeSchedule) update.nextRunAt = computeNextRun(effectiveSchedule);
  } else {
    update.schedule = "";
    update.nextRunAt = null;
    if (isWebhook(triggerKind)) {
      if (triggerChanged || !script.webhookSlug) update.webhookSlug = script.webhookSlug ?? generateWebhookSlug();
      if (triggerChanged || !script.webhookSecret) update.webhookSecret = script.webhookSecret ?? generateWebhookSecret();
    } else {
      update.webhookSlug = null;
      update.webhookSecret = null;
    }
  }

  if (patch.name !== undefined) update.name = patch.name;
  if (patch.code !== undefined) update.code = patch.code;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  await db.update(tables.scripts).set(update).where(eq(tables.scripts.id, scriptId));

  // Snapshot the new version when the code or the name/schedule changed.
  const onlyToggle = Object.keys(patch).every((k) => k === "enabled" || k === "prompt");
  if (!onlyToggle) {
    await snapshotScriptVersion(
      scriptId,
      (patch.name ?? script.name) as string,
      (update.schedule as string) ?? script.schedule,
      (patch.code ?? script.code) as string,
      patch.prompt,
    );
  }
}

export async function listScriptVersions(scriptId: string) {
  return db
    .select()
    .from(tables.scriptVersions)
    .where(eq(tables.scriptVersions.scriptId, scriptId))
    .orderBy(desc(tables.scriptVersions.version));
}

export async function getScriptVersion(scriptId: string, versionId: string) {
  return db
    .select()
    .from(tables.scriptVersions)
    .where(and(eq(tables.scriptVersions.id, versionId), eq(tables.scriptVersions.scriptId, scriptId)))
    .get();
}

/** Restores a version: applies its content and records a new "restore" snapshot. */
export async function restoreScriptVersion(
  userId: string,
  scriptId: string,
  versionId: string,
) {
  const script = await getScript(scriptId, userId);
  if (!script) throw new ScriptError("Script not found.");
  if (!canWriteScript(userId, script)) throw new ScriptError("Action not allowed.");
  const version = await getScriptVersion(scriptId, versionId);
  if (!version) throw new ScriptError("Version not found.");

  await db
    .update(tables.scripts)
    .set({
      name: version.name,
      schedule: version.schedule,
      code: version.code,
      nextRunAt: nextRunOrNull(version.schedule),
      updatedAt: now(),
    })
    .where(eq(tables.scripts.id, scriptId));

  await snapshotScriptVersion(
    scriptId,
    version.name,
    version.schedule,
    version.code,
    `Restauration de v${version.version}`,
  );

  return { version: version.version };
}

export async function deleteScript(userId: string, scriptId: string) {
  const script = await getScript(scriptId, userId);
  if (!script) throw new ScriptError("Script not found.");
  if (!canWriteScript(userId, script)) throw new ScriptError("Action not allowed.");
  await db
    .delete(tables.assistantThreads)
    .where(and(eq(tables.assistantThreads.contextKind, "script"), eq(tables.assistantThreads.contextId, scriptId)));
  await db.delete(tables.scripts).where(eq(tables.scripts.id, scriptId));
}
