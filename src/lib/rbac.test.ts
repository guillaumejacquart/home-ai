import { describe, expect, it } from "vitest";

import { asRole, can, permissions } from "@/lib/rbac";

describe("rbac", () => {
  it("covers every permission for admin", () => {
    for (const permission of permissions) {
      expect(can("admin", permission)).toBe(true);
    }
  });

  it("grants no permission to a regular user", () => {
    for (const permission of permissions) {
      expect(can("user", permission)).toBe(false);
    }
  });

  it("rejects missing or unknown roles", () => {
    for (const permission of permissions) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(can("superadmin", permission)).toBe(false);
    }
  });

  it("normalizes roles coming from the database", () => {
    expect(asRole("admin")).toBe("admin");
    expect(asRole("user")).toBe("user");
    expect(asRole("unknown")).toBeNull();
    expect(asRole(null)).toBeNull();
  });
});
