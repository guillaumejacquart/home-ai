import { describe, expect, it } from "vitest";

import { thumbColors, thumbInitial, thumbStyle } from "@/lib/thumbnail";

describe("thumbnail", () => {
  it("produit deux couleurs HSL déterministes pour un même slug", () => {
    const a = thumbColors("recap-semaine");
    const b = thumbColors("recap-semaine");
    expect(a).toEqual(b);
    expect(a.from).toMatch(/^hsl\(/);
    expect(a.to).toMatch(/^hsl\(/);
  });

  it("distingue deux slugs différents (probablement)", () => {
    const a = thumbColors("app-courses");
    const b = thumbColors("app-meteo");
    expect(a.from === b.from && a.to === b.to).toBe(false);
  });

  it("extrait l'initiale en majuscule", () => {
    expect(thumbInitial("recap de semaine")).toBe("R");
    expect(thumbInitial(" école ")).toBe("É");
    expect(thumbInitial("")).toBe("?");
    expect(thumbInitial("   ")).toBe("?");
  });

  it("génère un style de dégradé inline", () => {
    const style = thumbStyle("slug");
    expect(style.backgroundImage).toContain("linear-gradient");
  });
});
