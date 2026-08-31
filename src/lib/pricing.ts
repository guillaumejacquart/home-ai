/** LLM cost estimation: indicative per-model prices (USD per 1000 tokens). */

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

// Indicative prices (USD / 1000 tokens) - update against real provider rates
const PRICING_TABLE: Record<string, ModelPricing> = {
  "deepseek-v4-flash": { promptPer1k: 0.00027, completionPer1k: 0.0011 },
  deepseek: { promptPer1k: 0.00027, completionPer1k: 0.0011 },
  "glm-5.3": { promptPer1k: 0.0005, completionPer1k: 0.0015 },
  glm: { promptPer1k: 0.0005, completionPer1k: 0.0015 },
  "muse-spark-1.2": { promptPer1k: 0.0002, completionPer1k: 0.0008 },
  "muse-spark": { promptPer1k: 0.0002, completionPer1k: 0.0008 },
};

const DEFAULT_PRICING: ModelPricing = { promptPer1k: 0.0005, completionPer1k: 0.001 };

export function getPricingForModel(model: string): ModelPricing | null {
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(PRICING_TABLE)) {
    if (lower.includes(key)) return pricing;
  }
  return null;
}

export function estimateCostMicros(
  model: string,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): number | null {
  const p = promptTokens ?? 0;
  const c = completionTokens ?? 0;
  if (p === 0 && c === 0) return null;
  const pricing = getPricingForModel(model) ?? DEFAULT_PRICING;
  const cost = (p / 1000) * pricing.promptPer1k + (c / 1000) * pricing.completionPer1k;
  return Math.round(cost * 1_000_000);
}

export function formatCostMicros(micros: number | null | undefined): string {
  if (micros == null) return "—";
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR");
}
