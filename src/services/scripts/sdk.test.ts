import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/llm/llm", () => ({
  LlmError: class LlmError extends Error {},
  sanitizeChatMessages: vi.fn((raw: unknown) => raw as never),
  chatCompletion: vi.fn(async () => "AI response"),
  chatCompletionStream: vi.fn(async () => ({ text: "AI response", finishReason: "stop" })),
}));

vi.mock("@/services/llm/settings", () => ({
  getEffectiveDefaults: vi.fn(async () => ({
    provider: "openrouter",
    plannerModel: "planner-x",
    coderModel: "coder-y",
  })),
}));

import { buildScriptSdk } from "@/services/scripts/sdk";
import { createTracedHome } from "@/services/scripts/traced-sdk";
import { chatCompletionStream, type ChatMessage } from "@/services/llm/llm";

const mockedChat = vi.mocked(chatCompletionStream);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildScriptSdk().ai", () => {
  it("chat sends system + user using the owner's build model", async () => {
    const sdk = buildScriptSdk("o1");
    const value = await sdk.ai.chat("Summarize", {
      system: "Be brief",
      temperature: 0.2,
    });

    expect(value).toBe("AI response");
    expect(mockedChat).toHaveBeenCalledWith(
      [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Summarize" },
      ],
      expect.objectContaining({
        provider: "openrouter",
        model: "coder-y",
        temperature: 0.2,
        maxTokens: undefined,
        userId: "o1",
        appId: null,
        feature: "ai_sdk_script",
      }),
    );
  });

  it("chat rejects an empty prompt", async () => {
    const sdk = buildScriptSdk("o1");
    await expect(sdk.ai.chat("  ")).rejects.toThrow("Empty AI prompt.");
  });

  it("messages forwards the messages", async () => {
    const sdk = buildScriptSdk("o1");
    const messages: ChatMessage[] = [{ role: "user", content: "a" }];
    await sdk.ai.messages(messages);

    expect(mockedChat).toHaveBeenCalledWith(messages, expect.objectContaining({
      provider: "openrouter",
      model: "coder-y",
      temperature: undefined,
      maxTokens: undefined,
      userId: "o1",
      feature: "ai_sdk_script",
    }));
  });
});

describe("buildScriptSdk().browser", () => {
  it("exposes the session operations without a stored connection", () => {
    const sdk = buildScriptSdk("o1");
    expect(Object.keys(sdk.browser)).toEqual([
      "open",
      "click",
      "fill",
      "wait",
      "text",
      "html",
      "evaluate",
      "close",
    ]);
    for (const method of Object.values(sdk.browser)) expect(method).toEqual(expect.any(Function));
  });
});

describe("createTracedHome() — tracing and home.step pragmas", () => {
  it("traces an SDK call as a call span with no pragma", async () => {
    const traced = createTracedHome("o1");
    await traced.home.ai.chat("Hello");

    expect(traced.spans).toHaveLength(1);
    const [span] = traced.spans;
    expect(span.kind).toBe("call");
    expect(span.method).toBe("ai.chat");
    expect(span.parentId).toBeNull();
    expect(span.status).toBe("success");
    expect(span.result).toContain("AI response");
  });

  it("step groups nested calls as children", async () => {
    const traced = createTracedHome("o1");
    const value = await traced.home.step("Phase", () => traced.home.ai.chat("Summarize"));
    expect(value).toBe("AI response");

    const step = traced.spans.find((s) => s.kind === "step")!;
    expect(step.label).toBe("Phase");
    expect(step.parentId).toBeNull();
    expect(step.status).toBe("success");

    const call = traced.spans.find((s) => s.kind === "call")!;
    expect(call.method).toBe("ai.chat");
    expect(call.parentId).toBe(step.id);
  });

  it("step bubbles up the error status when fn fails", async () => {
    const traced = createTracedHome("o1");
    await expect(
      traced.home.step("Bad", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const step = traced.spans.find((s) => s.kind === "step")!;
    expect(step.status).toBe("error");
    expect(step.error).toBe("boom");
  });

  it("__pushStep has an implicit scope: auto-pops on the next step", async () => {
    const traced = createTracedHome("o1");
    traced.home.__pushStep("a");
    await traced.home.ai.chat("1");
    traced.home.__pushStep("b");
    await traced.home.ai.chat("2");
    traced.closeImplicit();

    const [a, callA, b, callB] = traced.spans;
    expect(a.kind).toBe("step");
    expect(a.label).toBe("a");
    expect(a.parentId).toBeNull();
    expect(a.status).toBe("success");
    expect(callA.kind).toBe("call");
    expect(callA.parentId).toBe(a.id);

    expect(b.kind).toBe("step");
    expect(b.label).toBe("b");
    expect(b.parentId).toBeNull();
    expect(b.status).toBe("success");
    expect(callB.kind).toBe("call");
    expect(callB.parentId).toBe(b.id);
  });
});
