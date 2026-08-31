import { headers } from "next/headers";
import { eq } from "drizzle-orm";

import { db, tables } from "@/db/client";
import { auth } from "@/lib/auth";
import { ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { can, type Permission } from "@/lib/rbac";
import { extractBearerToken, resolveApiToken } from "@/lib/api-tokens";

/** Reads the current server-side session (or null). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Authenticated user, whichever way they authenticated (session or Bearer token). */
export type AuthUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];

/** Loads the full user from the database (FK references, role…). */
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
 * Returns the current user, or throws UnauthenticatedError when not signed in.
 *
 * Deux moyens d'authentification :
 *  - a better-auth session (cookie, browser UI);
 *  - a personal access token in `Authorization: Bearer hai_...`
 *    (programmatic access: REST + MCP). Tokens are resolved by digest, never
 *    stored in plaintext, and can be revoked.
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
 * Returns the current user and checks they hold the requested permission (see
 * lib/rbac.ts). Throws UnauthenticatedError / ForbiddenError.
 */
export async function requirePermission(permission: Permission) {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new ForbiddenError();
  }
  return user;
}
