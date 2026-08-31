import type { Locale } from "@/i18n/config";
import {
  chatCompletionDetailed,
  chatCompletionStream,
  LlmError,
  type ChatMessage,
  type LlmOptions,
  type LlmProvider,
} from "@/services/llm/llm";

/** Options shared by both app and script generation. */
export interface GenerateOptions {
  provider?: LlmProvider;
  plannerModel?: string;
  coderModel?: string;
  /** Expected language for produced text (generated UI, summaries, names). */
  locale?: Locale;
  /** Trigger of the generated script: schedule (default), manual or webhook. */
  triggerKind?: "schedule" | "manual" | "webhook";
  /** LLM usage tracking */
  userId?: string;
  feature?: string;
  appId?: string | null;
  scriptId?: string | null;
  threadId?: string | null;
}

const LANGUAGE_NAMES: Record<Locale, string> = {
  fr: "FRENCH",
  en: "ENGLISH",
};

/** Output-language rule appended to the system prompts. */
export function languageInstruction(locale: Locale = "fr"): string {
  return `\n\nLANGUAGE: every piece of text meant for the user (UI labels, titles, messages, names, summaries) must be written in ${LANGUAGE_NAMES[locale]}.`;
}

/** One entry of the generation history (user/assistant/plan). */
export interface GenerationHistoryEntry {
  role: "user" | "assistant" | "plan";
  content: string | null;
}

/**
 * Formats the history of previous iterations for the LLM context.
 * `assistant` messages are skipped: their content is the generated HTML, which
 * the model already gets through `previousHtml`. Each line is truncated, then
 * the whole block is capped to fit the token budget.
 */
export function formatHistory(
  entries: GenerationHistoryEntry[],
  maxChars = 3000,
): string {
  const parts = entries
    .filter((e) => e.role !== "assistant" && !!e.content)
    .map((e) => {
      const label = e.role === "user" ? "User" : "Plan";
      const content = (e.content as string).replace(/\s+/g, " ").trim().slice(0, 500);
      return `- ${label} : ${content}`;
    });
  if (!parts.length) return "";
  let block = `History of previous exchanges:\n${parts.join("\n")}`;
  if (block.length > maxChars) {
    block = `… (start of history truncated)\n${block.slice(-maxChars)}`;
  }
  return block;
}

/**
 * Truncates an HTML document that is too long for the context, keeping the start
 * (head + structure) and the end (scripts + closing tags). The model therefore
 * sees the full structure without paying for a very large file every iteration.
 */
export function truncateHtml(html: string, maxChars = 15000): string {
  if (html.length <= maxChars) return html;
  const half = Math.floor(maxChars / 2);
  return `${html.slice(0, half)}\n<!-- … code truncated (context limit) … -->\n${html.slice(-half)}`;
}

/** Truncates JS (script) code keeping the start — the planner only needs the overall context. */
export function truncateCode(code: string, maxChars = 8000): string {
  if (code.length <= maxChars) return code;
  return `${code.slice(0, maxChars)}\n// … code truncated (context limit) …`;
}

/** Splits `<think>` reasoning from the final text (also handles the unclosed streaming case). */
export function extractReasoning(text: string): { reasoning: string | null; cleanText: string } {
  const m = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (m) {
    const reasoning = m[1].trim() || null;
    const cleanText = text.replace(m[0], "").trim();
    return { reasoning, cleanText };
  }
  // Streaming case: <think> opened without a closing tag
  const open = text.match(/<think>([\s\S]*)$/i);
  if (open) {
    return { reasoning: open[1].trim() || null, cleanText: text.slice(0, open.index).trim() };
  }
  return { reasoning: null, cleanText: text };
}

/** Extracts the storage keys declared in the `<!-- storage: ... -->` comment. */
export function extractStorageKeys(html: string): string[] {
  const m = html.match(/<!--\s*storage:\s*([\s\S]*?)-->/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/-+\s*$/, ""))
    .filter(Boolean);
}

/**
 * Calls chat completions; if the response is truncated (token limit), retries
 * once with a doubled budget. Throws an LlmError if still truncated.
 * Uses internal streaming to avoid timeouts on large coder calls.
 */
export async function chatWithTruncationRetry(
  messages: ChatMessage[],
  opts: LlmOptions & { maxTokens: number },
  isTruncated: (text: string, finishReason: string | null) => boolean,
): Promise<{ text: string; finishReason: string | null }> {
  // Prefer streaming (same result, but avoids long HTTP stalls)
  let first: { text: string; finishReason: string | null } | null = null;
  try {
    const r = await chatCompletionStream(messages, opts);
    if (r && typeof r.text === "string") first = r;
    else throw new Error("invalid stream");
  } catch {
    first = await chatCompletionDetailed(messages, opts);
  }
  if (!first) first = await chatCompletionDetailed(messages, opts);
  if (!isTruncated(first.text, first.finishReason)) return first;

  let retry: { text: string; finishReason: string | null } | null = null;
  try {
    const r = await chatCompletionStream(messages, {
      ...opts,
      maxTokens: opts.maxTokens * 2,
    });
    if (r && typeof r.text === "string") retry = r;
    else throw new Error("invalid stream");
  } catch {
    retry = await chatCompletionDetailed(messages, {
      ...opts,
      maxTokens: opts.maxTokens * 2,
    });
  }
  if (!retry) retry = await chatCompletionDetailed(messages, { ...opts, maxTokens: opts.maxTokens * 2 });
  if (isTruncated(retry.text, retry.finishReason)) {
    throw new LlmError(
      "Model response truncated (token limit reached). Please retry.",
    );
  }
  return retry;
}