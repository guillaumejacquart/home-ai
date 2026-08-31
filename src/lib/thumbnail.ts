import type { CSSProperties } from "react";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Deux couleurs HSL déterministes pour une vignette (dérivées du slug). */
export function thumbColors(seed: string): { from: string; to: string } {
  const hue = hashString(seed) % 360;
  return {
    from: `hsl(${hue} 72% 55%)`,
    to: `hsl(${(hue + 40) % 360} 72% 38%)`,
  };
}

/** Initiale d'une app (premier caractère, en majuscule). */
export function thumbInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : "?";
}

/** Style inline du dégradé (les couleurs HSL sont dynamiques). */
export function thumbStyle(seed: string): CSSProperties {
  const { from, to } = thumbColors(seed);
  return { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
}

/** Barre fine (6px) pour les cards palier 1 — même gradient, hauteur réduite. */
export function thumbBarStyle(seed: string): CSSProperties {
  const { from, to } = thumbColors(seed);
  return { backgroundImage: `linear-gradient(90deg, ${from}, ${to})` };
}
