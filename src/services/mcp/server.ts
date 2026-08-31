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

/** Wraps a tool result into MCP text content. */
function text(content: unknown): { content: { type: "text"; text: string }[] } {
  const value = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return { content: [{ type: "text", text: value }] };
}

/**
 * MCP surface for the tool registry.
 *
 * The definitions live in each domain's `tools.ts` and are gathered by
 * `services/tools/registry.ts`; this file only
 * adapts them to the protocol. No tool is added here anymore — except the
 * dynamic ones declared by the apps' manifests.
 *
 * Every tool is bound to the authenticated user (session or Bearer token) and
 * reuses the existing services — never a direct database read.
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
 * Registers one MCP tool per tool declared in each visible app's manifest.
 * Name: `app_<slug>__<tool>`. Every handler rechecks access to the app
 * via `getApp` before acting on its storage. Global cap to avoid an explosion.
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
          description: `${tool.description} — App "${app.name}" (${app.slug}).`,
          inputSchema: jsonSchemaToZod(tool.parameters),
        },
        async (args) => {
          const t0 = Date.now();
          try {
            const current = await getApp(userId, app.id);
            if (!current) {
              const err = { error: "App not found." };
              void logMcpCall(userId, {
                toolName,
                args,
                result: err,
                status: "error",
                error: "App not found.",
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
