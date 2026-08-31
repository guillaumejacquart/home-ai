import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

/**
 * The assistant often outputs tables (file lists, summaries).
 * The old hand-rolled renderer showed them as plain text.
 */

function render(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content }));
}

describe("Markdown", () => {
  it("renders a GFM table as <table>", () => {
    const html = render(
      ["| Date | Name |", "|------|-----|", "| Aug 28 | toto |", "| Aug 26 | tata |"].join("\n"),
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("toto");
    expect(html).toContain("tata");
    // The pipe character must not leak through as literal text.
    expect(html).not.toContain("|------|");
  });

  it("renders nested lists", () => {
    const html = render(["- parent", "  - child"].join("\n"));
    const nested = html.indexOf("<ul", html.indexOf("<ul") + 1);
    expect(nested).toBeGreaterThan(-1);
    expect(html).toContain("child");
  });

  it("collapses a long code block, keeps a short one expanded", () => {
    const short = render(["```js", "const a = 1;", "```"].join("\n"));
    expect(short).toContain("<pre");
    expect(short).not.toContain("<details");

    const long = render(["```js", ...Array(20).fill("const a = 1;"), "```"].join("\n"));
    expect(long).toContain("<details");
    expect(long).toContain("20 lignes");
  });

  it("doesn't interpret raw HTML", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("hides a <think> tag left over from an old message", () => {
    const html = render("<think>hidden</think>visible");
    expect(html).not.toContain("hidden");
    expect(html).toContain("visible");
  });

  it("opens links in a new tab", () => {
    const html = render("[home](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
