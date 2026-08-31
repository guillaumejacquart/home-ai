import {
  convertToModelMessages,
  createIdGenerator,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

import type { Locale } from "@/i18n/config";
import { listApps } from "@/services/apps/apps";
import { getEffectiveDefaults } from "@/services/llm/settings";
import { recordUsage } from "@/services/llm/usage";
import { touchMemory } from "@/services/agent/memory";
import { getAgentModel } from "@/services/agent/model";
import { runPostTurn } from "@/services/agent/post-turn";
import { buildSystemPrompt } from "@/services/agent/prompt";
import { buildScopeBlock, resolveScope, type AgentScope } from "@/services/agent/scope";
import { buildAgentTools, destructiveToolNames } from "@/services/agent/tools";
import { detectTextualToolCall, logTextualToolCall } from "@/services/agent/tool-log";
import { loadMessages, messageText, saveMessages, type AgentThread } from "@/services/agent/threads";
import { formatGraphBlock } from "@/services/user-state/context";
import { getUserStateGraph } from "@/services/user-state/graph";

/** Number of tool-LLM round trips allowed within one turn. */
const MAX_STEPS = 8;
const MAX_OUTPUT_TOKENS = 4096;
const TEMPERATURE = 0.3;

const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 });

async function stateBlock(userId: string): Promise<string> {
  try {
    const block = formatGraphBlock(await getUserStateGraph(userId));
    if (block.memoryIds.length > 0) void touchMemory(block.memoryIds).catch(() => {});
    return block.text;
  } catch {
    // Graph unavailable: the turn continues without state context.
    return "";
  }
}

export interface RunTurnInput {
  userId: string;
  thread: AgentThread;
  /** New user message, exactly as sent by useChat. */
  userMessage: UIMessage;
  scope?: AgentScope | null;
  locale: Locale;
  isNewThread: boolean;
  signal?: AbortSignal;
}

/**
 * One conversation turn, streamed in the UIMessage format.
 *
 * The stored history is the only source of truth: we reload it, append the new
 * message, and `onEnd` rewrites the full list the SDK produced. No intermediate
 * persistence, so nothing to resynchronise.
 */
export async function runTurn(input: RunTurnInput) {
  const { userId, thread, userMessage, scope, locale, isNewThread, signal } = input;

  const history = await loadMessages(thread.id);
  const messages: UIMessage[] = [...history, userMessage];

  const effectiveScope = resolveScope(scope, thread);
  const [defaults, apps, state, scopeText] = await Promise.all([
    getEffectiveDefaults(userId),
    listApps(userId),
    stateBlock(userId),
    buildScopeBlock(userId, effectiveScope),
  ]);

  const tools = buildAgentTools({ userId, locale, threadId: thread.id, apps });
  const system = buildSystemPrompt({
    locale,
    stateBlock: state,
    scopeBlock: scopeText,
    destructiveTools: destructiveToolNames(),
  });
  const model = await getAgentModel(defaults.provider, defaults.assistantModel);

  const result = streamText({
    model,
    system,
    // A tool call with no result (previous turn interrupted) is skipped rather
    // than failing the request.
    messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: signal,
    onFinish: ({ totalUsage }) => {
      void recordUsage({
        userId,
        provider: defaults.provider,
        model: defaults.assistantModel,
        feature: "assistant_main",
        status: "success",
        promptTokens: totalUsage.inputTokens ?? null,
        completionTokens: totalUsage.outputTokens ?? null,
        totalTokens: totalUsage.totalTokens ?? null,
        estimated: false,
        durationMs: 0,
        appId: effectiveScope?.appId ?? null,
        scriptId: effectiveScope?.scriptId ?? null,
        threadId: thread.id,
        error: null,
      }).catch(() => {});
    },
  });

  return toUIMessageStream({
    stream: result.stream,
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId,
    onEnd: async ({ messages: updated, isAborted }) => {
      await saveMessages(thread.id, updated, { model: defaults.assistantModel });
      if (isAborted) return;
      const answer = messageText(updated[updated.length - 1] ?? { parts: [] });

      // No tool ran but the model wrote the template: without this log the
      // failure is only visible by eye, in the displayed answer.
      const textual = detectTextualToolCall(answer, Object.keys(tools));
      if (textual) {
        logTextualToolCall({
          detected: textual,
          model: defaults.assistantModel,
          userId,
          threadId: thread.id,
          textPreview: answer,
        });
      }

      void runPostTurn({
        userId,
        threadId: thread.id,
        userMessage: messageText(userMessage),
        answer,
        isNewThread,
      });
    },
  });
}
