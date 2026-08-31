import { describe, expect, it } from "vitest";

import { findTool } from "@/services/tools/registry";

/**
 * Le modèle passait à generate_app l'objet renvoyé par plan_app, alors que le
 * schéma exigeait une chaîne : appel rejeté, puis retry manuel avec un
 * JSON.stringify. Les deux formes sont désormais acceptées.
 */

describe("generate_app — paramètre plan", () => {
  const tool = findTool("generate_app")!;

  it("accepte le plan sous forme d'objet et le sérialise", () => {
    const parsed = tool.input.parse({
      appId: "a1",
      prompt: "corrige l'affichage",
      plan: { summary: "corriger", changes: ["une chose"] },
    }) as { plan?: string };

    expect(typeof parsed.plan).toBe("string");
    expect(parsed.plan).toContain("corriger");
  });

  it("accepte le plan sous forme de chaîne, inchangé", () => {
    const parsed = tool.input.parse({
      appId: "a1",
      prompt: "corrige",
      plan: "plan en texte",
    }) as { plan?: string };
    expect(parsed.plan).toBe("plan en texte");
  });

  it("reste optionnel", () => {
    const parsed = tool.input.parse({ appId: "a1", prompt: "crée" }) as { plan?: string };
    expect(parsed.plan).toBeUndefined();
  });
});
