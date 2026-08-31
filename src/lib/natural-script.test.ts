import { describe, expect, it } from "vitest";

import { previewSchedule } from "@/lib/script-format";
import { SCRIPT_PRESETS, isValidScript } from "@/lib/natural-script";

describe("natural-script.presets", () => {
  it("every preset is a valid script expression", () => {
    for (const preset of SCRIPT_PRESETS) {
      expect(previewSchedule(preset.schedule).valid, preset.labelKey).toBe(true);
      expect(previewSchedule(preset.schedule).nextRuns.length).toBeGreaterThan(0);
    }
  });
  it("contains no duplicate schedules", () => {
    const schedules = SCRIPT_PRESETS.map((p) => p.schedule);
    expect(new Set(schedules).size).toBe(schedules.length);
  });
});

describe("natural-script.isValidScript", () => {
  it("accepts a valid expression", () => {
    expect(isValidScript("0 8 * * 1")).toBe(true);
  });
  it("rejects an invalid expression and an empty string", () => {
    expect(isValidScript("not a script")).toBe(false);
    expect(isValidScript("")).toBe(false);
  });
});
