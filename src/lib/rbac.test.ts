import { describe, expect, it } from "vitest";

import { asRole, can, permissions } from "@/lib/rbac";

describe("rbac", () => {
  it("couvre toutes les permissions pour l'admin", () => {
    for (const permission of permissions) {
      expect(can("admin", permission)).toBe(true);
    }
  });

  it("ne donne aucune permission au membre", () => {
    for (const permission of permissions) {
      expect(can("user", permission)).toBe(false);
    }
  });

  it("refuse les rôles absents ou inconnus", () => {
    for (const permission of permissions) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(can("superadmin", permission)).toBe(false);
    }
  });

  it("normalise les rôles venant de la base", () => {
    expect(asRole("admin")).toBe("admin");
    expect(asRole("user")).toBe("user");
    expect(asRole("inconnu")).toBeNull();
    expect(asRole(null)).toBeNull();
  });
});
