import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le SDK ne lève pas quand un flux est coupé : il émet une part `abort` et le
 * flux se termine normalement. La réponse partielle était donc prise pour une
 * réponse complète, puis diagnostiquée comme « limite de tokens atteinte »
 * (vu en prod avec MiniMax M3 sur une réécriture d'app : coupures à 90 s).
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

/** Flux qui émet quelques tokens puis s'arrête, signal marqué comme coupé. */
function abortedStream(tokens: string[], signal: AbortSignal) {
  return {
    fullStream: (async function* () {
      for (const t of tokens) yield { type: "text-delta", textDelta: t };
      // Le SDK terminerait ici sur une part `abort` ; on la représente ainsi.
      yield { type: "abort" };
    })(),
    text: Promise.resolve(tokens.join("")),
    finishReason: Promise.resolve(null),
    usage: Promise.resolve(undefined),
    _signal: signal,
  };
}

describe("chatCompletionStream — coupure par timeout", () => {
  beforeEach(() => {
    mockedStreamText.mockReset();
    process.env.OPENCODE_API_KEY = "test";
  });

  it("lève une erreur explicite au lieu de rendre du HTML partiel", async () => {
    const { chatCompletionStream, LlmError } = await import("./llm");

    mockedStreamText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      abortedStream(["<!DOCTYPE html>", "<html><body>incomplet"], abortSignal),
    );

    // Budget minuscule pour que le timeout se déclenche pendant l'itération.
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort() as unknown as AbortSignal,
    );

    await expect(
      chatCompletionStream([{ role: "user", content: "génère" }], {
        provider: "opencode-go",
        model: "minimax-m3",
        maxTokens: 16384,
      }),
    ).rejects.toThrow(LlmError);

    vi.restoreAllMocks();
  });

  it("le message dit que ce n'est pas une limite de tokens", async () => {
    const { chatCompletionStream } = await import("./llm");
    mockedStreamText.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      abortedStream(["partiel"], abortSignal),
    );
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort() as unknown as AbortSignal,
    );

    const err = await chatCompletionStream([{ role: "user", content: "x" }], {
      provider: "opencode-go",
      model: "minimax-m3",
      maxTokens: 16384,
    }).catch((e: Error) => e);

    expect((err as Error).message).toContain("n'a pas terminé sa réponse");
    expect((err as Error).message).toContain("pas une limite de tokens");
    expect((err as Error).message).toContain("minimax-m3");
    vi.restoreAllMocks();
  });

  it("rend le texte normalement quand rien n'est coupé", async () => {
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
