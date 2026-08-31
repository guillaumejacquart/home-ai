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
 * Transforme les pragmas `// @step Label` en `home.__pushStep("Label")` avec
 * portée implicite : chaque `// @step` ferme le précédent (pop auto dans
 * `__pushStep`) et le dernier est fermé à la fin du run (`closeImplicit`).
 * `// @endstep` reste supporté comme alias explicite de `__popStep`.
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

/** Exécute le code du script dans un sandbox node:vm et retourne sortie + trace. */
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
        setTimeout(() => reject(new ScriptError("Timeout (60s dépassé)")), RUN_TIMEOUT_MS),
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

/** Persiste la trace d'un run (chaque span = une ligne). */
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

/** Clôt un run en erreur (échec inattendu hors sandbox). */
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
 * Crée la ligne de run puis lance l'exécution sans l'attendre : l'appelant
 * choisit d'attendre `done` (cron, webhook) ou de répondre tout de suite (UI).
 */
export async function startScriptRun(
  scriptId: string,
  opts: { payload?: unknown } = {},
): Promise<{ runId: string; done: Promise<{ status: ScriptRunStatus }> }> {
  const script = await getScript(scriptId);
  if (!script) throw new ScriptError("Script introuvable.");

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

/** Exécute un script et attend la fin. */
export async function runScript(
  scriptId: string,
  opts: { payload?: unknown } = {},
): Promise<{ status: ScriptRunStatus }> {
  const { done } = await startScriptRun(scriptId, opts);
  return done;
}

/** Déroule l'exécution, enregistre le run et met à jour lastRunAt/nextRunAt. */
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
    // Sans ça le run resterait « running » indéfiniment côté client.
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

  // Rétention : ne garder les spans que des 50 derniers runs du script.
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

/** Exécute tous les scripts planifiés (trigger « schedule ») dus (appelé par le scheduler). */
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

/** Dernier run d'un script, ou undefined s'il n'a jamais tourné. */
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

/** Récupère un run précis avec sa trace complète (spans ordonnés). */
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
