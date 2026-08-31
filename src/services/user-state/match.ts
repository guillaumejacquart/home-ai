// Appariement mémoire → apps/storage par mots-clés (déterministe, sans LLM).

/** Découpe un texte en mots utiles (>= 3 caractères, minuscules). */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) ?? []) {
    out.add(m);
  }
  return out;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared++;
  return shared / right.size;
}

/** Score d'appariement : 0..1, 0 si aucun mot commun. */
function matchScore(memoryText: string, targetText: string): number {
  return overlapScore(tokens(memoryText), tokens(targetText));
}

export interface AppMatchTarget {
  id: string;
  name: string;
  slug: string;
  tags: string[];
}

export interface StorageMatchTarget {
  id: string;
  text: string;
}

/**
 * Meilleure app liée à une mémoire par mots-clés (nom + slug + étiquettes).
 * Retourne `null` si aucun score >= `minScore`.
 */
export function matchMemoryToApps(
  memoryContent: string,
  targets: AppMatchTarget[],
  minScore = 0.25,
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const t of targets) {
    const score = matchScore(memoryContent, `${t.name} ${t.slug} ${t.tags.join(" ")}`);
    if (score >= minScore && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best;
}

/**
 * Meilleure clé de stockage liée à une mémoire par mots-clés. Retourne `null`
 * si aucun score >= `minScore`.
 */
export function matchMemoryToStorages(
  memoryContent: string,
  targets: StorageMatchTarget[],
  minScore = 0.5,
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const t of targets) {
    const score = matchScore(memoryContent, t.text);
    if (score >= minScore && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best;
}