import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getApp, listApps } from "@/services/apps/apps";
import {
  executeManifestTool,
  jsonSchemaToZod,
  MAX_MANIFEST_TOOLS_TOTAL,
  parseManifest,
} from "@/services/apps/manifest";
import { logMcpCall } from "@/services/mcp/calls";
import { exposedTo } from "@/services/tools/define";
import { toolRegistry } from "@/services/tools/registry";

/** Enveloppe le résultat d'un outil en contenu texte MCP. */
function text(content: unknown): { content: { type: "text"; text: string }[] } {
  const value = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return { content: [{ type: "text", text: value }] };
}

/**
 * Surface MCP du registre d'outils.
 *
 * Les définitions vivent dans le `tools.ts` de chaque domaine et sont
 * rassemblées par `services/tools/registry.ts` ; ce fichier ne fait que les
 * adapter au protocole. On n'ajoute donc plus d'outil ici — sauf les tools
 * dynamiques déclarés par le manifeste des apps.
 *
 * Chaque outil est lié à l'utilisateur authentifié (session ou token Bearer)
 * et réutilise les services existants — jamais de lecture directe de la base.
 */
export async function buildMcpServer(
  userId: string,
  opts: { tokenPrefix?: string | null } = {},
): Promise<McpServer> {
  const server = new McpServer(
    { name: "home-ai", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerRegistryTools(server, userId, opts.tokenPrefix ?? null);
  await registerManifestTools(server, userId, opts.tokenPrefix ?? null);

  return server;
}

function registerRegistryTools(server: McpServer, userId: string, tokenPrefix: string | null): void {
  for (const tool of toolRegistry.filter(exposedTo("mcp"))) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input.shape,
      },
      async (args) => {
        const t0 = Date.now();
        try {
          const result = await tool.run({ userId, locale: "fr" }, args);
          void logMcpCall(userId, {
            toolName: tool.name,
            args,
            result,
            status: "success",
            durationMs: Date.now() - t0,
            tokenPrefix,
          });
          return text(result);
        } catch (err) {
          void logMcpCall(userId, {
            toolName: tool.name,
            args,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - t0,
            tokenPrefix,
          });
          throw err;
        }
      },
    );
  }
}

/**
 * Enregistre un tool MCP par tool déclaré dans le manifeste de chaque app
 * visible. Nom : `app_<slug>__<tool>`. Chaque handler revérifie l'accès à l'app
 * via `getApp` avant d'agir sur son storage. Cap global pour ne pas exploser.
 */
async function registerManifestTools(
  server: McpServer,
  userId: string,
  tokenPrefix: string | null,
): Promise<void> {
  const apps = await listApps(userId);
  let count = 0;
  for (const app of apps) {
    const manifest = parseManifest(app.manifest);
    if (!manifest?.tools?.length) continue;
    for (const tool of manifest.tools) {
      if (count >= MAX_MANIFEST_TOOLS_TOTAL) return;
      const toolName = `app_${app.slug}__${tool.name}`;
      server.registerTool(
        toolName,
        {
          title: tool.name,
          description: `${tool.description} — App « ${app.name} » (${app.slug}).`,
          inputSchema: jsonSchemaToZod(tool.parameters),
        },
        async (args) => {
          const t0 = Date.now();
          try {
            const current = await getApp(userId, app.id);
            if (!current) {
              const err = { error: "App introuvable." };
              void logMcpCall(userId, {
                toolName,
                args,
                result: err,
                status: "error",
                error: "App introuvable.",
                durationMs: Date.now() - t0,
                tokenPrefix,
              });
              return text(err);
            }
            const result = await executeManifestTool(current.id, tool, args as Record<string, unknown>);
            void logMcpCall(userId, {
              toolName,
              args,
              result,
              status: "success",
              durationMs: Date.now() - t0,
              tokenPrefix,
            });
            return text(result);
          } catch (err) {
            void logMcpCall(userId, {
              toolName,
              args,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - t0,
              tokenPrefix,
            });
            throw err;
          }
        },
      );
      count++;
    }
  }
}
