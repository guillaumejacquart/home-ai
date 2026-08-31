import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

import { db, tables } from "@/db/client";
import type { ScriptRunStatus } from "@/db/schema";
import {
  createTracedHome,
  type TraceSpan,
} from "@/services/scripts/traced-sdk";
import { ScriptError, getScript, nextRunOrNull } from "@/services/scripts/scripts";
import { closeBrowserSessionsForRun } from "@/services/browser/sessions";

const RUN_TIMEOUT_MS = 60_000;

function now() {
  return new Date();
}

/**
 * Transforms `// @step Label` pragmas into `home.__pushStep("Label")` with
 * implicit scope: every `// @step` closes the previous one (auto pop in
 * `__pushStep`) and the last one is closed at the end of the run
 * (`closeImplicit`). `// @endstep` is still supported as an explicit alias of
 * `__popStep`.
 */
export function transformPragmas(code: string): string {
  let out = code.replace(/^[ \t]*\/\/[ \t]*@step[ \t]+(.+?)[ \t]*$/gm, (match, label: string) => {
    const indent = match.match(/^([ \t]*)/)?.[1] ?? "";
    let trimmed = label.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      trimmed = trimmed.slice(1, -1);
    }
    return `${indent}home.__pushStep(${JSON.stringify(trimmed)});`;
  });
  out = out.replace(/^[ \t]*\/\/[ \t]*@endstep[ \t]*$/gm, (match) => {
    const indent = match.match(/^([ \t]*)/)?.[1] ?? "";
    return `${indent}home.__popStep();`;
  });
  return out;
}

/** Runs the script code in a node:vm sandbox and returns output + trace. */
async function executeScriptCode(
  code: string,
  ownerId: string,
  scriptId: string,
  runId: string,
  webhookPayload?: unknown,
): Promise<{ output: string; spans: TraceSpan[]; error?: string }> {
  const { home, spans, logLine, closeImplicit } = createTracedHome(
    ownerId,
    runId,
    scriptId,
    webhookPayload,
  );
  const logs: string[] = [];

  const sandbox: Record<string, unknown> = {
    home,
    console: {
      log: (...args: unknown[]) => {
        const line = args.map(String).join(" ");
        logs.push(line);
        logLine(line);
      },
      error: (...args: unknown[]) => {
        const line = "ERR " + args.map(String).join(" ");
        logs.push(line);
        logLine(line, true);
      },
    },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
  };

  const context = vm.createContext(sandbox);
  const script = `(async function() { ${transformPragmas(code)}\n; return (typeof main === 'function') ? await main(home) : undefined; })()`;

  let value: unknown;
  let error: string | undefined;
  try {
    const promise = vm.runInContext(script, context, { timeout: RUN_TIMEOUT_MS }) as Promise<unknown>;
    value = await Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new ScriptError("Timeout (60s exceeded)")), RUN_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    closeImplicit();
  }

  const out = logs.join("\n");
  const resultStr =
    value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return { output: [out, resultStr].filter(Boolean).join("\n"), spans, error };
}

/** Persists a run's trace (each span = one row). */
async function persistSpans(runId: string, spans: TraceSpan[]) {
  if (spans.length === 0) return;
  await db.insert(tables.scriptRunSpans).values(
    spans.map((s) => ({
      id: s.id,
      runId,
      parentId: s.parentId ?? null,
      seq: s.seq,
      kind: s.kind,
      origin: s.origin ?? null,
      label: s.label ?? null,
      method: s.method ?? null,
      args: s.args ?? null,
      result: s.result ?? null,
      status: s.status,
      error: s.error ?? null,
      startedAt: s.startedAt,
      durationMs: s.durationMs ?? null,
    })),
  );
}

type ScriptRow = NonNullable<Awaited<ReturnType<typeof getScript>>>;

/** Closes a run in error (unexpected failure outside the sandbox). */
async function failRun(runId: string, err: unknown, durationMs: number) {
  await db
    .update(tables.scriptRuns)
    .set({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs,
      finishedAt: now(),
    })
    .where(eq(tables.scriptRuns.id, runId));
}

/**
 * Creates the run row then starts execution without awaiting it: the caller
 * chooses to await `done` (cron, webhook) or answer immediately (UI).
 */
export async function startScriptRun(
  scriptId: string,
  opts: { payload?: unknown } = {},
): Promise<{ runId: string; done: Promise<{ status: ScriptRunStatus }> }> {
  const script = await getScript(scriptId);
  if (!script) throw new ScriptError("Script not found.");

  const runId = randomUUID();
  const startedAt = now();
  await db.insert(tables.scriptRuns).values({
    id: runId,
    scriptId,
    status: "running",
    startedAt,
  });

  return { runId, done: executeRun(script, runId, startedAt, opts.payload) };
}

/** Runs a script and waits for it to finish. */
export async function runScript(
  scriptId: string,
  opts: { payload?: unknown } = {},
): Promise<{ status: ScriptRunStatus }> {
  const { done } = await startScriptRun(scriptId, opts);
  return done;
}

/** Drives the execution, records the run and updates lastRunAt/nextRunAt. */
async function executeRun(
  script: ScriptRow,
  runId: string,
  startedAt: Date,
  payload: unknown,
): Promise<{ status: ScriptRunStatus }> {
  const scriptId = script.id;
  let status: ScriptRunStatus = "success";
  let output: string | null = null;
  let error: string | null = null;

  const t0 = Date.now();
  let res: Awaited<ReturnType<typeof executeScriptCode>>;
  try {
    res = await executeScriptCode(script.code, script.ownerId, script.id, runId, payload);
  } catch (err) {
    // Without this the run would stay "running" forever on the client.
    await failRun(runId, err, Date.now() - t0);
    throw err;
  } finally {
    await closeBrowserSessionsForRun(runId);
  }
  if (res.error) {
    status = res.error.startsWith("Timeout") ? "timeout" : "error";
    error = res.error;
  } else {
    output = res.output;
  }
  await persistSpans(runId, res.spans);

  const durationMs = Date.now() - t0;
  await db
    .update(tables.scriptRuns)
    .set({
      status,
      output,
      error,
      durationMs,
      finishedAt: now(),
    })
    .where(eq(tables.scriptRuns.id, runId));

  // Retention: keep spans only for the script's last 50 runs.
  await db.delete(tables.scriptRunSpans).where(sql`${tables.scriptRunSpans.runId} IN (
    SELECT ${tables.scriptRuns.id} FROM ${tables.scriptRuns}
    WHERE ${tables.scriptRuns.scriptId} = ${scriptId}
    ORDER BY ${tables.scriptRuns.startedAt} DESC
    LIMIT -1 OFFSET 50
  )`);

  await db
    .update(tables.scripts)
    .set({
      lastRunAt: startedAt,
      nextRunAt: script.enabled ? nextRunOrNull(script.schedule) : script.nextRunAt,
      updatedAt: now(),
    })
    .where(eq(tables.scripts.id, scriptId));

  return { status };
}

/** Runs every due scheduled script (the "schedule" trigger) — called by the scheduler. */
export async function runDueScripts() {
  const due = await db
    .select()
    .from(tables.scripts)
    .where(
      and(
        eq(tables.scripts.enabled, true),
        eq(tables.scripts.triggerKind, "schedule"),
        sql`${tables.scripts.nextRunAt} IS NOT NULL AND ${tables.scripts.nextRunAt} <= unixepoch()`,
      ),
    )
    .all();
  for (const script of due) {
    await runScript(script.id);
  }
  return due.length;
}

/** A script's last run, or undefined when it has never run. */
export async function lastScriptRun(scriptId: string) {
  return db
    .select()
    .from(tables.scriptRuns)
    .where(eq(tables.scriptRuns.scriptId, scriptId))
    .orderBy(desc(tables.scriptRuns.startedAt))
    .get();
}

export async function getScriptRun(runId: string) {
  return db.select().from(tables.scriptRuns).where(eq(tables.scriptRuns.id, runId)).get();
}

export async function listScriptRuns(scriptId: string, limit = 50) {
  return db
    .select()
    .from(tables.scriptRuns)
    .where(eq(tables.scriptRuns.scriptId, scriptId))
    .orderBy(desc(tables.scriptRuns.startedAt))
    .limit(limit);
}

/** Returns a specific run with its full trace (ordered spans). */
export async function getScriptRunWithSpans(runId: string) {
  const run = await db
    .select()
    .from(tables.scriptRuns)
    .where(eq(tables.scriptRuns.id, runId))
    .get();
  if (!run) return null;
  const spans = await db
    .select()
    .from(tables.scriptRunSpans)
    .where(eq(tables.scriptRunSpans.runId, runId))
    .orderBy(tables.scriptRunSpans.seq)
    .all();
  return { run, spans };
}
