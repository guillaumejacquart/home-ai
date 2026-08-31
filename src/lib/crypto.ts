import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

/**
 * Chiffrement symétrique AES-256-GCM pour les secrets utilisateurs
 * (tokens OAuth, identifiants SMTP/IMAP) stockés en base.
 *
 * La clé est dérivée de `ENCRYPTION_KEY` (SHA-256 → 32 octets). Le format
 * chiffré est JSON : `{ iv, tag, data }` en base64 — autonome, pas besoin de
 * stocker un sel séparé.
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

/** Chiffre un objet JSON en payload chiffré. */
export function encryptJson<T>(value: T): EncryptedPayload {
  return encrypt(JSON.stringify(value));
}

/** Déchiffre un payload et parse le JSON sous-jacent. */
export function decryptJson<T>(payload: EncryptedPayload): T {
  return JSON.parse(decrypt(payload)) as T;
}
