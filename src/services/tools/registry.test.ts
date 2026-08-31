import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toolRegistry } from "./registry";
import { exposedTo } from "./define";

/**
 * Registry safety net: without these checks, the errors only surface once
 * an MCP client connects or the LLM picks a tool.
 */

describe("tool registry", () => {
  it("doesn't expose the same name twice", () => {
    const names = toolRegistry.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("uses names accepted by MCP", () => {
    for (const tool of toolRegistry) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("describes every tool (that's all the LLM sees)", () => {
    for (const tool of toolRegistry) {
      expect(tool.description.trim().length, tool.name).toBeGreaterThan(20);
      expect(tool.title.trim().length, tool.name).toBeGreaterThan(0);
    }
  });

  it("exposes an object schema — the MCP adapter reads `.shape`", () => {
    for (const tool of toolRegistry) {
      expect(tool.input, tool.name).toBeInstanceOf(z.ZodObject);
      expect(typeof tool.input.shape, tool.name).toBe("object");
    }
  });

  it("targets at least one surface", () => {
    for (const tool of toolRegistry) {
      expect(tool.exposure.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("validates arguments before calling the handler", async () => {
    // A tool that requires a key must reject a call with no argument rather
    // than let `undefined` reach the service.
    const tool = toolRegistry.find((t) => t.name === "global_storage_get");
    expect(tool).toBeDefined();
    await expect(tool!.run({ userId: "u1", locale: "fr" }, {})).rejects.toThrow();
  });

  it("feeds both surfaces", () => {
    expect(toolRegistry.filter(exposedTo("assistant")).length).toBeGreaterThan(0);
    expect(toolRegistry.filter(exposedTo("mcp")).length).toBeGreaterThan(0);
  });
});
