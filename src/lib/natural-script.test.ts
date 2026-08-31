import { describe, expect, it } from "vitest";

import { previewSchedule } from "@/lib/script-format";
import { SCRIPT_PRESETS, isValidScript } from "@/lib/natural-script";

describe("natural-script.presets", () => {
  it("tous les presets sont des expressions script valides", () => {
    for (const preset of SCRIPT_PRESETS) {
      expect(previewSchedule(preset.schedule).valid, preset.label).toBe(true);
      expect(previewSchedule(preset.schedule).nextRuns.length).toBeGreaterThan(0);
    }
  });
  it("ne contient pas de doublons de schedule", () => {
    const schedules = SCRIPT_PRESETS.map((p) => p.schedule);
    expect(new Set(schedules).size).toBe(schedules.length);
  });
});

describe("natural-script.isValidScript", () => {
  it("accepte une expression valide", () => {
    expect(isValidScript("0 8 * * 1")).toBe(true);
  });
  it("rejette une expression invalide et une chaîne vide", () => {
    expect(isValidScript("not a script")).toBe(false);
    expect(isValidScript("")).toBe(false);
  });
});