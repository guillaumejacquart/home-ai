import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { db, tables } from "@/db/client";
import { eq } from "drizzle-orm";

import type { LlmProvider } from "./llm";

function baseUrl(provider: LlmProvider): string {
  if (provider === "opencode-go") return env.OPENCODE_BASE_URL.replace(/\/$/, "");
  return env.OPENROUTER_BASE_URL.replace(/\/$/, "");
}

async function resolveApiKey(provider: LlmProvider): Promise<string | null> {
  const row = await db.select().from(tables.providerKeys).where(eq(tables.providerKeys.provider, provider)).get();
  if (row) {
    try {
      return decrypt(row.apiKey);
    } catch {}
  }
  const key = provider === "opencode-go" ? env.OPENCODE_API_KEY : env.OPENROUTER_API_KEY;
  return key ?? null;
}

/**
 * Retourne un modèle AI SDK pour le provider donné.
 * La clé est résolue à la demande (DB > env) pour que les surcharges en base
 * soient prises en compte sans redémarrage.
 */
export async function getAiModel(provider: LlmProvider, modelId: string) {
  const key = await resolveApiKey(provider);
  if (!key) {
    const { LlmError } = await import("./llm");
    throw new LlmError(`Provider "${provider}" non configuré (clé API manquante).`);
  }
  const client = createOpenAICompatible({
    name: provider,
    baseURL: baseUrl(provider),
    apiKey: key,
  });
  return client(modelId);
}

/**
 * Helper pour construire un provider AI SDK compatible avec le même baseUrl/key.
 * Utile si on veut passer le provider directement à streamText sans modèle.
 */
export async function getAiProvider(provider: LlmProvider) {
  const key = await resolveApiKey(provider);
  if (!key) {
    const { LlmError } = await import("./llm");
    throw new LlmError(`Provider "${provider}" non configuré (clé API manquante).`);
  }
  return createOpenAICompatible({
    name: provider,
    baseURL: baseUrl(provider),
    apiKey: key,
  });
}
