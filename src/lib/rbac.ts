/**
 * Politique RBAC centralisée : rôles, permissions et matrice associée.
 *
 * C'est l'unique endroit où l'on décide « qui peut faire quoi ». better-auth
 * (plugin `admin`) stocke le rôle sur la ligne `user` et le propage dans la
 * session ; ce module traduit ensuite un rôle en droits.
 *
 * Pour ajouter une capacité :
 * 1. déclarer la permission dans PERMISSIONS,
 * 2. l'attribuer aux rôles dans ROLE_PERMISSIONS,
 * 3. poser `await requirePermission(...)` en tête des routes concernées
 *    (cf. docs/key-flows.md § Common tasks).
 */

/** Rôles stockés en base par le plugin admin de better-auth. */
export const roles = ["admin", "user"] as const;
export type Role = (typeof roles)[number];

/** Capacités protégées de la plateforme (hors ownership d'apps/scripts). */
export const permissions = [
  /** Réglages plateforme : clés API LLM, test de connectivité. */
  "platform.settings",
  /** Gestion des membres : liste + changement de rôle. */
  "users.manage",
] as const;
export type Permission = (typeof permissions)[number];

export const roleLabels: Record<Role, string> = {
  admin: "Admin",
  user: "Membre",
};

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: permissions,
  user: [],
};

/**
 * Vérifie purement fonctionnellement qu'un rôle dispose d'une permission.
 * Tolérant : un rôle inconnu venant de la base est simplement refusé.
 */
export function can(role: string | null | undefined, permission: Permission): boolean {
  const r = asRole(role);
  if (!r) return false;
  return ROLE_PERMISSIONS[r].includes(permission);
}

/** Normalise un rôle venant de la session/base vers le type Role. */
export function asRole(value: string | null | undefined): Role | null {
  return roles.includes(value as Role) ? (value as Role) : null;
}
