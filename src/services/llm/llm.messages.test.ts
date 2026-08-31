import { describe, expect, it } from "vitest";

import { LlmError, sanitizeChatMessages } from "@/services/llm/llm";

describe("llm.sanitizeChatMessages", () => {
  it("garde les messages valides et ignore les autres", () => {
    expect(
      sanitizeChatMessages([
        { role: "user", content: "salut" },
        { role: "assistant", content: "coucou" },
        { role: "system", content: "règle" },
        { role: "admin", content: "ignoré" },
        { content: "pas de rôle" },
        { role: "user", content: 42 },
        null,
        "texte",
      ]),
    ).toEqual([
      { role: "user", content: "salut" },
      { role: "assistant", content: "coucou" },
      { role: "system", content: "règle" },
    ]);
  });

  it("jette une LlmError si rien de valide ne subsiste", () => {
    expect(() => sanitizeChatMessages([])).toThrow(LlmError);
    expect(() => sanitizeChatMessages([{ role: "user" }])).toThrow(LlmError);
    expect(() => sanitizeChatMessages("pas un tableau")).toThrow(LlmError);
    expect(() => sanitizeChatMessages(undefined)).toThrow(LlmError);
  });
});