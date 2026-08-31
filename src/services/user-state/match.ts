// Matches memory → apps/storage by keywords (deterministic, no LLM).

/** Splits a text into useful words (>= 3 characters, lowercased). */
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

/** Match score: 0..1, 0 if no shared word. */
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
 * Best app linked to a memory by keywords (name + slug + tags).
 * Returns `null` if no score >= `minScore`.
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
 * Best storage key linked to a memory by keywords. Returns `null`
 * if no score >= `minScore`.
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