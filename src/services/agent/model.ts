import { extractReasoningMiddleware, wrapLanguageModel } from "ai";

import { getAiModel } from "@/services/llm/ai-sdk";
import type { LlmProvider } from "@/services/llm/llm";

/**
 * Model ready for `streamText`. The middleware pulls `<think>` blocks out of the
 * text: OpenRouter's open-weight models emit them inline, without
 * canal reasoning natif.
 */
export async function getAgentModel(provider: LlmProvider, modelId: string) {
  const model = await getAiModel(provider, modelId);
  return wrapLanguageModel({
    model,
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
}
