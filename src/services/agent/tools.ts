import { tool, type ToolSet } from "ai";

import type { Locale } from "@/i18n/config";
import { getApp, type listApps } from "@/services/apps/apps";
import {
  executeManifestTool,
  jsonSchemaToZod,
  MAX_MANIFEST_TOOLS_TOTAL,
  parseManifest,
} from "@/services/apps/manifest";
import { exposedTo, type ToolDef } from "@/services/tools/define";
import { toolRegistry } from "@/services/tools/registry";
import { describeToolFailure, isAbort, logToolFailure } from "@/services/agent/tool-log";

const RESULT_MAX_CHARS = 8000;

/**
 * A tool result goes into the next turn's prompt, so we cap its size and force
 * it to plain JSON: the SDK validates results against a JSON-value schema, and
 * a `Date` (rows straight out of the DB) makes the whole request fail.
 */
function capResult(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > RESULT_MAX_CHARS
      ? `${value.slice(0, RESULT_MAX_CHARS)}\n… (result truncated)`
      : value;
  }
  if (value === undefined) return undefined;
  const json = JSON.stringify(value ?? null);
  return json === undefined ? null : JSON.parse(json);
}

/**
 * Failing tools **throw**. The SDK then produces a `tool-output-error` part,
 * which is the only source of truth about the failure —
 * we no longer guess the status by looking for `"error"` in the output.
 *
 * The failure is logged along the way: the model often just retries another
 * way, so without the log the faulty call is invisible.
 */
function toAiTool(def: ToolDef, ctx: ToolRunContext) {
  const { userId, locale, threadId } = ctx;
  return tool({
    description: def.description,
    inputSchema: def.input,
    execute: async (args, { abortSignal, toolCallId }) => {
      const startedAt = Date.now();
      try {
        const value = await def.run({ userId, locale, signal: abortSignal }, args);
        return capResult(value);
      } catch (err) {
        if (!isAbort(err)) {
          logToolFailure(
            describeToolFailure({
              tool: def.name,
              err,
              args,
              durationMs: Date.now() - startedAt,
              userId,
              threadId,
              toolCallId,
            }),
          );
        }
        throw err;
      }
    },
  });
}

/** Tools declared by the visible apps' manifests. Name: `app_<slug>__<tool>`. */
function manifestTools(
  apps: Awaited<ReturnType<typeof listApps>>,
  ctx: ToolRunContext,
): ToolSet {
  const { userId, threadId } = ctx;
  const out: ToolSet = {};
  let count = 0;
  for (const app of apps) {
    const manifest = parseManifest(app.manifest);
    if (!manifest?.tools?.length) continue;
    for (const def of manifest.tools) {
      if (count >= MAX_MANIFEST_TOOLS_TOTAL) return out;
      count++;
      const toolName = `app_${app.slug}__${def.name}`;
      out[toolName] = tool({
        description: `${def.description} — App "${app.name}" (${app.slug}).`,
        inputSchema: jsonSchemaToZod(def.parameters),
        execute: async (args, { toolCallId }) => {
          const startedAt = Date.now();
          try {
            // Access is rechecked at execution time: the list may be stale.
            const current = await getApp(userId, app.id);
            if (!current) throw new Error("App not found.");
            return capResult(await executeManifestTool(current.id, def, args as Record<string, unknown>));
          } catch (err) {
            if (!isAbort(err)) {
              logToolFailure(
                describeToolFailure({
                  tool: toolName,
                  err,
                  args,
                  durationMs: Date.now() - startedAt,
                  userId,
                  threadId,
                  toolCallId,
                }),
              );
            }
            throw err;
          }
        },
      });
    }
  }
  return out;
}

interface ToolRunContext {
  userId: string;
  locale: Locale;
  /** Only used to correlate a tool failure with a conversation. */
  threadId?: string;
}

export interface AgentToolsOptions extends ToolRunContext {
  apps: Awaited<ReturnType<typeof listApps>>;
}

/** The shared registry's "assistant" surface + manifest tools. */
export function buildAgentTools({ userId, locale, threadId, apps }: AgentToolsOptions): ToolSet {
  const ctx: ToolRunContext = { userId, locale, threadId };
  const out: ToolSet = {};
  for (const def of toolRegistry.filter(exposedTo("assistant"))) {
    out[def.name] = toAiTool(def, ctx);
  }
  return { ...out, ...manifestTools(apps, ctx) };
}

/** Names of the tools with irreversible effects, for the confirmation prompt. */
export function destructiveToolNames(): string[] {
  return toolRegistry.filter(exposedTo("assistant")).filter((t) => t.destructive).map((t) => t.name);
}
