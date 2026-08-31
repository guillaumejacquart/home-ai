import { describe, it, expect } from "vitest";

import { validateLayout } from "./dashboards";

describe("validateLayout", () => {
  it("accepts a valid layout", () => {
    const layout = validateLayout({
      cols: 12,
      widgets: [{ i: "w1", appId: "app-1", x: 0, y: 0, w: 6, h: 4 }],
    });
    expect(layout.widgets).toHaveLength(1);
  });

  it("rejects when cols != 12", () => {
    expect(() => validateLayout({ cols: 8, widgets: [] })).toThrow();
  });

  it("rejects w out of bounds", () => {
    expect(() => validateLayout({ cols: 12, widgets: [{ i: "w1", appId: "a", x: 0, y: 0, w: 1, h: 4 }] })).toThrow();
    expect(() => validateLayout({ cols: 12, widgets: [{ i: "w1", appId: "a", x: 0, y: 0, w: 13, h: 4 }] })).toThrow();
  });

  it("rejects x+w > 12", () => {
    expect(() =>
      validateLayout({ cols: 12, widgets: [{ i: "w1", appId: "a", x: 8, y: 0, w: 6, h: 4 }] }),
    ).toThrow();
  });

  it("rejects a duplicate id", () => {
    expect(() =>
      validateLayout({
        cols: 12,
        widgets: [
          { i: "w1", appId: "a", x: 0, y: 0, w: 6, h: 4 },
          { i: "w1", appId: "b", x: 6, y: 0, w: 6, h: 4 },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than 20 widgets", () => {
    const widgets = Array.from({ length: 21 }, (_, i) => ({
      i: `w${i}`,
      appId: `a${i}`,
      x: 0,
      y: i,
      w: 6,
      h: 2,
    }));
    expect(() => validateLayout({ cols: 12, widgets })).toThrow();
  });

  it("truncates title to 80", () => {
    const long = "a".repeat(200);
    const layout = validateLayout({ cols: 12, widgets: [{ i: "w1", appId: "a", x: 0, y: 0, w: 6, h: 4, title: long }] });
    expect(layout.widgets[0].title?.length).toBe(80);
  });
});
