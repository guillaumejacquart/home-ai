import { describe, expect, it } from "vitest";

import { normalizeTags, parseTags, serializeTags } from "@/lib/tags";

describe("tags", () => {
  it("normalise trim + minuscules + dédoublonnage", () => {
    expect(normalizeTags([" Famille ", "Courses", "famille", "  "])).toEqual([
      "famille",
      "courses",
    ]);
  });

  it("accepte une chaîne CSV", () => {
    expect(normalizeTags("météo, courses,  météo ")).toEqual(["météo", "courses"]);
  });

  it("gère null / undefined / tableau vide", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });

  it("borne le nombre et la longueur des étiquettes", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(normalizeTags(many)).toHaveLength(8);

    const long = ["a".repeat(100)];
    expect(normalizeTags(long)[0]).toHaveLength(24);
  });

  it("sérialise en JSON et parse en retour (round-trip)", () => {
    const raw = serializeTags(["famille", "cours"]);
    expect(raw).toBe('["famille","cours"]');
    expect(parseTags(raw)).toEqual(["famille", "cours"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("pas du json")).toEqual([]);
  });

  it("sérialise en null quand il n'y a pas d'étiquette", () => {
    expect(serializeTags([])).toBeNull();
    expect(serializeTags(["  "])).toBeNull();
  });
});
