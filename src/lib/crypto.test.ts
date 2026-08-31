import { describe, expect, it } from "vitest";

import { decrypt, decryptJson, encrypt, encryptJson } from "@/lib/crypto";

describe("crypto", () => {
  it("encrypts then decrypts a string", () => {
    const plain = "a sensitive string with accents éèà";
    const payload = encrypt(plain);
    expect(payload.iv).toBeTruthy();
    expect(payload.data).not.toBe(plain);
    expect(decrypt(payload)).toBe(plain);
  });

  it("produces different IVs for each encryption", () => {
    const p1 = encrypt("secret");
    const p2 = encrypt("secret");
    expect(p1.data).not.toBe(p2.data);
    expect(decrypt(p1)).toBe("secret");
    expect(decrypt(p2)).toBe("secret");
  });

  it("encrypts/decrypts a JSON object", () => {
    const obj = { type: "smtp", data: { host: "x", pass: "p" } };
    const payload = encryptJson(obj);
    expect(decryptJson(payload)).toEqual(obj);
  });
});
