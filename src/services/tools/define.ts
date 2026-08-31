import { z } from "zod";

import type { Locale } from "@/i18n/config";

/**
 * Définition unique d'un outil, consommée par les deux surfaces :
 * l'assistant (`services/agent/tools.ts`) et MCP (`services/mcp/server.ts`).
 *
 * Même principe que `connections/registry.ts` : la définition vit à côté du
 * service qu'elle expose, et les surfaces ne font que l'adapter.
 */

export type ToolSurface = "assistant" | "mcp";

export const ALL_SURFACES: ToolSurface[] = ["assistant", "mcp"];

export interface ToolContext {
  userId: string;
  locale: Locale;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface ToolInput<S extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  /** Libellé court affiché par les clients MCP (défaut : `name`). */
  title?: string;
  description: string;
  /** Schéma zod des arguments. Doit être un objet : MCP consomme `.shape`. */
  input: S;
  /** Surfaces d'exposition (défaut : les deux). */
  exposure?: ToolSurface[];
  /** Action irréversible : l'assistant demande confirmation avant d'exécuter. */
  destructive?: boolean;
  /** Reçoit des arguments **déjà validés** par `input`. */
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}

/** Forme uniforme stockée dans le registre (le schéma générique est effacé). */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  exposure: ToolSurface[];
  destructive: boolean;
  /** Valide les arguments puis exécute le handler. */
  run: (ctx: ToolContext, args: unknown) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(def: ToolInput<S>): ToolDef {
  return {
    name: def.name,
    title: def.title ?? def.name,
    description: def.description,
    input: def.input,
    exposure: def.exposure ?? ALL_SURFACES,
    destructive: def.destructive ?? false,
    // La validation vit ici : les deux surfaces en profitent, et le handler
    // reçoit des arguments typés (plus de `String(x)` défensif).
    // `async` est important : un échec de validation doit donner une promesse
    // rejetée, pas une exception synchrone que l'appelant ne verrait pas.
    run: async (ctx, args) => def.handler(ctx, def.input.parse(args ?? {})),
  };
}

export function exposedTo(surface: ToolSurface) {
  return (t: ToolDef) => t.exposure.includes(surface);
}
