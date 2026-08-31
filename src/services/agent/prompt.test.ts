import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./prompt";

const base = { locale: "fr" as const, destructiveTools: ["delete_app"] };

describe("agent/prompt", () => {
  it("annonce les libs injectées et interdit de les rajouter", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain("Tailwind CSS 4");
    expect(prompt).toContain("Alpine.js 3");
    expect(prompt).toContain("Chart.js 4");
    expect(prompt).toContain("homeSDK");
    // Le symptôme à empêcher : « ces libs manquent, je corrige ».
    expect(prompt).toContain("est CORRECT");
    expect(prompt).toMatch(/ne signale jamais ces bibliothèques comme manquantes/i);
  });

  it("liste les outils destructifs à confirmer", () => {
    expect(buildSystemPrompt(base)).toContain("delete_app");
  });

  it("n'insère les blocs état/scope que s'ils existent", () => {
    const empty = buildSystemPrompt(base);
    expect(empty).not.toContain("État de l'utilisateur");

    const filled = buildSystemPrompt({ ...base, stateBlock: "- aime le vélo", scopeBlock: "CONTEXTE STRICT — app X" });
    expect(filled).toContain("État de l'utilisateur");
    expect(filled).toContain("CONTEXTE STRICT — app X");
  });
});
