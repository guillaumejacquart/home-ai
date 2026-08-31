import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SDK does not throw when a stream is cut: it emits an `abort` part and the
 * stream ends normally. The partial response was therefore taken for a complete
 * one, then diagnosed as "token limit reached" (seen in production with MiniMax
 * M3 on an app rewrite: cuts at 90 s).
 */

const { mockedStreamText, mockedGetAiModel } = vi.hoisted(() => ({
  mockedStreamText: vi.fn(),
  mockedGetAiModel: vi.fn(async () => ({}) as never),
}));

vi.mock("ai", () => ({
  streamText: mockedStreamText,
  generateText: vi.fn(),
}));
vi.mock("./ai-sdk", () => ({ getAiModel: mockedGetAiModel }));

/** Stream that emits a few tokens then stops, with the signal marked as cut. */
function abortedStream(tokens: string[], signal: AbortSignal) {
  return {
    fullStream: (async function* () {
      for (const t of tokens) yield { type: "text-delta", textDelta: t };
      // The SDK would end here on an `abort` part; this stands in for it.
      yield { type: "abort" };
    })(),
    text: Promise.resolve(tokens.join("")),
    finishReason: Promise.resolve(null),
    usage: Promise.resolve(undefined),
    _signal: signal,
  };
}

describe("chatCompletionStream — cut by timeout", () => {
  beforeEach(() => {
    mockedStreamText.mockReset();
    process.env.OPENCODE_API_KEY = "test";
  });

  it("throws an explicit error instead of returning partial HTML", async () => {
    const { chatCompletionStream, LlmError } = await import("./llm");

    mockedStreamText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      abortedStream(["<!DOCTYPE html>", "<html><body>incomplete"], abortSignal),
    );

    // Tiny budget so the timeout fires during iteration.
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort() as unknown as AbortSignal,
    );

    await expect(
      chatCompletionStream([{ role: "user", content: "generate" }], {
        provider: "opencode-go",
        model: "minimax-m3",
        maxTokens: 16384,
      }),
    ).rejects.toThrow(LlmError);

    vi.restoreAllMocks();
  });

  it("says in the message that this is not a token limit", async () => {
    const { chatCompletionStream } = await import("./llm");
    mockedStreamText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      abortedStream(["partial"], abortSignal),
    );
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort() as unknown as AbortSignal,
    );

    const err = await chatCompletionStream([{ role: "user", content: "x" }], {
      provider: "opencode-go",
      model: "minimax-m3",
      maxTokens: 16384,
    }).catch((e: Error) => e);

    expect((err as Error).message).toContain("did not finish its response");
    expect((err as Error).message).toContain("not a token limit");
    expect((err as Error).message).toContain("minimax-m3");
    vi.restoreAllMocks();
  });

  it("returns the text normally when nothing is cut", async () => {
    const { chatCompletionStream } = await import("./llm");
    mockedStreamText.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "text-delta", textDelta: "<html>ok</html>" };
      })(),
      text: Promise.resolve("<html>ok</html>"),
      finishReason: Promise.resolve("stop"),
      usage: Promise.resolve(undefined),
    }));

    const res = await chatCompletionStream([{ role: "user", content: "x" }], {
      provider: "opencode-go",
      model: "minimax-m3",
      maxTokens: 16384,
    });
    expect(res.text).toBe("<html>ok</html>");
    expect(res.finishReason).toBe("stop");
  });
});
