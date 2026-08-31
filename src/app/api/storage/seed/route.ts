import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api-helpers";
import { route } from "@/lib/route";
import { storageKind } from "@/db/schema";
import { getApp } from "@/services/apps/apps";
import { canWriteScript, getScript } from "@/services/scripts/scripts";
import { chatCompletionStream } from "@/services/llm/llm";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { storageKeySchema } from "@/services/storage/schemas";
import {
  appScope,
  scriptScope,
  globalScope,
  storageSet,
  type StorageScope,
} from "@/services/storage/storage";

/** Extrait le JSON le plus externe (objet ou tableau) d'une réponse LLM. */
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

    // Portée visée + contrôle d'accès.
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
        ? "tableau d'objets homogènes (chaque objet avec un champ `id` unique)"
        : "valeur JSON";
    const system = `Tu es un assistant qui prépare des données d'exemple pour une app familiale. Réponds UNIQUEMENT avec un JSON valide : un ${target}. Pas de texte autour.`;
    const userContent = `Génère ${kind === "table" ? "5 à 8 éléments réalistes pour" : "une valeur réaliste pour"} la clé « ${body.key} ».
Contexte de la demande : ${body.prompt}
${kind === "table" ? "Les objets doivent être homogènes (mêmes champs)." : ""}`;

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
