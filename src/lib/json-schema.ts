import { z } from "zod";

/**
 * Conversion légère JSON Schema → zod (cas usuels générés par le LLM).
 * Framework-agnostic : importable depuis le client (contrairement aux
 * services, qui tirent la DB). Anciennement dans services/apps/manifest.ts.
 */

export function jsonSchemaToZod(
  params: Record<string, unknown> | undefined,
): z.ZodTypeAny {
  const props =
    params && typeof params === "object"
      ? ((params as { properties?: unknown }).properties as
          | Record<string, { type?: string }>
          | undefined)
      : undefined;
  if (!props || typeof props !== "object") return z.record(z.string(), z.unknown());
  const required = Array.isArray((params as { required?: unknown }).required)
    ? ((params as { required: unknown[] }).required.filter((r) => typeof r === "string") as string[])
    : [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, def] of Object.entries(props)) {
    const type = def?.type;
    let zod: z.ZodTypeAny;
    if (type === "string") zod = z.string();
    else if (type === "integer") zod = z.number().int();
    else if (type === "number") zod = z.number();
    else if (type === "boolean") zod = z.boolean();
    else if (type === "array") zod = z.array(z.unknown());
    else zod = z.unknown();
    shape[name] = required.includes(name) ? zod : zod.optional();
  }
  return z.object(shape).catchall(z.unknown());
}
