import { randomUUID } from "node:crypto";

import type { SpanKind, SpanOrigin } from "@/db/schema";
import { buildScriptSdk, type TracedScriptSdk } from "@/services/scripts/sdk";

const MAX_SPAN_PAYLOAD = 4096;

/** In-memory span (not persisted yet: runId is assigned on insert). */
export interface TraceSpan {
  id: string;
  seq: number;
  kind: SpanKind;
  origin?: SpanOrigin;
  label?: string | null;
  method?: string | null;
  args?: string | null;
  result?: string | null;
  status: "success" | "error";
  error?: string | null;
  startedAt: Date;
  durationMs?: number | null;
  parentId: string | null;
}

export interface TracedHome {
  home: TracedScriptSdk;
  spans: TraceSpan[];
  /** Intercepted console: pushes a `log` span under the current step. */
  logLine: (text: string, isError?: boolean) => void;
  /** Closes implicit steps still open (end of run / @endstep). */
  closeImplicit: () => void;
}

function truncateJson(value: unknown): string | null {
  if (value === undefined) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json == null) return null;
  if (json.length > MAX_SPAN_PAYLOAD) return json.slice(0, MAX_SPAN_PAYLOAD) + "… (truncated)";
  return json;
}

/**
 * Wraps the script SDK with tracing: every `home.*` call becomes a `call` span,
 * and `home.step(label, fn)` a `step` span (children = nested calls).
 * The `__pushStep`/`__popStep` methods implement the `// @step` pragma with
 * implicit scope (auto pop on the next `__pushStep` or at the end).
 */
export function createTracedHome(
  ownerId: string,
  runId?: string,
  scriptId?: string,
  webhookPayload?: unknown,
): TracedHome {
  const raw = buildScriptSdk(ownerId, { runId, scriptId, webhookPayload }) as TracedScriptSdk;
  const spans: TraceSpan[] = [];
  const activeStack: TraceSpan[] = [];
  let seq = 0;

  function pushSpan(partial: Omit<TraceSpan, "id" | "seq" | "status">): TraceSpan {
    const span: TraceSpan = {
      ...partial,
      id: randomUUID(),
      seq: seq++,
      status: "success",
    };
    spans.push(span);
    return span;
  }

  function markError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function closeSpan(span: TraceSpan, status: "success" | "error", error?: string | null) {
    span.status = status;
    if (error !== undefined) span.error = error;
    span.durationMs = Date.now() - span.startedAt.getTime();
  }

  /** Also marks open steps as failed when a child call fails. */
  function markOpenStepsError(message: string) {
    for (const open of activeStack) {
      if (open.status !== "error") {
        open.status = "error";
        open.error = message;
      }
    }
  }

  function traceLeaf(method: string, fn: (...args: unknown[]) => Promise<unknown>) {
    return async (...args: unknown[]): Promise<unknown> => {
      const span = pushSpan({
        kind: "call",
        method,
        args: truncateJson(args),
        parentId: activeStack.at(-1)?.id ?? null,
        startedAt: new Date(),
      });
      try {
        const result = await fn(...args);
        span.result = truncateJson(result);
        closeSpan(span, "success");
        return result;
      } catch (err) {
        const message = markError(err);
        span.error = message;
        closeSpan(span, "error");
        markOpenStepsError(message);
        throw err;
      }
    };
  }

  /** Groups a phase: calls made inside `fn` become its children. */
  async function step(label: string, fn: () => unknown): Promise<unknown> {
    const span = pushSpan({
      kind: "step",
      label,
      origin: "explicit",
      parentId: activeStack.at(-1)?.id ?? null,
      startedAt: new Date(),
    });
    activeStack.push(span);
    try {
      const result = await fn();
      closeSpan(span, "success");
      return result;
    } catch (err) {
      const message = markError(err);
      closeSpan(span, "error", message);
      throw err;
    } finally {
      // Close implicit steps left open inside this step.
      while (activeStack.at(-1) && activeStack.at(-1)!.origin === "implicit") {
        closeSpan(activeStack.pop()!, "success");
      }
      if (activeStack.at(-1)?.id === span.id) activeStack.pop();
    }
  }

  /** Implicit scope: the previous `// @step` is closed before opening a new one. */
  function __pushStep(label: string): string {
    if (activeStack.at(-1)?.origin === "implicit") {
      closeSpan(activeStack.pop()!, "success");
    }
    const span = pushSpan({
      kind: "step",
      label,
      origin: "implicit",
      parentId: activeStack.at(-1)?.id ?? null,
      startedAt: new Date(),
    });
    activeStack.push(span);
    return span.id;
  }

  function __popStep(): void {
    const top = activeStack.pop();
    if (top) closeSpan(top, "success");
  }

  function closeImplicit(): void {
    while (activeStack.at(-1)?.origin === "implicit") {
      closeSpan(activeStack.pop()!, "success");
    }
  }

  function logLine(text: string, isError = false): void {
    pushSpan({
      kind: "log",
      label: isError ? "ERR " + text : text,
      parentId: activeStack.at(-1)?.id ?? null,
      startedAt: new Date(),
    });
  }

  raw.step = step;
  raw.__pushStep = __pushStep;
  raw.__popStep = __popStep;

  return { home: makeTraceProxy(raw, "", traceLeaf), spans, logLine, closeImplicit };
}

type LeafTracer = (
  method: string,
  fn: (...args: unknown[]) => Promise<unknown>,
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Recursive proxy: functions become traced calls, objects are walked to keep the
 * same shape as `ScriptSdk`. `step`/`__pushStep`/`__popStep` (already defined on
 * `raw`) are left untouched.
 */
function makeTraceProxy(
  obj: TracedScriptSdk,
  path: string,
  traceLeaf: LeafTracer,
): TracedScriptSdk {
  const SPECIAL = new Set(["step", "__pushStep", "__popStep"]);
  // `home.app(id)` builds a namespace, it is not a call to trace.
  const FACTORIES = new Set(["app"]);

  const traced = new Proxy(obj, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        if (SPECIAL.has(prop as string)) return value;
        if (FACTORIES.has(prop as string) && !path) {
          return (...args: unknown[]) =>
            makeTraceProxy(
              (value as (...a: unknown[]) => TracedScriptSdk)(...args),
              `${String(prop)}(${args.map((a) => JSON.stringify(a)).join(", ")})`,
              traceLeaf,
            );
        }
        const method = path ? `${path}.${String(prop)}` : String(prop);
        return traceLeaf(method, value as (...args: unknown[]) => Promise<unknown>);
      }
      if (value !== null && typeof value === "object") {
        return makeTraceProxy(
          value as TracedScriptSdk,
          path ? `${path}.${String(prop)}` : String(prop),
          traceLeaf,
        );
      }
      return value;
    },
  });
  return traced;
}
