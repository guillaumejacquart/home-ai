import { describe, expect, it } from "vitest";

import { INJECTED_LIBS, injectedLibTags, injectedLibsPromptLines } from "./app-libs";

/**
 * Le LLM « corrigeait » des apps pour ajouter Tailwind/Alpine, qu'il croyait
 * manquants. Ces libs sont injectées par la plateforme : les balises servies et
 * la liste décrite aux prompts doivent donc rester le même ensemble.
 */

describe("app-libs", () => {
  it("sert une balise par lib, avec defer seulement là où il faut", () => {
    const tags = injectedLibTags();
    for (const lib of INJECTED_LIBS) {
      expect(tags).toContain(`src="${lib.src}"`);
    }
    expect(tags.split("\n")).toHaveLength(INJECTED_LIBS.length);
    expect(tags).toContain('<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js">');
    expect(tags).toContain('<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">');
  });

  it("décrit aux prompts exactement les libs injectées", () => {
    const lines = injectedLibsPromptLines().split("\n");
    expect(lines).toHaveLength(INJECTED_LIBS.length);
    for (const lib of INJECTED_LIBS) {
      expect(injectedLibsPromptLines()).toContain(lib.label);
    }
  });

  it("n'utilise que le CDN autorisé par la CSP", () => {
    for (const lib of INJECTED_LIBS) {
      expect(lib.src, lib.label).toMatch(/^https:\/\/cdn\.jsdelivr\.net\//);
    }
  });
});
