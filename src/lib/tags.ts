export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

/** Normalise une étiquette saisie à l'unité (les espaces deviennent des tirets). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH);
}

/**
 * Normalise une liste d'étiquettes : trim, minuscules, dédoublonnage,
 * vide/limites appliqués. Accepte un tableau ou une chaîne CSV.
 */
export function normalizeTags(input: string[] | string | null | undefined): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const tag = item.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Parse la valeur stockée en base (JSON array ou null). */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeTags(parsed) : [];
  } catch {
    return [];
  }
}

/** Sérialise pour la base : JSON array, ou null si aucune étiquette. */
export function serializeTags(tags: string[]): string | null {
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}
