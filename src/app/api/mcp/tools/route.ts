import { listApps } from "@/services/apps/apps";
import { parseManifest } from "@/services/apps/manifest";
import { route } from "@/lib/route";
import { appsTools } from "@/services/apps/tools";
import { assistantOwnTools } from "@/services/agent/own-tools";
import { connectionsTools } from "@/services/connections/tools";
import { dashboardsTools } from "@/services/dashboards/tools";
import { scriptsTools } from "@/services/scripts/tools";
import { storageTools } from "@/services/storage/tools";
import { templatesTools } from "@/services/templates/tools";
import { exposedTo } from "@/services/tools/define";
import { toolRegistry } from "@/services/tools/registry";

function zodShapeToJson(shape: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(shape)) {
    // Cheap description: use zod's description or type name if available
    const def = val as { description?: string; _def?: { typeName?: string } };
    out[key] = def.description ?? def._def?.typeName ?? "unknown";
  }
  return out;
}

const CATEGORY_BY_NAME = new Map<string, string>();
for (const t of appsTools) CATEGORY_BY_NAME.set(t.name, "apps");
for (const t of scriptsTools) CATEGORY_BY_NAME.set(t.name, "scripts");
for (const t of dashboardsTools) CATEGORY_BY_NAME.set(t.name, "dashboards");
for (const t of storageTools) CATEGORY_BY_NAME.set(t.name, "storage");
for (const t of connectionsTools) CATEGORY_BY_NAME.set(t.name, "connections");
for (const t of templatesTools) CATEGORY_BY_NAME.set(t.name, "templates");
for (const t of assistantOwnTools) CATEGORY_BY_NAME.set(t.name, "assistant");

export const GET = route({
  handler: async ({ user }) => {
    const registryTools = toolRegistry.filter(exposedTo("mcp")).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      destructive: t.destructive,
      source: "registry" as const,
      category: CATEGORY_BY_NAME.get(t.name) ?? "other",
      inputSchema: zodShapeToJson(t.input.shape as Record<string, unknown>),
    }));

    const apps = await listApps(user.id);
    const manifestTools: {
      name: string;
      title: string;
      description: string;
      destructive: boolean;
      source: "registry" | "manifest";
      category: string;
      appId: string;
      appSlug: string;
      appName: string;
      inputSchema: Record<string, unknown>;
    }[] = [];
    for (const app of apps) {
      const manifest = parseManifest(app.manifest);
      if (!manifest?.tools?.length) continue;
      for (const tool of manifest.tools) {
        manifestTools.push({
          name: `app_${app.slug}__${tool.name}`,
          title: tool.name,
          description: `${tool.description} — App "${app.name}" (${app.slug}).`,
          destructive: false,
          source: "manifest" as const,
          category: "app-manifest",
          appId: app.id,
          appSlug: app.slug,
          appName: app.name,
          inputSchema: (tool.parameters ?? {}) as Record<string, unknown>,
        });
      }
    }

    const manifestApps = [...new Map(manifestTools.map((t) => [t.appId, { id: t.appId, slug: t.appSlug, name: t.appName }])).values()];

    return {
      tools: [...registryTools, ...manifestTools],
      counts: { registry: registryTools.length, manifest: manifestTools.length, total: registryTools.length + manifestTools.length },
      manifestApps,
      categories: [...new Set(registryTools.map((t) => t.category))].sort(),
    };
  },
});
