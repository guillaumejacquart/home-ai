import { describe, expect, it } from "vitest";

import { LlmError, parseChatCompletion } from "@/services/llm/llm";

describe("llm.parseChatCompletion", () => {
  it("extracts the text and the finish_reason", () => {
    const r = parseChatCompletion(
      {
        choices: [
          { message: { content: "hello" }, finish_reason: "length" },
        ],
      },
      "opencode-go",
    );
    expect(r).toEqual({ text: "hello", finishReason: "length" });
  });

  it("returns finishReason null when it's absent", () => {
    const r = parseChatCompletion(
      { choices: [{ message: { content: "ok" } }] },
      "opencode-go",
    );
    expect(r).toEqual({ text: "ok", finishReason: null });
  });

  it("ignores a non-textual finish_reason", () => {
    const r = parseChatCompletion(
      {
        choices: [
          { message: { content: "ok" }, finish_reason: 42 },
        ],
      },
      "opencode-go",
    );
    expect(r).toEqual({ text: "ok", finishReason: null });
  });

  it("throws an LlmError when there is no usable text content", () => {
    expect(() => parseChatCompletion(null, "opencode-go")).toThrow(LlmError);
    expect(() => parseChatCompletion({}, "opencode-go")).toThrow(LlmError);
    expect(() => parseChatCompletion({ choices: [] }, "opencode-go")).toThrow(LlmError);
    expect(() =>
      parseChatCompletion({ choices: [{ message: {} }] }, "opencode-go"),
    ).toThrow(LlmError);
  });
});
