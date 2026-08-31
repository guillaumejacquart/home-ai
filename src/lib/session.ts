import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { auth } from "@/lib/auth";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { can, type Permission } from "@/lib/rbac";
import { extractBearerToken, resolveApiToken } from "@/lib/api-tokens";

/** Récupère la session courante côté serveur (ou null). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Utilisateur authentifié, quel que soit le moyen (session ou token Bearer). */
export type AuthUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];

/** Charge l'utilisateur complet depuis la base (références FK, rôle…). */
async function loadUserById(userId: string): Promise<AuthUser | null> {
  const row = await db
    .select()
    .from(tables.user)
    .where(eq(tables.user.id, userId))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    role: row.role,
    banned: row.banned,
    banReason: row.banReason,
    banExpires: row.banExpires,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Récupère l'utilisateur courant, ou lève UnauthenticatedError si non connecté.
 *
 * Deux moyens d'authentification :
 *  - une session better-auth (cookie, UI navigateur) ;
 *  - un token d'accès personnel en `Authorization: Bearer hai_...`
 *    (accès programmeur : REST + MCP). Les tokens sont résolus par empreinte,
 *    jamais stockés en clair, et révocables.
 */
export async function requireUser(): Promise<AuthUser> {
  const session = await getSession();
  if (session?.user) {
    return session.user;
  }

  const h = await headers();
  const bearer = extractBearerToken(h.get("authorization"));
  if (bearer) {
    const resolved = await resolveApiToken(bearer);
    if (resolved) {
      const user = await loadUserById(resolved.userId);
      if (user) return user;
    }
  }

  throw new UnauthenticatedError();
}

/**
 * Récupère l'utilisateur courant et vérifie qu'il dispose de la permission
 * demandée (cf. lib/rbac.ts). Lève UnauthenticatedError / ForbiddenError.
 */
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new ForbiddenError();
  }
  return user;
}
