import { appsTools } from "@/services/apps/tools";
import { assistantOwnTools } from "@/services/agent/own-tools";
import { connectionsTools } from "@/services/connections/tools";
import { dashboardsTools } from "@/services/dashboards/tools";
import { scriptsTools } from "@/services/scripts/tools";
import { storageTools } from "@/services/storage/tools";
import { templatesTools } from "@/services/templates/tools";

import type { ToolDef } from "./define";

/**
 * Registre central des outils. Une définition par outil, consommée par les
 * deux surfaces (assistant + MCP) — même principe que `connections/registry.ts`.
 *
 * Ajouter un outil = l'écrire dans le `tools.ts` de son domaine, puis une ligne ici.
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
