import { describe, expect, it } from "vitest";

import { findTool } from "@/services/tools/registry";

/**
 * The model would pass generate_app the object returned by plan_app, even
 * though the schema required a string, so the call got rejected and retried
 * manually with a JSON.stringify. Both forms are now accepted.
 */

describe("generate_app — plan parameter", () => {
  const tool = findTool("generate_app")!;

  it("accepts the plan as an object and serialises it", () => {
    const parsed = tool.input.parse({
      appId: "a1",
      prompt: "fix the display",
      plan: { summary: "fix", changes: ["one thing"] },
    }) as { plan?: string };

    expect(typeof parsed.plan).toBe("string");
    expect(parsed.plan).toContain("fix");
  });

  it("accepts the plan as a string, unchanged", () => {
    const parsed = tool.input.parse({
      appId: "a1",
      prompt: "fix",
      plan: "plain text plan",
    }) as { plan?: string };
    expect(parsed.plan).toBe("plain text plan");
  });

  it("stays optional", () => {
    const parsed = tool.input.parse({ appId: "a1", prompt: "create" }) as { plan?: string };
    expect(parsed.plan).toBeUndefined();
  });
});
