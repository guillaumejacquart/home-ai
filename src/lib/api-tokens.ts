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

/** Empreinte SHA-256 (hex) d'un jeton en clair — le clair n'est jamais persisté. */
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Crée un nouveau token d'accès pour un utilisateur et renvoie le jeton en
 * clair — il n'est affiché qu'une seule fois (on ne stocke que l'empreinte).
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

/** Liste les tokens d'un utilisateur (jamais les empreintes/clears). */
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

/** Révoque un token appartenant à l'utilisateur (soft delete via revokedAt). */
export async function revokeApiToken(userId: string, id: string) {
  const row = await db
    .select({ id: tables.apiTokens.id })
    .from(tables.apiTokens)
    .where(and(eq(tables.apiTokens.id, id), eq(tables.apiTokens.userId, userId)))
    .get();
  if (!row) throw new TokenError("Token introuvable.");
  await db
    .update(tables.apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(tables.apiTokens.id, id));
}

/**
 * Résout l'utilisateur propriétaire d'un jeton en clair, ou null s'il est
 * inconnu ou révoqué. Met à jour lastUsedAt à chaque utilisation.
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

/** Extrait un jeton Bearer de l'en-tête Authorization ("Bearer hai_..."). */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const token = m[1].trim();
  return token.startsWith(TOKEN_PREFIX) ? token : null;
}
