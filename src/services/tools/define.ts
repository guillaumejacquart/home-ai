import { z } from "zod";

import type { Locale } from "@/i18n/config";

/**
 * Single definition of a tool, consumed by both surfaces:
 * the assistant (`services/agent/tools.ts`) and MCP (`services/mcp/server.ts`).
 *
 * Same principle as `connections/registry.ts`: the definition lives next to the
 * service it exposes, and the surfaces only adapt it.
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
  /** Short label shown by MCP clients (defaults to `name`). */
  title?: string;
  description: string;
  /** zod schema of the arguments. Must be an object: MCP consumes `.shape`. */
  input: S;
  /** Exposure surfaces (defaults to both). */
  exposure?: ToolSurface[];
  /** Irreversible action: the assistant asks for confirmation before running. */
  destructive?: boolean;
  /** Receives arguments **already validated** by `input`. */
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}

/** Uniform shape stored in the registry (the generic schema is erased). */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  exposure: ToolSurface[];
  destructive: boolean;
  /** Validates the arguments then runs the handler. */
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
    // Validation lives here: both surfaces benefit, and the handler
    // receives typed arguments (no more defensive `String(x)`).
    // `async` matters: a validation failure must produce a rejected promise,
    // not a synchronous throw the caller would not see.
    run: async (ctx, args) => def.handler(ctx, def.input.parse(args ?? {})),
  };
}

export function exposedTo(surface: ToolSurface) {
  return (t: ToolDef) => t.exposure.includes(surface);
}
