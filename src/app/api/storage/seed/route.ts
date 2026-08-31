import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { storageKind } from "@/db/schema";
import { getApp } from "@/services/apps/apps";
import { canWriteScript, getScript } from "@/services/scripts/scripts";
import { chatCompletionStream } from "@/services/llm/llm";
import { languageInstruction } from "@/services/generation/shared";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { storageKeySchema } from "@/services/storage/schemas";
import {
  appScope,
  scriptScope,
  globalScope,
  storageSet,
  type StorageScope,
} from "@/services/storage/storage";

/** Extracts the outermost JSON value (object or array) from an LLM response. */
function extractJson(text: string): string | null {
  const candidates = [text.match(/\{[\s\S]*\}/), text.match(/\[[\s\S]*\]/)];
  for (const m of candidates) {
    if (!m) continue;
    try {
      JSON.parse(m[0]);
      return m[0];
    } catch {
      continue;
    }
  }
  return null;
}

export const POST = route({
  body: z.object({
    scope: z.enum(["app", "script", "global"], "invalidContent"),
    id: z.string().optional(),
    key: storageKeySchema,
    prompt: z.string("promptRequired").min(1, "promptRequired"),
    kind: z.enum(storageKind).catch("kv"),
  }),
  handler: async ({ user, body }) => {
    const { kind } = body;

    // Target scope + access check.
    let ownerId = user.id;
    let appId: string | null = null;
    let scriptId: string | null = null;
    let scope: StorageScope;
    if (body.scope === "app") {
      const app = await getApp(user.id, body.id ?? "");
      if (!app) return errorResponse("appNotFound", 404);
      appId = app.id;
      ownerId = app.ownerId;
      scope = appScope(app.id);
    } else if (body.scope === "script") {
      const row = await getScript(body.id ?? "", user.id);
      if (!row) return errorResponse("scriptNotFound", 404);
      if (!canWriteScript(user.id, row)) return errorResponse("forbidden", 403);
      scriptId = row.id;
      ownerId = row.ownerId;
      scope = scriptScope(row.id);
    } else {
      scope = globalScope(ownerId);
    }

    const defaults = await getEffectiveDefaults(user.id);
    const target =
      kind === "table"
        ? "an array of homogeneous objects (each object with a unique `id` field)"
        : "a JSON value";
    const system = `You are an assistant preparing sample data for a family app. Reply with ONLY valid JSON: ${target}. No surrounding text.${languageInstruction()}`;
    const userContent = `Generate ${kind === "table" ? "5 to 8 realistic items for" : "a realistic value for"} the key "${body.key}".
Request context: ${body.prompt}
${kind === "table" ? "The objects must be homogeneous (same fields)." : ""}`;

    const { text } = await chatCompletionStream(
      [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      {
        provider: defaults.provider,
        model: defaults.coderModel,
        maxTokens: 2048,
        userId: user.id,
        feature: "storage_seed",
        appId,
        scriptId,
      },
    );

    const json = extractJson(text);
    if (!json) {
      return NextResponse.json(
        { error: "Le modèle n'a pas produit de JSON valide. Réessayez." },
        { status: 400 },
      );
    }
    const value = JSON.parse(json);
    await storageSet(scope, body.key, value, { kind, visibility: "private" });
    return { key: body.key, value };
  },
});
