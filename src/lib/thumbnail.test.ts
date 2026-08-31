import { describe, expect, it } from "vitest";

import { thumbColors, thumbInitial, thumbStyle } from "@/lib/thumbnail";

describe("thumbnail", () => {
  it("produces two deterministic HSL colors for the same slug", () => {
    const a = thumbColors("weekly-recap");
    const b = thumbColors("weekly-recap");
    expect(a).toEqual(b);
    expect(a.from).toMatch(/^hsl\(/);
    expect(a.to).toMatch(/^hsl\(/);
  });

  it("distinguishes two different slugs (probably)", () => {
    const a = thumbColors("app-groceries");
    const b = thumbColors("app-weather");
    expect(a.from === b.from && a.to === b.to).toBe(false);
  });

  it("extracts the initial in uppercase", () => {
    expect(thumbInitial("weekly recap")).toBe("W");
    expect(thumbInitial(" école ")).toBe("É");
    expect(thumbInitial("")).toBe("?");
    expect(thumbInitial("   ")).toBe("?");
  });

  it("generates an inline gradient style", () => {
    const style = thumbStyle("slug");
    expect(style.backgroundImage).toContain("linear-gradient");
  });
});
