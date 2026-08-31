import { extractReasoningMiddleware, wrapLanguageModel } from "ai";

import { getAiModel } from "@/services/llm/ai-sdk";
import type { LlmProvider } from "@/services/llm/llm";

/**
 * Modèle prêt pour `streamText`. Le middleware sort les blocs `<think>` du
 * texte : les modèles open-weight d'OpenRouter les émettent inline, sans
 * canal reasoning natif.
 */
export async function getAgentModel(provider: LlmProvider, modelId: string) {
  const model = await getAiModel(provider, modelId);
  return wrapLanguageModel({
    model,
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}
