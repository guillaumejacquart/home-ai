import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// app.ts tire la couche LLM : on la neutralise, ces fonctions sont pures.
vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  chatCompletionStream: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const { extractHtml, looksTruncatedHtml } = await import("./app");

/**
 * Cas vu en prod (durée 90 s + 57 s) : le second appel du coder finit tout seul
 * mais est quand même déclaré tronqué. Un modèle qui commente son travail après
 * le document, sans bloc ```html, faisait échouer le test « finit par </html> ».
 */
describe("extractHtml", () => {
  const doc = "<!DOCTYPE html>\n<html><body>ok</body></html>";

  it("coupe la prose qui suit la balise fermante", () => {
    const html = extractHtml(`${doc}\n\nVoilà, j'ai ajouté le tri par priorité !`);
    expect(html).toBe(doc);
    expect(looksTruncatedHtml(html, "stop")).toBe(false);
  });

  it("gère une balise fermante en majuscules", () => {
    const html = extractHtml("<html><body>x</body></HTML>\n\nC'est fait.");
    expect(html.endsWith("</HTML>")).toBe(true);
    expect(looksTruncatedHtml(html, "stop")).toBe(false);
  });

  it("préfère le bloc ```html quand il existe", () => {
    expect(extractHtml(`Voici :\n\`\`\`html\n${doc}\n\`\`\`\nBonne journée !`)).toBe(doc);
  });

  it("laisse un document réellement tronqué détectable", () => {
    const cut = "<!DOCTYPE html>\n<html><body>incomp";
    expect(extractHtml(cut)).toBe(cut);
    expect(looksTruncatedHtml(extractHtml(cut), null)).toBe(true);
  });

  it("respecte finishReason=length même si le HTML paraît complet", () => {
    expect(looksTruncatedHtml(doc, "length")).toBe(true);
  });
});

/**
 * Les quatre templates du dépôt sont des FRAGMENTS finissant par </script>.
 * L'ancienne détection exigeait </html> : toute itération sur une app installée
 * depuis un template était donc déclarée tronquée, par construction.
 */
describe("looksTruncatedHtml — format fragment", () => {
  it("accepte les templates réels du dépôt", () => {
    for (const name of ["todo", "notes", "budget", "planning"]) {
      const fragment = readFileSync(`templates/${name}/app.html`, "utf8");
      expect(looksTruncatedHtml(fragment, "stop"), name).toBe(false);
    }
  });

  it("accepte aussi un document complet", () => {
    expect(looksTruncatedHtml("<html><body><p>x</p></body></html>", "stop")).toBe(false);
  });

  it("détecte un <script> jamais refermé", () => {
    expect(looksTruncatedHtml("<div>a</div>\n<script>function app(){ return {", null)).toBe(true);
  });

  it("détecte une coupure au milieu d'une balise", () => {
    expect(looksTruncatedHtml("<div class=\"x\">ok</div>\n<sect", null)).toBe(true);
  });

  it("refuse un fragment vide", () => {
    expect(looksTruncatedHtml("   ", "stop")).toBe(true);
  });
});
