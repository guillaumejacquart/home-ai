import { describe, expect, it } from "vitest";

import { previewSchedule } from "./script-format";

describe("previewSchedule", () => {
  it("returns the upcoming runs of a valid expression", () => {
    const result = previewSchedule("0 8 * * 1");
    expect(result.valid).toBe(true);
    expect(result.nextRuns).toHaveLength(3);
    expect(result.error).toBeUndefined();
  });

  it("respects the requested number of occurrences", () => {
    expect(previewSchedule("*/5 * * * *", 5).nextRuns).toHaveLength(5);
  });

  it("flags an invalid expression", () => {
    const result = previewSchedule("not a schedule");
    expect(result.valid).toBe(false);
    expect(result.nextRuns).toEqual([]);
    expect(result.error).toBe("invalid");
  });

  it("flags an empty schedule", () => {
    expect(previewSchedule("   ")).toMatchObject({ valid: false, error: "empty" });
  });

  it("rejects a field out of bounds", () => {
    expect(previewSchedule("0 99 * * *").valid).toBe(false);
  });
});
