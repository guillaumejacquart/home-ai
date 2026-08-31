import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

/**
 * AES-256-GCM symmetric encryption for user secrets (OAuth tokens, SMTP/IMAP
 * credentials) stored in the database.
 *
 * The key is derived from `ENCRYPTION_KEY` (SHA-256 → 32 bytes). The encrypted
 * format is JSON: `{ iv, tag, data }` in base64 — self-contained, no separate
 * salt to store.
 */

function key(): Buffer {
  return createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

export function encrypt(plaintext: string): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const data = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return data.toString("utf8");
}

/** Encrypts a JSON object into an encrypted payload. */
export function encryptJson<T>(value: T): EncryptedPayload {
  return encrypt(JSON.stringify(value));
}

/** Decrypts a payload and parses the underlying JSON. */
export function decryptJson<T>(payload: EncryptedPayload): T {
  return JSON.parse(decrypt(payload)) as T;
}
