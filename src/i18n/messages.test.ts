import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { locales } from "./config";
import { roles } from "@/lib/rbac";

type Messages = Record<string, Record<string, string>>;

/** Aplatit en clés « namespace.clé » pour comparer deux catalogues. */
function flatten(messages: Messages): string[] {
  return Object.entries(messages)
    .flatMap(([ns, entries]) => Object.keys(entries).map((key) => `${ns}.${key}`))
    .sort();
}

describe("catalogues de messages", () => {
  it("expose une langue par locale déclarée", () => {
    expect(locales).toEqual(["fr", "en"]);
  });

  it("a exactement les mêmes clés en fr et en en", () => {
    expect(flatten(en as Messages)).toEqual(flatten(fr as Messages));
  });

  it("n'a aucune valeur vide", () => {
    for (const [name, messages] of [
      ["fr", fr],
      ["en", en],
    ] as const) {
      for (const [ns, entries] of Object.entries(messages as Messages)) {
        for (const [key, value] of Object.entries(entries)) {
          expect(value.trim(), `${name}: ${ns}.${key}`).not.toBe("");
        }
      }
    }
  });

  it("définit un libellé pour chaque rôle", () => {
    for (const role of roles) {
      expect((fr as Messages).roles[role]).toBeTruthy();
      expect((en as Messages).roles[role]).toBeTruthy();
    }
  });
});
