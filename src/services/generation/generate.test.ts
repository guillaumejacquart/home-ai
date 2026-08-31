import { afterEach, describe, expect, it, vi } from "vitest";

import { chatCompletionDetailed } from "@/services/llm/llm";
import {
  containsForbiddenStorage,
  extractHtml,
  looksTruncatedHtml,
} from "@/services/generation/app";
import { chatWithTruncationRetry } from "@/services/generation/shared";
import { slugify } from "@/services/apps/apps";

vi.mock("@/services/llm/llm", () => ({
  chatCompletion: vi.fn(),
  chatCompletionDetailed: vi.fn(),
  chatCompletionStream: vi.fn(),
  defaultModels: { planner: "planner-test", coder: "coder-test" },
  LlmError: class LlmError extends Error {},
}));

const mockedDetailed = vi.mocked(chatCompletionDetailed);

describe("generate.extractHtml", () => {
  it("extrait le contenu d'un bloc ```html```", () => {
    const text = "Voici le code :\n```html\n<div>Bonjour</div>\n```\nFin.";
    expect(extractHtml(text)).toBe("<div>Bonjour</div>");
  });

  it("retourne tout le texte si pas de bloc marqué", () => {
    const text = "<div>Direct</div>";
    expect(extractHtml(text)).toBe("<div>Direct</div>");
  });

  it("retire les blancs de bord", () => {
    expect(extractHtml("  <p>ok</p>\n")).toBe("<p>ok</p>");
  });

  it("retire un marqueur ```html resté en tête (sans bloc fermé)", () => {
    expect(extractHtml("```html\n<div>Rendu</div>")).toBe("<div>Rendu</div>");
  });

  it("retire un marqueur ``` en tête et en fin", () => {
    expect(extractHtml("```\n<div>Rendu</div>\n```")).toBe("<div>Rendu</div>");
  });
});

describe("generate.containsForbiddenStorage", () => {
  it("détecte localStorage", () => {
    expect(containsForbiddenStorage("localStorage.setItem('a', 'b')")).toBe(true);
  });
  it("détecte sessionStorage / IndexedDB / document.cookie", () => {
    expect(containsForbiddenStorage("sessionStorage.getItem('x')")).toBe(true);
    expect(containsForbiddenStorage("indexedDB.open('db')")).toBe(true);
    expect(containsForbiddenStorage("document.cookie = 'a=b'")).toBe(true);
  });
  it("accepte un code qui n'utilise que homeSDK.storage", () => {
    const html = "<script>await homeSDK.storage.set('tasks', [])</script>";
    expect(containsForbiddenStorage(html)).toBe(false);
  });
});

describe("generate.looksTruncatedHtml", () => {
  it("détecte une troncature via finish_reason length", () => {
    expect(looksTruncatedHtml("<div>ok</div>", "length")).toBe(true);
  });

  // Attente inversée volontairement : le format stocké est un fragment (cf. les
  // templates du dépôt, qui finissent par </script>). Exiger </html> déclarait
  // tronquée toute app correcte installée depuis un template.
  it("accepte un fragment bien formé, sans </html>", () => {
    expect(looksTruncatedHtml("<div>ok</div>", "stop")).toBe(false);
    expect(looksTruncatedHtml("<div>ok</div>", null)).toBe(false);
  });

  it("accepte un HTML complet", () => {
    const full = "<html><body><p>ok</p></body></html>";
    expect(looksTruncatedHtml(full, "stop")).toBe(false);
    expect(looksTruncatedHtml(`${full}\n`, null)).toBe(false);
  });
});

describe("generate.chatWithTruncationRetry", () => {
  afterEach(() => {
    mockedDetailed.mockReset();
  });

  it("retourne directement une réponse non tronquée", async () => {
    mockedDetailed.mockResolvedValueOnce({ text: "<html></html>", finishReason: "stop" });
    const r = await chatWithTruncationRetry(
      [{ role: "user", content: "x" }],
      { maxTokens: 16384 },
      (t, f) => looksTruncatedHtml(t, f),
    );
    expect(r).toEqual({ text: "<html></html>", finishReason: "stop" });
    expect(mockedDetailed).toHaveBeenCalledTimes(1);
  });

  it("réessaie une fois avec un budget doublé si tronqué, puis réussit", async () => {
    mockedDetailed
      .mockResolvedValueOnce({ text: "<div>incomplet", finishReason: "length" })
      .mockResolvedValueOnce({ text: "<html></html>", finishReason: "stop" });
    const r = await chatWithTruncationRetry(
      [{ role: "user", content: "x" }],
      { maxTokens: 16384 },
      (t, f) => looksTruncatedHtml(t, f),
    );
    expect(r).toEqual({ text: "<html></html>", finishReason: "stop" });
    expect(mockedDetailed).toHaveBeenCalledTimes(2);
    expect(mockedDetailed.mock.calls[1][1]?.maxTokens).toBe(32768);
  });

  it("jette une LlmError si toujours tronqué après le retry", async () => {
    mockedDetailed.mockResolvedValue({ text: "<div>incomplet", finishReason: "length" });
    await expect(
      chatWithTruncationRetry(
        [{ role: "user", content: "x" }],
        { maxTokens: 16384 },
        (t, f) => looksTruncatedHtml(t, f),
      ),
    ).rejects.toThrow("tronquée");
    expect(mockedDetailed).toHaveBeenCalledTimes(2);
  });
});

describe("apps.slugify", () => {
  it("normalise un nom en slug", () => {
    expect(slugify("Récap de Semaine")).toBe("recap-de-semaine");
  });
  it("retombe sur un slug par défaut si vide", () => {
    expect(slugify("!!!" )).toBe("app");
  });
});
