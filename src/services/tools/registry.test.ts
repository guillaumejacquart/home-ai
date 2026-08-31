import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toolRegistry } from "./registry";
import { exposedTo } from "./define";

/**
 * Garde-fous du registre : ce sont les erreurs qui, sinon, ne se voient qu'au
 * moment où un client MCP se connecte ou où le LLM choisit un outil.
 */

describe("registre d'outils", () => {
  it("n'expose pas deux fois le même nom", () => {
    const names = toolRegistry.map((t) => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("utilise des noms acceptés par MCP", () => {
    for (const tool of toolRegistry) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("décrit chaque outil (le LLM ne voit que ça)", () => {
    for (const tool of toolRegistry) {
      expect(tool.description.trim().length, tool.name).toBeGreaterThan(20);
      expect(tool.title.trim().length, tool.name).toBeGreaterThan(0);
    }
  });

  it("expose un schéma objet — l'adaptateur MCP lit `.shape`", () => {
    for (const tool of toolRegistry) {
      expect(tool.input, tool.name).toBeInstanceOf(z.ZodObject);
      expect(typeof tool.input.shape, tool.name).toBe("object");
    }
  });

  it("cible au moins une surface", () => {
    for (const tool of toolRegistry) {
      expect(tool.exposure.length, tool.name).toBeGreaterThan(0);
    }
  });

  it("valide les arguments avant d'appeler le handler", async () => {
    // Un outil qui exige une clé doit refuser un appel sans argument plutôt
    // que de laisser passer `undefined` jusqu'au service.
    const tool = toolRegistry.find((t) => t.name === "global_storage_get");
    expect(tool).toBeDefined();
    await expect(tool!.run({ userId: "u1", locale: "fr" }, {})).rejects.toThrow();
  });

  it("alimente les deux surfaces", () => {
    expect(toolRegistry.filter(exposedTo("assistant")).length).toBeGreaterThan(0);
    expect(toolRegistry.filter(exposedTo("mcp")).length).toBeGreaterThan(0);
  });
});
