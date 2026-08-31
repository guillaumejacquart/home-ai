import { describe, expect, it } from "vitest";

import { previewSchedule } from "./script-format";

describe("previewSchedule", () => {
  it("retourne les prochaines exécutions d'une expression valide", () => {
    const result = previewSchedule("0 8 * * 1");
    expect(result.valid).toBe(true);
    expect(result.nextRuns).toHaveLength(3);
    expect(result.error).toBeUndefined();
  });

  it("respecte le nombre d'occurrences demandé", () => {
    expect(previewSchedule("*/5 * * * *", 5).nextRuns).toHaveLength(5);
  });

  it("signale une expression invalide", () => {
    const result = previewSchedule("pas un script");
    expect(result.valid).toBe(false);
    expect(result.nextRuns).toEqual([]);
    expect(result.error).toBe("invalid");
  });

  it("signale une planification vide", () => {
    expect(previewSchedule("   ")).toMatchObject({ valid: false, error: "empty" });
  });

  it("rejette un champ hors bornes", () => {
    expect(previewSchedule("0 99 * * *").valid).toBe(false);
  });
});
