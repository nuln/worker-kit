import { describe, it, expect } from "vitest";
import {
  hasRole,
  hasScope,
  isAdminRole,
  isUserInAdminList,
  computeEffectiveUserGroups,
  type Role,
} from "../../src/rbac/index.js";

describe("[E2E Example] 13 - Multi-Tenant Hierarchical RBAC Authorization Engine", () => {
  it("orchestrates role hierarchy, scope wildcard matching, and effective group aggregation", () => {
    // 1. Role Hierarchy Verification
    // superadmin (100) > admin (50) > member (10) > guest (1)
    expect(hasRole("superadmin", "admin")).toBe(true);
    expect(hasRole("superadmin", "member")).toBe(true);
    expect(hasRole("admin", "member")).toBe(true);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole("guest", "member")).toBe(false);

    // 2. Scope Matching with wildcard support
    expect(hasScope("mail:read mail:send", "mail:send")).toBe(true);
    expect(hasScope("mail:*", "mail:send")).toBe(true);
    expect(hasScope("*", "system:backup")).toBe(true);
    expect(hasScope("mail:read", "mail:write")).toBe(false);

    // 3. Admin Detection
    expect(isAdminRole("superadmin")).toBe(true);
    expect(isAdminRole("Administrator")).toBe(true);
    expect(isAdminRole("member")).toBe(false);

    // 4. Admin Whitelist Verification
    expect(isUserInAdminList("admin@nuln.net", ["admin@nuln.net", "ops@nuln.net"])).toBe(true);
    expect(isUserInAdminList("other@nuln.net", ["admin@nuln.net"])).toBe(false);

    // 5. Effective User Groups Aggregation
    const groups = computeEffectiveUserGroups(["devs"], ["all-users"], true);
    expect(groups).toContain("devs");
    expect(groups).toContain("all-users");
    expect(groups).toContain("admin"); // SuperAdmin automatically gets "admin"
  });
});
