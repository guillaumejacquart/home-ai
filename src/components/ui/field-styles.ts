const WIDTH_RE = /(^|[\s])w-[^\s]+/;

/** Shared classes for form fields (Input / Select / Textarea). */
export function fieldStyles(className = ""): string {
  const width = WIDTH_RE.test(className) ? "" : "w-full";
  return `${width} rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20 ${className}`;
}