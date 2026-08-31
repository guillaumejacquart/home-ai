/**
 * Blocs d'édition « chercher / remplacer » pour modifier une app sans la
 * réécrire entièrement.
 *
 * Réécrire 21 Ko de HTML pour changer 15 lignes coûte des minutes, sature le
 * budget de sortie et fait dériver le reste du fichier. Le coder renvoie donc
 * seulement ce qui change, et l'application se fait ici, de façon déterministe.
 *
 * Règle de sûreté : en cas de doute, on refuse. L'appelant retombe alors sur la
 * réécriture complète, qui est lente mais sûre.
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
 * Espaces en fin de ligne et CRLF ne portent aucun sens en HTML/JS, mais font
 * échouer une correspondance exacte. On normalise donc les deux côtés — y
 * compris le document, dont on renvoie la version normalisée.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
}

/** Extrait les blocs d'une réponse de modèle (prose et clôtures ``` tolérées). */
export function parseEditBlocks(text: string): EditBlock[] {
  // Normalisé d'abord : sinon un \r traîne dans les marqueurs et la capture.
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
 * Applique les blocs dans l'ordre, sur le texte au fur et à mesure : un bloc
 * peut donc porter sur une zone produite par le précédent.
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
    // Plusieurs cibles possibles : on ne devine pas laquelle le modèle visait.
    if (occurrences > 1) {
      return { ok: false, failure: { kind: "ambiguous", search: block.search, occurrences } };
    }
    content = content.replace(block.search, () => block.replace);
  }
  return { ok: true, content, applied: blocks.length };
}

/** Message court pour les logs : dit quoi corriger dans le prompt du coder. */
export function describeFailure(failure: ApplyFailure): string {
  switch (failure.kind) {
    case "no-blocks":
      return "aucun bloc SEARCH/REPLACE dans la réponse";
    case "empty-search":
      return "un bloc SEARCH est vide";
    case "not-found":
      return `bloc introuvable dans le fichier : ${preview(failure.search)}`;
    case "ambiguous":
      return `bloc présent ${failure.occurrences} fois, cible ambiguë : ${preview(failure.search)}`;
  }
}

function preview(search: string): string {
  const firstLine = search.split("\n").find((l) => l.trim()) ?? "";
  return firstLine.trim().slice(0, 80);
}
