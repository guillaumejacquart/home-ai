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
 * Returns an AI SDK model for the given provider.
 * The key is resolved on demand (DB > env) so database overrides take effect
 * without a restart.
 */
export async function getAiModel(provider: LlmProvider, modelId: string) {
  const key = await resolveApiKey(provider);
  if (!key) {
    const { LlmError } = await import("./llm");
    throw new LlmError(`Provider "${provider}" is not configured (missing API key).`);
  }
  const client = createOpenAICompatible({
    name: provider,
    baseURL: baseUrl(provider),
    apiKey: key,
  });
  return client(modelId);
}

/**
 * Helper building an AI SDK compatible provider with the same baseUrl/key.
 * Useful to pass the provider straight to streamText without a model.
 */
export async function getAiProvider(provider: LlmProvider) {
  const key = await resolveApiKey(provider);
  if (!key) {
    const { LlmError } = await import("./llm");
    throw new LlmError(`Provider "${provider}" is not configured (missing API key).`);
  }
  return createOpenAICompatible({
    name: provider,
    baseURL: baseUrl(provider),
    apiKey: key,
  });
}
