import { appsTools } from "@/services/apps/tools";
import { assistantOwnTools } from "@/services/agent/own-tools";
import { connectionsTools } from "@/services/connections/tools";
import { dashboardsTools } from "@/services/dashboards/tools";
import { scriptsTools } from "@/services/scripts/tools";
import { storageTools } from "@/services/storage/tools";
import { templatesTools } from "@/services/templates/tools";

import type { ToolDef } from "./define";

/**
 * Central tool registry. One definition per tool, consumed by both surfaces
 * (assistant + MCP) — same principle as `connections/registry.ts`.
 *
 * Adding a tool = write it in its domain's `tools.ts`, then one line here.
 */
export const toolRegistry: ToolDef[] = [
  ...appsTools,
  ...scriptsTools,
  ...dashboardsTools,
  ...storageTools,
  ...connectionsTools,
  ...templatesTools,
  ...assistantOwnTools,
];

export function findTool(name: string): ToolDef | undefined {
  return toolRegistry.find((t) => t.name === name);
}
