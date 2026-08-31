/**
 * "Search / replace" edit blocks, to modify an app without rewriting it whole.
 *
 * Rewriting 21 KB of HTML to change 15 lines takes minutes, saturates the output
 * budget and lets the rest of the file drift. The coder therefore returns only
 * what changes, and applying it happens here, deterministically.
 *
 * Safety rule: when in doubt, refuse. The caller then falls back to the full
 * rewrite, which is slow but safe.
 */

export interface EditBlock {
  search: string;
  replace: string;
}

export type ApplyFailure =
  | { kind: "no-blocks" }
  | { kind: "not-found"; search: string }
  | { kind: "ambiguous"; search: string; occurrences: number }
  | { kind: "empty-search" };

export type ApplyResult =
  | { ok: true; content: string; applied: number }
  | { ok: false; failure: ApplyFailure };

const BLOCK_RE =
  /<{5,9}\s*SEARCH\s*\n([\s\S]*?)\n?={5,9}\s*\n([\s\S]*?)\n?>{5,9}\s*REPLACE/g;

/**
 * Trailing whitespace and CRLF carry no meaning in HTML/JS but break an exact
 * match. We therefore normalise both sides — including the document, whose
 * normalised version we return.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
}

/** Extracts the blocks from a model response (prose and trailing ``` tolerated). */
export function parseEditBlocks(text: string): EditBlock[] {
  // Normalise first: otherwise a stray \r lingers in the markers and the capture.
  const out: EditBlock[] = [];
  for (const m of normalize(text).matchAll(BLOCK_RE)) {
    out.push({ search: m[1] ?? "", replace: m[2] ?? "" });
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * Applies the blocks in order, against the text as it evolves: a block can
 * therefore target a region produced by the previous one.
 */
export function applyEditBlocks(source: string, blocks: EditBlock[]): ApplyResult {
  if (blocks.length === 0) return { ok: false, failure: { kind: "no-blocks" } };

  let content = normalize(source);
  for (const block of blocks) {
    if (!block.search.trim()) return { ok: false, failure: { kind: "empty-search" } };

    const occurrences = countOccurrences(content, block.search);
    if (occurrences === 0) {
      return { ok: false, failure: { kind: "not-found", search: block.search } };
    }
    // Several possible targets: we do not guess which one the model meant.
    if (occurrences > 1) {
      return { ok: false, failure: { kind: "ambiguous", search: block.search, occurrences } };
    }
    content = content.replace(block.search, () => block.replace);
  }
  return { ok: true, content, applied: blocks.length };
}

/** Short message for the logs: says what to fix in the coder's prompt. */
export function describeFailure(failure: ApplyFailure): string {
  switch (failure.kind) {
    case "no-blocks":
      return "no SEARCH/REPLACE block in the response";
    case "empty-search":
      return "a SEARCH block is empty";
    case "not-found":
      return `block not found in the file: ${preview(failure.search)}`;
    case "ambiguous":
      return `block present ${failure.occurrences} times, ambiguous target: ${preview(failure.search)}`;
  }
}

function preview(search: string): string {
  const firstLine = search.split("\n").find((l) => l.trim()) ?? "";
  return firstLine.trim().slice(0, 80);
}
