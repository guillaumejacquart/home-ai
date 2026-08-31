import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { locales } from "./config";
import { roles } from "@/lib/rbac";

type Messages = Record<string, Record<string, string>>;

/** Flattens into "namespace.key" strings to compare two catalogues. */
function flatten(messages: Messages): string[] {
  return Object.entries(messages)
    .flatMap(([ns, entries]) => Object.keys(entries).map((key) => `${ns}.${key}`))
    .sort();
}

describe("message catalogues", () => {
  it("exposes a catalogue for every declared locale", () => {
    expect(locales).toEqual(["fr", "en"]);
  });

  it("has exactly the same keys in fr and en", () => {
    expect(flatten(en as Messages)).toEqual(flatten(fr as Messages));
  });

  it("has no empty value", () => {
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

  it("defines a label for every role", () => {
    for (const role of roles) {
      expect((fr as Messages).roles[role]).toBeTruthy();
      expect((en as Messages).roles[role]).toBeTruthy();
    }
  });
});
