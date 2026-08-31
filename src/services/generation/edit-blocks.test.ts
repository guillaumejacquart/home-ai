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
  "    title: 'Tasks',",
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
  it("extracts a block surrounded by prose", () => {
    const blocks = parseEditBlocks(
      `Here is the change:\n\n${block("  a: 1,", "  a: 2,")}\n\nThat's all!`,
    );
    expect(blocks).toEqual([{ search: "  a: 1,", replace: "  a: 2," }]);
  });

  it("extracts several blocks", () => {
    const text = `${block("a", "b")}\n\n${block("c", "d")}`;
    expect(parseEditBlocks(text)).toHaveLength(2);
  });

  it("normalises CRLF and trailing whitespace", () => {
    const blocks = parseEditBlocks("<<<<<<< SEARCH\r\n  a: 1,   \r\n=======\r\n  a: 2,\r\n>>>>>>> REPLACE");
    expect(blocks[0]).toEqual({ search: "  a: 1,", replace: "  a: 2," });
  });

  it("returns nothing when there is no block", () => {
    expect(parseEditBlocks("Here is the whole file: <html>…</html>")).toEqual([]);
  });
});

describe("applyEditBlocks", () => {
  it("replaces a method without touching the rest", () => {
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
    // The rest of the document is intact.
    expect(res.content).toContain('<div x-data="app()">');
    expect(res.content).toContain("title: 'Tasks',");
    expect(res.content.endsWith("</body></html>")).toBe(true);
  });

  it("applies the blocks in sequence", () => {
    const blocks = parseEditBlocks(
      `${block("title: 'Tasks',", "title: 'Todo',")}\n${block("title: 'Todo',", "title: 'List',")}`,
    );
    const res = applyEditBlocks(DOC, blocks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("title: 'List',");
    expect(res.applied).toBe(2);
  });

  it("refuses rather than guessing when the target is ambiguous", () => {
    const res = applyEditBlocks("a\nx\na\n", parseEditBlocks(block("a", "b")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("ambiguous");
    expect(describeFailure(res.failure)).toContain("2 times");
  });

  it("refuses a block that cannot be found", () => {
    const res = applyEditBlocks(DOC, parseEditBlocks(block("does not exist", "x")));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("not-found");
    expect(describeFailure(res.failure)).toContain("not found");
  });

  it("refuses a response with no block", () => {
    const res = applyEditBlocks(DOC, []);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("no-blocks");
  });

  it("refuses an empty SEARCH", () => {
    const res = applyEditBlocks(DOC, [{ search: "   ", replace: "x" }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.kind).toBe("empty-search");
  });

  it("tolerates a CRLF document", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    const res = applyEditBlocks(crlf, parseEditBlocks(block("title: 'Tasks',", "title: 'Todo',")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("title: 'Todo',");
    expect(res.content).not.toContain("\r");
  });

  it("leaves a $ or a backslash intact in the replacement", () => {
    // `String.replace` interprets $& and $1; the replacer function shields them.
    const res = applyEditBlocks(
      "const p = 'x'",
      parseEditBlocks(block("const p = 'x'", "const p = `$${total}` + '\\\\n'")),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toBe("const p = `$${total}` + '\\\\n'");
  });
});
