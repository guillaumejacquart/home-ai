import { describe, expect, it } from "vitest";

import { LlmError, parseChatCompletion } from "@/services/llm/llm";

describe("llm.parseChatCompletion", () => {
  it("extrait le texte et le finish_reason", () => {
    const r = parseChatCompletion(
      {
        choices: [
          { message: { content: "bonjour" }, finish_reason: "length" },
        ],
      },
      "opencode-go",
    );
    expect(r).toEqual({ text: "bonjour", finishReason: "length" });
  });

  it("retourne finishReason null s'il est absent", () => {
    const r = parseChatCompletion(
      { choices: [{ message: { content: "ok" } }] },
      "opencode-go",
    );
    expect(r).toEqual({ text: "ok", finishReason: null });
  });

  it("ignore un finish_reason non textuel", () => {
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

  it("jette une LlmError si aucun contenu texte exploitable", () => {
    expect(() => parseChatCompletion(null, "opencode-go")).toThrow(LlmError);
    expect(() => parseChatCompletion({}, "opencode-go")).toThrow(LlmError);
    expect(() => parseChatCompletion({ choices: [] }, "opencode-go")).toThrow(LlmError);
    expect(() =>
      parseChatCompletion({ choices: [{ message: {} }] }, "opencode-go"),
    ).toThrow(LlmError);
  });
});
