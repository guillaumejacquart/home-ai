import type { CSSProperties } from "react";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Two deterministic HSL colours for a thumbnail (derived from the slug). */
export function thumbColors(seed: string): { from: string; to: string } {
  const hue = hashString(seed) % 360;
  return {
    from: `hsl(${hue} 72% 55%)`,
    to: `hsl(${(hue + 40) % 360} 72% 38%)`,
  };
}

/** An app's initial (first character, uppercased). */
export function thumbInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : "?";
}

/** Inline gradient style (the HSL colours are dynamic). */
export function thumbStyle(seed: string): CSSProperties {
  const { from, to } = thumbColors(seed);
  return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
}

/** Thin bar (6px) for tier-1 cards — same gradient, reduced height. */
export function thumbBarStyle(seed: string): CSSProperties {
  const { from, to } = thumbColors(seed);
  return { backgroundImage: `linear-gradient(90deg, ${from}, ${to})` };
}
