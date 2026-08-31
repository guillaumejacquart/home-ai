import { z } from "zod";

/**
 * Lightweight JSON Schema → zod conversion (the usual LLM-generated cases).
 * Framework-agnostic: importable from the client (unlike the services, which
 * pull in the database).
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
