import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./prompt";

const base = { locale: "fr" as const, destructiveTools: ["delete_app"] };

describe("agent/prompt", () => {
  it("announces the injected libs and forbids re-adding them", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain("Tailwind CSS 4");
    expect(prompt).toContain("Alpine.js 3");
    expect(prompt).toContain("Chart.js 4");
    expect(prompt).toContain("homeSDK");
    // The symptom to prevent: "these libs are missing, let me fix that".
    expect(prompt).toContain("is CORRECT");
    expect(prompt).toMatch(/never report these libraries as missing/i);
  });

  it("lists the destructive tools needing confirmation", () => {
    expect(buildSystemPrompt(base)).toContain("delete_app");
  });

  it("only inserts the state/scope blocks when they exist", () => {
    const empty = buildSystemPrompt(base);
    expect(empty).not.toContain("User state");

    const filled = buildSystemPrompt({ ...base, stateBlock: "- likes cycling", scopeBlock: "STRICT CONTEXT — app X" });
    expect(filled).toContain("User state");
    expect(filled).toContain("STRICT CONTEXT — app X");
  });

  it("pins the output language to the locale", () => {
    expect(buildSystemPrompt(base)).toContain("must be written in FRENCH");
    expect(buildSystemPrompt({ ...base, locale: "en" })).toContain("must be written in ENGLISH");
  });
});
