import { chatCompletion } from "@/services/llm/llm";
import { getEffectiveDefaults } from "@/services/llm/settings";
import {
  addMemory,
  buildExtractionPrompt,
  buildFollowupPrompt,
  buildTitlePrompt,
  listMemory,
  parseExtractionPayload,
  parseFollowups,
  parseTitle,
} from "@/services/agent/memory";
import { updateThreadTitle } from "@/services/agent/threads";

type Defaults = Awaited<ReturnType<typeof getEffectiveDefaults>>;

const MIN_ANSWER_CHARS = 20;

/** Follow-up questions offered under the answer. */
export async function generateSuggestions(
  userId: string,
  userMessage: string,
  answer: string,
): Promise<string[]> {
  if (answer.trim().length < MIN_ANSWER_CHARS) return [];
  const defaults = await getEffectiveDefaults(userId);
  const raw = await chatCompletion([{ role: "user", content: buildFollowupPrompt(userMessage, answer) }], {
    provider: defaults.provider,
    model: defaults.plannerModel,
    maxTokens: 128,
    userId,
    feature: "assistant_suggestions",
  });
  return parseFollowups(raw);
}

async function extractMemory(
  userId: string,
  threadId: string,
  userMessage: string,
  answer: string,
  defaults: Defaults,
): Promise<void> {
  if (userMessage.trim().length < 10 && answer.trim().length < 40) return;
  const existing = await listMemory(userId).catch(() => []);
  const raw = await chatCompletion(
    [{ role: "user", content: buildExtractionPrompt(existing, userMessage, answer) }],
    {
      provider: defaults.provider,
      model: defaults.plannerModel,
      maxTokens: 512,
      userId,
      feature: "assistant_extraction",
      threadId,
    },
  );
  const parsed = parseExtractionPayload(raw);
  if (!parsed) return;
  for (const item of parsed.save) {
    // Duplicate or rejected content: move on to the next one.
    await addMemory(userId, { kind: item.kind, content: item.content, source: "auto", threadId }).catch(() => {});
  }
}

async function titleThread(
  userId: string,
  threadId: string,
  userMessage: string,
  answer: string,
  defaults: Defaults,
): Promise<void> {
  const raw = await chatCompletion([{ role: "user", content: buildTitlePrompt(userMessage, answer) }], {
    provider: defaults.provider,
    model: defaults.plannerModel,
    maxTokens: 32,
    userId,
    feature: "assistant_title",
    threadId,
  });
  const title = parseTitle(raw);
  if (title) await updateThreadTitle(userId, threadId, title);
}

export interface PostTurnInput {
  userId: string;
  threadId: string;
  userMessage: string;
  answer: string;
  /** Auto title only on the thread's first turn. */
  isNewThread: boolean;
}

/**
 * Post-turn work: thread title and memory extraction. Best-effort and off the
 * critical path — the answer is already persisted by the time we get here.
 */
export async function runPostTurn(input: PostTurnInput): Promise<void> {
  const { userId, threadId, userMessage, answer, isNewThread } = input;
  if (!answer.trim()) return;
  try {
    const defaults = await getEffectiveDefaults(userId);
    await Promise.allSettled([
      extractMemory(userId, threadId, userMessage, answer, defaults),
      isNewThread ? titleThread(userId, threadId, userMessage, answer, defaults) : Promise.resolve(),
    ]);
  } catch (err) {
    console.warn("[agent:post-turn] failed", { threadId, err });
  }
}
