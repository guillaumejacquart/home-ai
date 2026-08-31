import { describe, expect, it } from "vitest";

import { INJECTED_LIBS, injectedLibTags, injectedLibsPromptLines } from "./app-libs";

/**
 * The LLM used to "fix" apps by adding Tailwind/Alpine tags it thought were
 * missing. These libs are injected by the platform, so the served tags and
 * the prompt-facing list must stay the same set.
 */

describe("app-libs", () => {
  it("serves one tag per lib, with defer only where needed", () => {
    const tags = injectedLibTags();
    for (const lib of INJECTED_LIBS) {
      expect(tags).toContain(`src="${lib.src}"`);
    }
    expect(tags.split("\n")).toHaveLength(INJECTED_LIBS.length);
    expect(tags).toContain('<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js">');
    expect(tags).toContain('<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">');
  });

  it("describes to prompts exactly the injected libs", () => {
    const lines = injectedLibsPromptLines().split("\n");
    expect(lines).toHaveLength(INJECTED_LIBS.length);
    for (const lib of INJECTED_LIBS) {
      expect(injectedLibsPromptLines()).toContain(lib.label);
    }
  });

  it("only uses the CDN allowed by the CSP", () => {
    for (const lib of INJECTED_LIBS) {
      expect(lib.src, lib.label).toMatch(/^https:\/\/cdn\.jsdelivr\.net\//);
    }
  });
});
