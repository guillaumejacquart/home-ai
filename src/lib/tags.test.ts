import { describe, expect, it } from "vitest";

import { normalizeTags, parseTags, serializeTags } from "@/lib/tags";

describe("tags", () => {
  it("normalizes trim + lowercase + dedupe", () => {
    expect(normalizeTags([" Family ", "Groceries", "family", "  "])).toEqual([
      "family",
      "groceries",
    ]);
  });

  it("accepts a CSV string", () => {
    expect(normalizeTags("weather, groceries,  weather ")).toEqual(["weather", "groceries"]);
  });

  it("handles null / undefined / empty array", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });

  it("caps the number and length of tags", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(normalizeTags(many)).toHaveLength(8);

    const long = ["a".repeat(100)];
    expect(normalizeTags(long)[0]).toHaveLength(24);
  });

  it("serializes to JSON and parses back (round-trip)", () => {
    const raw = serializeTags(["family", "course"]);
    expect(raw).toBe('["family","course"]');
    expect(parseTags(raw)).toEqual(["family", "course"]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("not json")).toEqual([]);
  });

  it("serializes to null when there are no tags", () => {
    expect(serializeTags([])).toBeNull();
    expect(serializeTags(["  "])).toBeNull();
  });
});
