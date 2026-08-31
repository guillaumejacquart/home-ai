import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTool } from "@/services/tools/define";

/**
 * L'ancien moteur devinait l'échec d'un outil en cherchant `"error"` dans la
 * sortie sérialisée, ce qui marquait en échec tout résultat contenant ce mot
 * (list_script_runs renvoie une colonne `error`). Le contrat est maintenant :
 * un outil qui échoue lève, et c'est le SDK qui produit la part d'erreur.
 */

const ctx = { userId: "u1", locale: "fr" as const };

describe("agent/tools", () => {
  it("laisse remonter l'exception d'un outil en échec", async () => {
    const failing = defineTool({
      name: "failing_tool",
      description: "Outil qui échoue, pour vérifier la propagation.",
      input: z.object({}),
      handler: async () => {
        throw new Error("boom");
      },
    });

    await expect(failing.run(ctx, {})).rejects.toThrow("boom");
  });

  it("ne considère pas comme un échec une sortie contenant le mot error", async () => {
    const runs = [{ status: "success", error: null }];
    const listing = defineTool({
      name: "listing_tool",
      description: "Renvoie des lignes dont une colonne s'appelle error.",
      input: z.object({}),
      handler: async () => runs,
    });

    const result = await listing.run(ctx, {});
    expect(result).toEqual(runs);
    expect(JSON.stringify(result)).toContain('"error"');
  });

  it("valide les arguments avant d'appeler le handler", async () => {
    const strict = defineTool({
      name: "strict_tool",
      description: "Exige un identifiant, pour vérifier la validation zod.",
      input: z.object({ id: z.string() }),
      handler: async (_c, { id }) => id,
    });

    await expect(strict.run(ctx, {})).rejects.toThrow();
    await expect(strict.run(ctx, { id: "ok" })).resolves.toBe("ok");
  });

  it("expose les outils destructifs pour le prompt de confirmation", async () => {
    const { destructiveToolNames } = await import("./tools");
    const names = destructiveToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("delete_app");
  });
});
