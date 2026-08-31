import { eq } from "drizzle-orm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";
import type { ModelMessage } from "ai";

import { db, tables } from "@/db/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { HttpError } from "@/lib/errors";
import { env } from "@/lib/env";

/**
 * Multi-provider LLM client (OpenAI-compatible chat completions).
 *
 * Configured providers:
 *  - `opencode-go`: base `OPENCODE_BASE_URL` (defaults to https://opencode.ai/zen/go/v1), key `OPENCODE_API_KEY`
 *  - `openrouter` : base `OPENROUTER_BASE_URL` (defaults to https://openrouter.ai/api/v1), key `OPENROUTER_API_KEY`
 *
 * The resolved API key comes first from the database (`provider_keys`, encrypted
 * AES-256-GCM), otherwise from the matching env variable.
 *
 * Implementation: Vercel AI SDK (`generateText`/`streamText` through
 * `createOpenAICompatible`) — same public API as the previous hand-rolled `fetch`
 * client, so app/script/brief generation needs no changes.
 */

export type LlmProvider = "opencode-go" | "openrouter";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Assistant message carrying tool calls (tool calling). */
export interface AssistantToolCallMessage extends ChatMessage {
  tool_calls: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

/** A tool's result, returned to the model under the `tool` role. */
export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type ApiMessage = ChatMessage | AssistantToolCallMessage | ToolMessage;


export interface LlmOptions {
  provider?: LlmProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Usage tracking: identifies the call for llm_usage and the quota. */
  userId?: string;
  feature?: string;
  appId?: string | null;
  scriptId?: string | null;
  threadId?: string | null;
}

export class LlmError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class LlmQuotaError extends LlmError {
  constructor(
    message: string,
    public readonly period: "daily" | "weekly" | "monthly",
  ) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function parseUsage(data: unknown): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const usage = d.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const p = usage.prompt_tokens ?? usage.promptTokens;
  const c = usage.completion_tokens ?? usage.completionTokens;
  const t = usage.total_tokens ?? usage.totalTokens;
  const out: Record<string, number> = {};
  if (typeof p === "number") out.promptTokens = p;
  if (typeof c === "number") out.completionTokens = c;
  if (typeof t === "number") out.totalTokens = t;
  if (Object.keys(out).length === 0) return null;
  return out as { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function enforceQuotaIfNeeded(opts: LlmOptions): Promise<void> {
  if (!opts.userId) return;
  try {
    const { checkQuota } = await import("@/services/llm/usage");
    const res = await checkQuota(opts.userId);
    if (res.exceeded) {
      const label =
        res.exceeded === "daily" ? "quotidien" : res.exceeded === "weekly" ? "hebdomadaire" : "mensuel";
      throw new LlmQuotaError(
        `AI quota ${label} reached. Raise the limit in Settings > Usage, or wait for the next period.`,
        res.exceeded,
      );
    }
  } catch (e) {
    if (e instanceof LlmQuotaError) throw e;
  }
}

async function recordLlmUsage(
  opts: LlmOptions,
  provider: LlmProvider,
  model: string,
  result: { text: string; usage?: ReturnType<typeof parseUsage>; durationMs: number; error?: string },
) {
  if (!opts.userId) return;
  try {
    const { recordUsage } = await import("@/services/llm/usage");
    const promptTokens = result.usage?.promptTokens ?? null;
    let completionTokens = result.usage?.completionTokens ?? null;
    let totalTokens = result.usage?.totalTokens ?? null;
    let estimated = false;
    if (promptTokens == null && completionTokens == null) {
      if (result.text) {
        completionTokens = estimateTokens(result.text);
        estimated = true;
        totalTokens = completionTokens;
      }
    } else if (totalTokens == null && (promptTokens != null || completionTokens != null)) {
      totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
    }
    await recordUsage({
      userId: opts.userId,
      provider,
      model,
      feature: (opts.feature as never) ?? "unknown",
      status: result.error ? "error" : "success",
      promptTokens,
      completionTokens,
      totalTokens,
      estimated,
      durationMs: result.durationMs,
      appId: opts.appId ?? null,
      scriptId: opts.scriptId ?? null,
      threadId: opts.threadId ?? null,
      error: result.error ?? null,
    });
  } catch {}
}

function formatOpenRouterError(
  model: string,
  status: number,
  body: string,
): string | null {
  if (status === 403 && /age.*18|missing_attestation|confirm.*age/i.test(body)) {
    return (
      `OpenRouter blocked the model "${model}": 18+ age confirmation required. ` +
      `Confirm it at https://openrouter.ai/settings/preferences then retry. ` +
      `Detail: ${body.slice(0, 300)}`
    );
  }
  if (
    status === 404 &&
    /guardrail|data policy|No endpoints available/i.test(body)
  ) {
    const isMuseSpark = /muse-spark/i.test(model);
    const museHint = isMuseSpark
      ? ` For Muse Spark, use the "opencode-go" provider (https://opencode.ai/zen/go/v1) where the contributor tier is currently free, or switch to "meta/muse-spark-1.2" (standard) after confirming your age at https://openrouter.ai/settings/preferences.`
      : "";
    return (
      `OpenRouter blocked the model "${model}" (404): no endpoint matches your privacy/guardrail settings. ` +
      `Check https://openrouter.ai/settings/privacy: enable "Allow free endpoints that train on request data" and "Allow free endpoints that publish prompts", disable "Zero Data Retention endpoints only", and clear the Allowed/Ignored providers lists.` +
      museHint +
      ` Detail: ${body.slice(0, 300)}`
    );
  }
  return null;
}

function formatOpencodeGoError(
  model: string,
  status: number,
  body: string,
): string | null {
  if (/Model.*not supported/i.test(body)) {
    return (
      `Model "${model}" is not supported by opencode-go (${status}). ` +
      `Check the exact slug in GET /models (e.g. "muse-spark-1.2-contributor", "glm-5.3", "deepseek-v4-flash"). ` +
      `Detail: ${body.slice(0, 300)}`
    );
  }
  if (
    status >= 500 ||
    /Internal server error|Endpoint is unavailable|Upstream request failed/i.test(body)
  ) {
    const isMuseSpark = /muse-spark/i.test(model);
    const hint = isMuseSpark
      ? ` The Muse Spark endpoint on opencode-go is temporarily unavailable (500/503). Retry in a few minutes, or switch to "glm-5.3" / "deepseek-v4-flash", which work on this provider.`
      : ` The opencode-go provider is temporarily unavailable (${status}). Retry, or switch provider/model.`;
    return `opencode-go failed for the model "${model}" (${status}):` + hint + ` Detail: ${body.slice(0, 300)}`;
  }
  return null;
}

/**
 * Sanitises an arbitrary message input (e.g. coming from the iframe through the
 * `homeSDK.ai.messages` bridge), keeping only the allowed roles and contents.
 * Throws an LlmError if no valid message remains.
 */
export function sanitizeChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    throw new LlmError("Invalid AI messages: an array is required.");
  }
  const roles: ReadonlySet<ChatMessage["role"]> = new Set([
    "system",
    "user",
    "assistant",
  ]);
  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (typeof m.role !== "string" || !roles.has(m.role as ChatMessage["role"])) continue;
    if (typeof m.content !== "string") continue;
    messages.push({ role: m.role as ChatMessage["role"], content: m.content });
  }
  if (messages.length === 0) {
    throw new LlmError(
      "No valid AI message (system/user/assistant roles, text content).",
    );
  }
  return messages;
}

function baseUrl(provider: LlmProvider): string {
  if (provider === "opencode-go") return env.OPENCODE_BASE_URL.replace(/\/$/, "");
  return env.OPENROUTER_BASE_URL.replace(/\/$/, "");
}

function envKey(provider: LlmProvider): string | null {
  const key =
    provider === "opencode-go" ? env.OPENCODE_API_KEY : env.OPENROUTER_API_KEY;
  return key ?? null;
}

/** Effective key source: "db" (override) or "env", null when absent. */
export async function keySource(provider: LlmProvider): Promise<"db" | "env" | null> {
  const row = await db
    .select()
    .from(tables.providerKeys)
    .where(eq(tables.providerKeys.provider, provider))
    .get();
  if (row) return "db";
  return envKey(provider) ? "env" : null;
}

/** Effective API key: the database key when present, otherwise the env variable. */
export async function resolveApiKey(provider: LlmProvider): Promise<string | null> {
  const row = await db
    .select()
    .from(tables.providerKeys)
    .where(eq(tables.providerKeys.provider, provider))
    .get();
  if (row) {
    try {
      return decrypt(row.apiKey);
    } catch {}
  }
  return envKey(provider);
}

/** Stores an encrypted API key in the database (overrides the env variable). */
export async function setApiKey(provider: LlmProvider, apiKey: string): Promise<void> {
  await db
    .insert(tables.providerKeys)
    .values({
      provider,
      apiKey: encrypt(apiKey),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tables.providerKeys.provider,
      set: { apiKey: encrypt(apiKey), updatedAt: new Date() },
    });
}

/** Deletes the database key: we fall back to the env variable. */
export async function clearApiKey(provider: LlmProvider): Promise<void> {
  await db.delete(tables.providerKeys).where(eq(tables.providerKeys.provider, provider));
}

/**
 * Lists a provider's available models (OpenAI-compatible `GET /models`
 * endpoint). Best-effort: returns an empty list when unconfigured, unavailable,
 * or when the response format is not recognised.
 */
export async function listModels(
  provider: LlmProvider,
): Promise<string[]> {
  const key = await resolveApiKey(provider);
  if (!key) return [];

  try {
    const res = await fetch(`${baseUrl(provider)}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id?: string }[] };
    if (!Array.isArray(data?.data)) return [];
    return data.data
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export interface ChatCompletionResult {
  text: string;
  /** "stop", "length", "content_filter", or null when not provided. */
  finishReason: string | null;
}

/** Parses a /chat/completions response: text + finish_reason. */
export function parseChatCompletion(
  data: unknown,
  provider: LlmProvider,
): ChatCompletionResult {
  const choice = (data as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] })
    ?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== "string") {
    throw new LlmError(`Invalid LLM response (${provider}).`);
  }
  const finishReason: string | null =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  return { text, finishReason };
}

// ---------------------------------------------------------------------------
// AI SDK helpers (internal)
// ---------------------------------------------------------------------------

async function getAiModel(provider: LlmProvider, modelId: string) {
  const key = await resolveApiKey(provider);
  if (!key) throw new LlmError(`Provider "${provider}" is not configured (missing API key).`);
  const client = createOpenAICompatible({
    name: provider,
    baseURL: baseUrl(provider),
    apiKey: key,
  });
  return client(modelId);
}

function toModelMessages(apiMessages: ApiMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of apiMessages) {
    if (m.role === "user") {
      out.push({ role: m.role, content: m.content } as ModelMessage);
    } else if (m.role === "system") {
      // System is passed via `system` option, not in messages — skip here (handled by caller)
      continue;
    } else if (m.role === "assistant") {
      const am = m as AssistantToolCallMessage;
      if (am.tool_calls && am.tool_calls.length > 0) {
        const parts: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }> = [];
        if (am.content) parts.push({ type: "text", text: am.content });
        for (const tc of am.tool_calls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            input = {};
          }
          parts.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.function.name, input });
        }
        out.push({ role: "assistant", content: parts } as unknown as ModelMessage);
      } else {
        out.push({ role: "assistant", content: m.content } as ModelMessage);
      }
    } else if (m.role === "tool") {
      const tm = m as ToolMessage;
      out.push({
        role: "tool",
        content: [{ type: "tool-result", toolCallId: tm.tool_call_id, toolName: "unknown", output: { type: "text", value: tm.content } }],
      } as unknown as ModelMessage);
    }
  }
  return out;
}

function mapAiError(provider: LlmProvider, model: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Try to extract status/body from AI SDK error shape
  const status = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status ?? 0;
  const body = msg;
  if (provider === "openrouter") {
    const friendly = formatOpenRouterError(model, status, body);
    if (friendly) return friendly;
  }
  if (provider === "opencode-go") {
    const friendly = formatOpencodeGoError(model, status, body);
    if (friendly) return friendly;
  }
  return `LLM ${provider} ${status || ""}: ${body.slice(0, 500)}`.trim();
}

/**
 * Calls the provider's chat completions and returns the response text along
 * with the `finish_reason` (which detects a token-limit truncation).
 */
/**
 * Budget of one call. A "coder" call rewrites a whole HTML file, so it
 * needs minutes, not seconds. A 90s timeout used to cut off MiniMax M3 mid-
 * writing, and the partial response was then mistaken for a token
 * tokens (cf. `looksTruncatedHtml`).
 */
const LARGE_CALL_TIMEOUT_MS = 240_000;
const SMALL_CALL_TIMEOUT_MS = 30_000;

function timeoutMsFor(maxTokens: number | undefined): number {
  return maxTokens && maxTokens > 4096 ? LARGE_CALL_TIMEOUT_MS : SMALL_CALL_TIMEOUT_MS;
}

function timeoutError(provider: LlmProvider, model: string, timeoutMs: number, received: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  const partial = received > 0 ? ` (${received} characters received before the cut)` : "";
  return `The model ${model} (${provider}) did not finish its response in ${seconds}s${partial}. This is not a token limit: retry, or pick a faster model for generation.`;
}

export async function chatCompletionDetailed(
  messages: ApiMessage[],
  opts: LlmOptions = {},
): Promise<ChatCompletionResult> {
  const provider = opts.provider ?? "opencode-go";
  const model = opts.model ?? env.LLM_CODER_MODEL;
  const t0 = Date.now();
  await enforceQuotaIfNeeded(opts);
  const modelInstance = await getAiModel(provider, model);
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const otherMessages = messages.filter((m) => m.role !== "system");
  try {
    const result = await generateText({
      model: modelInstance as never,
      system: systemMsg,
      messages: toModelMessages(otherMessages) as never,
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxTokens ?? 4096,
      abortSignal: AbortSignal.timeout(timeoutMsFor(opts.maxTokens)),
    } as never) as unknown as { text: string; finishReason: string | null; usage?: unknown };
    const finishReason = (result as unknown as { finishReason?: string | null }).finishReason ?? null;
    const text = (result as unknown as { text: string }).text ?? "";
    // Try to get usage from result
    const usage = (result as unknown as { usage?: unknown }).usage as unknown as { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
    const parsedUsage = usage
      ? {
          promptTokens: (usage as unknown as { promptTokens?: number; inputTokens?: number }).promptTokens ?? (usage as unknown as { inputTokens?: number }).inputTokens,
          completionTokens: (usage as unknown as { completionTokens?: number; outputTokens?: number }).completionTokens ?? (usage as unknown as { outputTokens?: number }).outputTokens,
          totalTokens: (usage as unknown as { totalTokens?: number }).totalTokens,
        }
      : null;
    await recordLlmUsage(opts, provider, model, {
      text,
      usage: parsedUsage ?? undefined,
      durationMs: Date.now() - t0,
    });
    return { text, finishReason };
  } catch (err) {
    const msg = mapAiError(provider, model, err);
    if (err instanceof DOMException && err.name === "TimeoutError") {
      const timeoutMsg = timeoutError(provider, model, timeoutMsFor(opts.maxTokens), 0);
      await recordLlmUsage(opts, provider, model, { text: "", durationMs: Date.now() - t0, error: timeoutMsg });
      throw new LlmError(timeoutMsg);
    }
    await recordLlmUsage(opts, provider, model, { text: "", durationMs: Date.now() - t0, error: msg });
    throw new LlmError(msg);
  }
}

/** Calls the provider's chat completions and returns only the text. */
export async function chatCompletion(
  messages: ApiMessage[],
  opts: LlmOptions = {},
): Promise<string> {
  const { text } = await chatCompletionDetailed(messages, opts);
  return text;
}

/** Default models (planner / implementer) from the environment. */
export const defaultModels = {
  planner: env.LLM_PLANNER_MODEL,
  coder: env.LLM_CODER_MODEL,
};

// ---------------------------------------------------------------------------
// Streaming (SSE)
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

/**
 * Streaming chat completions (text only). Calls `onToken` on every delta.
 * Returns the full text + finishReason.
 */
export async function chatCompletionStream(
  messages: ApiMessage[],
  opts: LlmOptions & StreamCallbacks = {},
): Promise<ChatCompletionResult> {
  const provider = opts.provider ?? "opencode-go";
  const model = opts.model ?? env.LLM_CODER_MODEL;
  const t0 = Date.now();
  await enforceQuotaIfNeeded(opts);
  const modelInstance = await getAiModel(provider, model);
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const otherMessages = messages.filter((m) => m.role !== "system");
  let fullText = "";
  let finishReason: string | null = null;
  let lastUsage: ReturnType<typeof parseUsage> = null;
  // The SDK does not throw on abort: it emits an `abort` part and the stream
  // ends normally. Without tracking the signal ourselves, a cut was
  // indistinguishable from a complete response — hence timeouts reported as
  // "token limit reached".
  const timeoutMs = timeoutMsFor(opts.maxTokens);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const callSignal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;
  try {
    const result = streamText({
      model: modelInstance as never,
      system: systemMsg,
      messages: toModelMessages(otherMessages) as never,
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxTokens ?? 4096,
      abortSignal: callSignal,
    } as never) as unknown as { fullStream: AsyncIterable<{ type: string; textDelta?: string; delta?: string }>; text: Promise<string>; finishReason: Promise<string | null>; usage: Promise<unknown> };
    for await (const chunk of result.fullStream as unknown as AsyncIterable<{ type: string; textDelta?: string; delta?: string }>) {
      if (opts.signal?.aborted) break;
      const c = chunk as unknown as { type: string; textDelta?: string; delta?: string };
      if (c.type === "text-delta") {
        const delta = (c.textDelta ?? c.delta) as string | undefined;
        if (typeof delta === "string" && delta) {
          fullText += delta;
          opts.onToken?.(delta);
        }
      }
    }
    try {
      fullText = (await (result as unknown as { text: Promise<string> }).text) ?? fullText;
    } catch {}
    try {
      finishReason = (await (result as unknown as { finishReason: Promise<string | null> }).finishReason) ?? null;
    } catch {}
    try {
      const usage = await (result as unknown as { usage: Promise<unknown> }).usage;
      const u = usage as unknown as { promptTokens?: number; completionTokens?: number; totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined;
      if (u) {
        lastUsage = {
          promptTokens: u.promptTokens ?? (u as unknown as { inputTokens?: number }).inputTokens,
          completionTokens: u.completionTokens ?? (u as unknown as { outputTokens?: number }).outputTokens,
          totalTokens: u.totalTokens,
        };
      }
    } catch {}
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    const msg = mapAiError(provider, model, err);
    await recordLlmUsage(opts, provider, model, { text: "", durationMs: Date.now() - t0, error: msg });
    throw new LlmError(msg);
  }
  if (timeoutSignal.aborted) {
    const msg = timeoutError(provider, model, timeoutMs, fullText.length);
    await recordLlmUsage(opts, provider, model, { text: fullText, durationMs: Date.now() - t0, error: msg });
    throw new LlmError(msg);
  }
  await recordLlmUsage(opts, provider, model, {
    text: fullText,
    usage: lastUsage ?? undefined,
    durationMs: Date.now() - t0,
  });
  return { text: fullText, finishReason };
}
