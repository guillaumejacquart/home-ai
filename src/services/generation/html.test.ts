import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// app.ts pulls in the LLM layer: stub it out since these functions are pure.
vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  chatCompletionStream: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const { extractHtml, looksTruncatedHtml } = await import("./app");

/**
 * Real-world case (90s + 57s run): the coder's second call finishes on its own
 * but still got flagged as truncated. A model that comments on its work after
 * the document, without a ```html block, broke the "ends with </html>" check.
 */
describe("extractHtml", () => {
  const doc = "<!DOCTYPE html>\n<html><body>ok</body></html>";

  it("strips the prose that follows the closing tag", () => {
    const html = extractHtml(`${doc}\n\nThere you go, I added sorting by priority!`);
    expect(html).toBe(doc);
    expect(looksTruncatedHtml(html, "stop")).toBe(false);
  });

  it("handles an uppercase closing tag", () => {
    const html = extractHtml("<html><body>x</body></HTML>\n\nDone.");
    expect(html.endsWith("</HTML>")).toBe(true);
    expect(looksTruncatedHtml(html, "stop")).toBe(false);
  });

  it("prefers the ```html block when it exists", () => {
    expect(extractHtml(`Here you go:\n\`\`\`html\n${doc}\n\`\`\`\nHave a nice day!`)).toBe(doc);
  });

  it("leaves a genuinely truncated document detectable", () => {
    const cut = "<!DOCTYPE html>\n<html><body>incomp";
    expect(extractHtml(cut)).toBe(cut);
    expect(looksTruncatedHtml(extractHtml(cut), null)).toBe(true);
  });

  it("respects finishReason=length even when the HTML looks complete", () => {
    expect(looksTruncatedHtml(doc, "length")).toBe(true);
  });
});

/**
 * The repo's four templates are FRAGMENTS ending in </script>. The old
 * detection required </html>, so every iteration on an app installed from a
 * template was flagged as truncated by construction.
 */
describe("looksTruncatedHtml — fragment format", () => {
  it("accepts the repo's real templates", () => {
    for (const name of ["todo", "notes", "budget", "planning"]) {
      const fragment = readFileSync(`templates/${name}/app.html`, "utf8");
      expect(looksTruncatedHtml(fragment, "stop"), name).toBe(false);
    }
  });

  it("also accepts a complete document", () => {
    expect(looksTruncatedHtml("<html><body><p>x</p></body></html>", "stop")).toBe(false);
  });

  it("detects a <script> that's never closed", () => {
    expect(looksTruncatedHtml("<div>a</div>\n<script>function app(){ return {", null)).toBe(true);
  });

  it("detects a cutoff in the middle of a tag", () => {
    expect(looksTruncatedHtml("<div class=\"x\">ok</div>\n<sect", null)).toBe(true);
  });

  it("rejects an empty fragment", () => {
    expect(looksTruncatedHtml("   ", "stop")).toBe(true);
  });
});
