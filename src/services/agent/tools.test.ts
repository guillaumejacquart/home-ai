import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "@/services/tools/define";

/**
 * The old engine guessed a tool had failed by looking for `"error"` in the
 * serialized output, which marked any result containing that word as a
 * failure (list_script_runs returns an `error` column). The contract now is:
 * a failing tool throws, and the SDK produces the error part.
 */

const ctx = { userId: "u1", locale: "fr" as const };

describe("agent/tools", () => {
  it("lets a failing tool's exception propagate", async () => {
    const failing = defineTool({
      name: "failing_tool",
      description: "Tool that fails, to check propagation.",
      input: z.object({}),
      handler: async () => {
        throw new Error("boom");
      },
    });

    await expect(failing.run(ctx, {})).rejects.toThrow("boom");
  });

  it("does not treat output containing the word error as a failure", async () => {
    const runs = [{ status: "success", error: null }];
    const listing = defineTool({
      name: "listing_tool",
      description: "Returns rows where one column is named error.",
      input: z.object({}),
      handler: async () => runs,
    });

    const result = await listing.run(ctx, {});
    expect(result).toEqual(runs);
    expect(JSON.stringify(result)).toContain('"error"');
  });

  it("validates arguments before calling the handler", async () => {
    const strict = defineTool({
      name: "strict_tool",
      description: "Requires an id, to check zod validation.",
      input: z.object({ id: z.string() }),
      handler: async (_c, { id }) => id,
    });

    await expect(strict.run(ctx, {})).rejects.toThrow();
    await expect(strict.run(ctx, { id: "ok" })).resolves.toBe("ok");
  });

  it("exposes destructive tools for the confirmation prompt", async () => {
    const { destructiveToolNames } = await import("./tools");
    const names = destructiveToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("delete_app");
  });
});
