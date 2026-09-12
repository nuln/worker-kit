import { describe, it, expect } from "vitest";
import {
  hasRole,
  hasScope,
  isAdminRole,
  isUserInAdminList,
  computeEffectiveUserGroups,
} from "../src/rbac/index.js";

describe("@nuln/worker-kit/rbac", () => {
  it("hasRole: 角色等级判定", () => {
    expect(hasRole("superadmin", "admin")).toBe(true);
    expect(hasRole("admin", "member")).toBe(true);
    expect(hasRole("member", "admin")).toBe(false);
    expect(hasRole("guest", "member")).toBe(false);
  });

  it("hasScope: 范围与通配符判定", () => {
    expect(hasScope("openid profile email", "profile")).toBe(true);
    expect(hasScope(["openid", "mail:send"], "mail:send")).toBe(true);
    expect(hasScope("mail:*", "mail:read")).toBe(true);
    expect(hasScope("*", "any:permission")).toBe(true);
    expect(hasScope("openid profile", "admin:write")).toBe(false);
  });

  it("isAdminRole: 角色名别名判定", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("Admin")).toBe(true);
    expect(isAdminRole("管理员")).toBe(true);
    expect(isAdminRole("superadmin")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
  });

  it("isUserInAdminList: 邮箱判定", () => {
    const admins = ["Admin@nuln.dev", "super@nuln.dev"];
    expect(isUserInAdminList("admin@nuln.dev", admins)).toBe(true);
    expect(isUserInAdminList("other@nuln.dev", admins)).toBe(false);
  });

  it("computeEffectiveUserGroups: 分组聚合与去重", () => {
    const groups = computeEffectiveUserGroups(["dev", "design"], ["everyone", "dev"], true);
    expect(groups).toContain("dev");
    expect(groups).toContain("design");
    expect(groups).toContain("everyone");
    expect(groups).toContain("admin");
    expect(groups.filter((g) => g === "dev").length).toBe(1);
  });
});
