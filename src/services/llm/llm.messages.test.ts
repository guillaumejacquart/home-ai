import { describe, expect, it } from "vitest";

import { LlmError, sanitizeChatMessages } from "@/services/llm/llm";

describe("llm.sanitizeChatMessages", () => {
  it("keeps valid messages and drops the rest", () => {
    expect(
      sanitizeChatMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hey" },
        { role: "system", content: "rule" },
        { role: "admin", content: "ignored" },
        { content: "no role" },
        { role: "user", content: 42 },
        null,
        "text",
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
      { role: "system", content: "rule" },
    ]);
  });

  it("throws an LlmError when nothing valid remains", () => {
    expect(() => sanitizeChatMessages([])).toThrow(LlmError);
    expect(() => sanitizeChatMessages([{ role: "user" }])).toThrow(LlmError);
    expect(() => sanitizeChatMessages("not an array")).toThrow(LlmError);
    expect(() => sanitizeChatMessages(undefined)).toThrow(LlmError);
  });
});