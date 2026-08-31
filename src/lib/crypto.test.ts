import { describe, expect, it } from "vitest";

import { decrypt, decryptJson, encrypt, encryptJson } from "@/lib/crypto";

describe("crypto", () => {
  it("chiffre puis déchiffre une chaîne", () => {
    const plain = "une chaîne sensible avec accents éèà";
    const payload = encrypt(plain);
    expect(payload.iv).toBeTruthy();
    expect(payload.data).not.toBe(plain);
    expect(decrypt(payload)).toBe(plain);
  });

  it("produit des IV différents à chaque chiffrement", () => {
    const p1 = encrypt("secret");
    const p2 = encrypt("secret");
    expect(p1.data).not.toBe(p2.data);
    expect(decrypt(p1)).toBe("secret");
    expect(decrypt(p2)).toBe("secret");
  });

  it("chiffre/déchiffre un objet JSON", () => {
    const obj = { type: "smtp", data: { host: "x", pass: "p" } };
    const payload = encryptJson(obj);
    expect(decryptJson(payload)).toEqual(obj);
  });
});
