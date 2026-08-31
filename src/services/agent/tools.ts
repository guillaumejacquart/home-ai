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
 * Un résultat d'outil part dans le prompt du tour suivant : on borne la taille.
 * Les objets sont rendus tels quels, le SDK les sérialise.
 */
function capResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.length > RESULT_MAX_CHARS
    ? `${value.slice(0, RESULT_MAX_CHARS)}\n… (résultat tronqué)`
    : value;
}

/**
 * Les outils qui échouent **lèvent**. Le SDK produit alors une part
 * `tool-output-error`, ce qui est la seule source de vérité sur l'échec —
 * on ne devine plus le statut en cherchant `"error"` dans la sortie.
 *
 * L'échec est journalisé au passage : le modèle, lui, se contente souvent de
 * réessayer autrement, donc sans log l'appel fautif est invisible.
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

/** Outils déclarés par le manifeste des apps visibles. Nom : `app_<slug>__<tool>`. */
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
        description: `${def.description} — App « ${app.name} » (${app.slug}).`,
        inputSchema: jsonSchemaToZod(def.parameters),
        execute: async (args, { toolCallId }) => {
          const startedAt = Date.now();
          try {
            // L'accès est revérifié à l'exécution : la liste peut avoir vieilli.
            const current = await getApp(userId, app.id);
            if (!current) throw new Error("App introuvable.");
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
  /** Sert uniquement à corréler un échec d'outil à une conversation. */
  threadId?: string;
}

export interface AgentToolsOptions extends ToolRunContext {
  apps: Awaited<ReturnType<typeof listApps>>;
}

/** Surface « assistant » du registre partagé + outils de manifeste. */
export function buildAgentTools({ userId, locale, threadId, apps }: AgentToolsOptions): ToolSet {
  const ctx: ToolRunContext = { userId, locale, threadId };
  const out: ToolSet = {};
  for (const def of toolRegistry.filter(exposedTo("assistant"))) {
    out[def.name] = toAiTool(def, ctx);
  }
  return { ...out, ...manifestTools(apps, ctx) };
}

/** Noms des outils à effets irréversibles, pour le prompt de confirmation. */
export function destructiveToolNames(): string[] {
  return toolRegistry.filter(exposedTo("assistant")).filter((t) => t.destructive).map((t) => t.name);
}
