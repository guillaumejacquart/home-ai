import { and, desc, eq, isNull } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { db, tables } from "@/db/client";
import { HttpError } from "@/lib/errors";

export class TokenError extends HttpError {
  constructor(message: string) {
    super(message, 400);
  }
}

const TOKEN_PREFIX = "hai_";

/** SHA-256 (hex) digest of a plaintext token — the plaintext is never persisted. */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a new access token for a user and returns the plaintext token — it is
 * shown only once (only the digest is stored).
 */
export async function createApiToken(userId: string, name: string): Promise<string> {
  const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  const id = randomUUID();
  await db.insert(tables.apiTokens).values({
    id,
    userId,
    name,
    tokenHash: hash(raw),
    prefix: raw.slice(0, 12),
    createdAt: new Date(),
  });
  return raw;
}

/** Lists a user's tokens (never the digests or plaintexts). */
export async function listApiTokens(userId: string) {
  const rows = await db
    .select({
      id: tables.apiTokens.id,
      name: tables.apiTokens.name,
      prefix: tables.apiTokens.prefix,
      createdAt: tables.apiTokens.createdAt,
      lastUsedAt: tables.apiTokens.lastUsedAt,
      revokedAt: tables.apiTokens.revokedAt,
    })
    .from(tables.apiTokens)
    .where(and(eq(tables.apiTokens.userId, userId), isNull(tables.apiTokens.revokedAt)))
    .orderBy(desc(tables.apiTokens.createdAt));
  return rows;
}

/** Revokes a token owned by the user (soft delete via revokedAt). */
export async function revokeApiToken(userId: string, id: string) {
  const row = await db
    .select({ id: tables.apiTokens.id })
    .from(tables.apiTokens)
    .where(and(eq(tables.apiTokens.id, id), eq(tables.apiTokens.userId, userId)))
    .get();
  if (!row) throw new TokenError("Token not found.");
  await db
    .update(tables.apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(tables.apiTokens.id, id));
}

/**
 * Resolves the user owning a plaintext token, or null if it is unknown or
 * revoked. Updates lastUsedAt on every use.
 */
export async function resolveApiToken(
  raw: string,
): Promise<{ userId: string } | null> {
  const row = await db
    .select({ userId: tables.apiTokens.userId, revokedAt: tables.apiTokens.revokedAt })
    .from(tables.apiTokens)
    .where(eq(tables.apiTokens.tokenHash, hash(raw)))
    .get();
  if (!row || row.revokedAt) return null;
  await db
    .update(tables.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(tables.apiTokens.tokenHash, hash(raw)));
  return { userId: row.userId };
}

/** Extracts a Bearer token from the Authorization header ("Bearer hai_..."). */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const token = m[1].trim();
  return token.startsWith(TOKEN_PREFIX) ? token : null;
}
