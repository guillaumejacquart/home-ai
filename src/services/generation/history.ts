import { getThreadByContext, loadMessages, messageText } from "@/services/agent/threads";
import type { GenerationHistoryEntry } from "@/services/generation/shared";

/**
 * Generation context, derived from the assistant thread.
 *
 * The retired generation chat used to keep its own transcript
 * (assistant_threads/messages). Now the assistant thread is the only record:
 * user messages carry the requests, `plan_*` / `generate_*` tool outputs carry
 * the plans. The planner/coder context is built from those.
 */

// Tool parts whose output carries a plan (see PlanCardPart.readPlan).
const PLAN_TOOL_TYPES = new Set([
  "tool-plan_app",
  "tool-plan_script",
  "tool-generate_app",
  "tool-generate_script",
]);

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

/** Reads the plan out of a `plan_*` / `generate_*` tool part output. */
function readPlan(output: unknown): string | null {
  const plan = asObject(output)?.plan;
  if (typeof plan === "string" && plan.trim()) return plan;
  if (typeof output === "string" && output.trim().length > 20) return output;
  return null;
}

/**
 * Past requests and plans for an app or a script, derived from its assistant
 * thread. Returns [] when there is no thread (e.g. MCP-created artifacts).
 */
export async function getGenerationHistory(
  ownerId: string,
  ctx: { appId?: string; scriptId?: string },
): Promise<GenerationHistoryEntry[]> {
  const kind = ctx.scriptId ? ("script" as const) : ("app" as const);
  const contextId = (ctx.scriptId ?? ctx.appId) as string;
  if (!contextId) return [];
  const thread = await getThreadByContext(ownerId, kind, contextId);
  if (!thread) return [];
  const messages = await loadMessages(thread.id);
  const out: GenerationHistoryEntry[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = messageText(message);
      if (content) out.push({ role: "user", content });
      continue;
    }
    for (const part of message.parts ?? []) {
      if (!part || typeof part !== "object") continue;
      const { type, output } = part as { type?: unknown; output?: unknown };
      if (typeof type === "string" && PLAN_TOOL_TYPES.has(type)) {
        const plan = readPlan(output);
        if (plan) out.push({ role: "plan", content: plan });
      }
    }
  }
  return out;
}
