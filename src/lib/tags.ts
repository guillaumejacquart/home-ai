export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

/** Normalises a single typed-in tag (spaces become dashes). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH);
}

/**
 * Normalises a list of tags: trim, lowercase, dedupe, empty values and limits
 * applied. Accepts either an array or a CSV string.
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

/** Parses the value stored in the database (JSON array or null). */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeTags(parsed) : [];
  } catch {
    return [];
  }
}

/** Serialises for the database: JSON array, or null when there are no tags. */
export function serializeTags(tags: string[]): string | null {
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}
