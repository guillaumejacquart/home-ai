import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

/**
 * L'assistant sort souvent des tableaux (listes de fichiers, récapitulatifs).
 * L'ancien rendu, fait main, les affichait en texte brut.
 */

function render(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { content }));
}

describe("Markdown", () => {
  it("rend un tableau GFM en <table>", () => {
    const html = render(
      ["| Date | Nom |", "|------|-----|", "| 28 août | toto |", "| 26 août | tata |"].join("\n"),
    );

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("toto");
    expect(html).toContain("tata");
    // Le pipe ne doit plus apparaître comme texte.
    expect(html).not.toContain("|------|");
  });

  it("rend les listes imbriquées", () => {
    const html = render(["- parent", "  - enfant"].join("\n"));
    const nested = html.indexOf("<ul", html.indexOf("<ul") + 1);
    expect(nested).toBeGreaterThan(-1);
    expect(html).toContain("enfant");
  });

  it("replie un bloc de code long, garde court un bloc court", () => {
    const short = render(["```js", "const a = 1;", "```"].join("\n"));
    expect(short).toContain("<pre");
    expect(short).not.toContain("<details");

    const long = render(["```js", ...Array(20).fill("const a = 1;"), "```"].join("\n"));
    expect(long).toContain("<details");
    expect(long).toContain("20 lignes");
  });

  it("n'interprète pas le HTML brut", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("masque un <think> resté dans un vieux message", () => {
    const html = render("<think>caché</think>visible");
    expect(html).not.toContain("caché");
    expect(html).toContain("visible");
  });

  it("ouvre les liens dans un nouvel onglet", () => {
    const html = render("[home](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
