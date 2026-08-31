import { describe, expect, it } from "vitest";

import { applyEditBlocks, describeFailure, parseEditBlocks } from "./edit-blocks";

const DOC = [
  "<!DOCTYPE html>",
  "<html><body>",
  '<div x-data="app()">',
  "  <p x-text=\"title\"></p>",
  "</div>",
  "<script>",
  "function app() {",
  "  return {",
  "    title: 'Tâches',",
  "    tasksByStatus(s) {",
  "      return this.filtered().filter(t => t.status === s)",
  "    },",
  "  }",
  "}",
  "</script>",
  "</body></html>",
].join("\n");

function block(search: string, replace: string): string {
  return `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
}

describe("parseEditBlocks", () => {
  it("extrait un bloc entouré de prose", () => {
    const blocks = parseEditBlocks(
      `Voici la modification :\n\n${block("  a: 1,", "  a: 2,")}\n\nC'est tout !`,
    );
    expect(blocks).toEqual([{ search: "  a: 1,", replace: "  a: 2," }]);
  });

  it("extrait plusieurs blocs", () => {
    const text = `${block("a", "b")}\n\n${block("c", "d")}`;
    expect(parseEditBlocks(text)).toHaveLength(2);
  });

  it("normalise CRLF et espaces de fin de ligne", () => {
    const blocks = parseEditBlocks("<<<<<<< SEARCH\r\n  a: 1,   \r\n=======\r\n  a: 2,\r\n>>>>>>> REPLACE");
    expect(blocks[0]).toEqual({ search: "  a: 1,", replace: "  a: 2," });
  });

  it("ne renvoie rien quand il n'y a pas de bloc", () => {
    expect(parseEditBlocks("Voici le fichier complet : <html>…</html>")).toEqual([]);
  });
});

describe("applyEditBlocks", () => {
  it("remplace une méthode sans toucher au reste", () => {
    const blocks = parseEditBlocks(
      block(
        "    tasksByStatus(s) {\n      return this.filtered().filter(t => t.status === s)\n    },",
        "    tasksByStatus(s) {\n      return this.sortList(this.filtered().filter(t => t.status === s))\n    },",
      ),
    );
    const res = applyEditBlocks(DOC, blocks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("this.sortList(");
    // Le reste du document est intact.
    expect(res.content).toContain('<div x-data="app()">');
    expect(res.content).toContain("title: 'Tâches',");
    expect(res.content.endsWith("</body></html>")).toBe(true);
  });

  it("applique les blocs en séquence", () => {
    const blocks = parseEditBlocks(
      `${block("title: 'Tâches',", "title: 'Todo',")}\n${block("title: 'Todo',", "title: 'Liste',")}`,
    );
    const res = applyEditBlocks(DOC, blocks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("title: 'Liste',");
    expect(res.applied).toBe(2);
  });

  it("refuse plutôt que de deviner quand la cible est ambiguë", () => {
    const res = applyEditBlocks("a\nx\na\n", parseEditBlocks(block("a", "b")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("ambiguous");
    expect(describeFailure(res.failure)).toContain("2 fois");
  });

  it("refuse un bloc introuvable", () => {
    const res = applyEditBlocks(DOC, parseEditBlocks(block("n'existe pas", "x")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("not-found");
    expect(describeFailure(res.failure)).toContain("introuvable");
  });

  it("refuse une réponse sans bloc", () => {
    const res = applyEditBlocks(DOC, []);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("no-blocks");
  });

  it("refuse un SEARCH vide", () => {
    const res = applyEditBlocks(DOC, [{ search: "   ", replace: "x" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("empty-search");
  });

  it("tolère un document en CRLF", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    const res = applyEditBlocks(crlf, parseEditBlocks(block("title: 'Tâches',", "title: 'Todo',")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("title: 'Todo',");
    expect(res.content).not.toContain("\r");
  });

  it("laisse un $ ou une barre oblique inverse intacts dans le remplacement", () => {
    // `String.replace` interprète $& et $1 : la fonction de remplacement les protège.
    const res = applyEditBlocks(
      "const p = 'x'",
      parseEditBlocks(block("const p = 'x'", "const p = `$${total}` + '\\\\n'")),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toBe("const p = `$${total}` + '\\\\n'");
  });
});
