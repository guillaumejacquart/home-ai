/**
 * Centralised RBAC policy: roles, permissions and the matrix linking them.
 *
 * This is the single place deciding "who can do what". better-auth (`admin`
 * plugin) stores the role on the `user` row and propagates it in the session;
 * this module then turns a role into rights.
 *
 * To add a capability:
 * 1. declare the permission in PERMISSIONS,
 * 2. grant it to roles in ROLE_PERMISSIONS,
 * 3. put `await requirePermission(...)` at the top of the relevant routes
 *    (see docs/key-flows.md § Common tasks).
 */

/** Roles stored in the database by better-auth's admin plugin. */
export const roles = ["admin", "user"] as const;
export type Role = (typeof roles)[number];

/** Protected platform capabilities (app/script ownership aside). */
export const permissions = [
  /** Platform settings: LLM API keys, connectivity test. */
  "platform.settings",
  /** Member management: listing + role changes. */
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
 * Pure check that a role holds a permission.
 * Lenient: an unknown role coming from the database is simply denied.
 */
export function can(role: string | null | undefined, permission: Permission): boolean {
  const r = asRole(role);
  if (!r) return false;
  return ROLE_PERMISSIONS[r].includes(permission);
}

/** Normalises a role coming from the session/database into the Role type. */
export function asRole(value: string | null | undefined): Role | null {
  return roles.includes(value as Role) ? (value as Role) : null;
}
