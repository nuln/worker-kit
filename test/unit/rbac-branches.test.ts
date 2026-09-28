/**
 * RBAC 的分支覆盖补齐
 *
 * ## 为什么专门补这一块
 *
 * `rbac/index.ts` 的分支覆盖率 82.97%，未覆盖的恰好是 **fail-closed 的判定本身**：
 *
 * - 角色归一化（trim + 小写）
 * - `!Object.hasOwn(ROLE_HIERARCHY, cur) → false`
 *   —— 未知角色必须拒绝。判错就是「任意字符串提权」
 * - `hasScope` 的通配符与空值分支
 * - `isUserInAdminList` 的大小写不敏感匹配
 *
 * 权限判定的错误不会报错，只会**静默放行或静默拒绝**，因此边界必须钉死。
 */

import { describe, it, expect } from "vitest";
import {
  hasRole,
  hasScope,
  isAdminRole,
  isUserInAdminList,
  computeEffectiveUserGroups,
  type Role,
} from "../../src/rbac/index.js";

describe("hasRole：角色归一化", () => {
  it("大小写与空白不敏感", () => {
    expect(hasRole("ADMIN", "admin")).toBe(true);
    expect(hasRole("  Admin  " as Role, "admin")).toBe(true);
    expect(hasRole("ADMIN", "  ADMIN  " as Role)).toBe(true);
  });

  it("层级高的满足层级低的", () => {
    expect(hasRole("superadmin", "guest")).toBe(true);
    expect(hasRole("admin", "member")).toBe(true);
    expect(hasRole("member", "guest")).toBe(true);
    expect(hasRole("guest", "member")).toBe(false);
    expect(hasRole("admin", "superadmin")).toBe(false);
  });

  it("同层级自等", () => {
    for (const r of ["superadmin", "admin", "member", "guest"] as Role[]) {
      expect(hasRole(r, r), `${r} 应满足自身`).toBe(true);
    }
  });
});

describe("hasRole：未知角色 fail-closed", () => {
  it("当前角色未定义 → 拒绝（不得降级为层级 0 而放行）", () => {
    expect(hasRole("superuser", "guest")).toBe(false);
    expect(hasRole("root", "admin")).toBe(false);
    expect(hasRole("ADMINISTRATOR", "guest")).toBe(false);
    expect(hasRole("users", "member")).toBe(false);
  });

  it("所需角色未定义 → 拒绝", () => {
    expect(hasRole("owner", "superuser" as Role)).toBe(false);
    expect(hasRole("admin", "root" as Role)).toBe(false);
  });

  it("两侧都未定义 → 拒绝", () => {
    expect(hasRole("nope", "alsonope" as Role)).toBe(false);
  });

  it("空串与空白 → 拒绝", () => {
    expect(hasRole("", "guest")).toBe(false);
    expect(hasRole("   ", "guest")).toBe(false);
    expect(hasRole("admin", "" as Role)).toBe(false);
  });

  it("两侧都空 → 拒绝", () => {
    expect(hasRole("", "" as Role)).toBe(false);
    expect(hasRole("  ", "\t" as Role)).toBe(false);
  });

  it("原型链上的属性名不算已定义角色（防 hasOwnProperty 绕过）", () => {
    // 若用 `cur in ROLE_HIERARCHY` 而不是 Object.hasOwnOwn，
    // "toString" / "constructor" 会被当成角色
    expect(hasRole("toString", "guest")).toBe(false);
    expect(hasRole("constructor", "guest")).toBe(false);
    expect(hasRole("__proto__", "guest")).toBe(false);
    expect(hasRole("hasOwnProperty", "guest")).toBe(false);
    // 另一侧同样：所需角色是原型链上的名字时也必须拒绝
    expect(hasRole("admin", "toString" as Role)).toBe(false);
  });
});

describe("hasScope", () => {
  it("空格分隔的字符串", () => {
    expect(hasScope("openid email profile", "email")).toBe(true);
    expect(hasScope("openid email", "admin")).toBe(false);
  });

  it("数组形式", () => {
    expect(hasScope(["openid", "email"], "email")).toBe(true);
    expect(hasScope(["openid", "email"], "admin")).toBe(false);
  });

  it("大小写与多余空白不敏感", () => {
    expect(hasScope("  OPENID   Email  ", "email")).toBe(true);
    expect(hasScope(["  OpenID  "], "openid")).toBe(true);
  });

  it("通配符 * 授予全部", () => {
    expect(hasScope("*", "anything")).toBe(true);
    expect(hasScope("openid *", "anything")).toBe(true);
  });

  it("空值一律拒绝（fail-closed）", () => {
    expect(hasScope(undefined, "email")).toBe(false);
    expect(hasScope(null, "email")).toBe(false);
    expect(hasScope("", "email")).toBe(false);
    expect(hasScope([], "email")).toBe(false);
    expect(hasScope("   ", "email")).toBe(false);
  });

  it("不得把子串当成命中（避免 admin 匹配 admin:read）", () => {
    expect(hasScope("admin:write", "admin")).toBe(false);
  });
});

describe("isAdminRole", () => {
  it("识别各级管理员（中英文全部别名）", () => {
    for (const v of ["admin", "superadmin", "administrator", "administrators", "管理员", "超级管理员"]) {
      expect(isAdminRole(v), `${v} 应被识别为管理员`).toBe(true);
    }
  });

  it("不把普通成员当管理员", () => {
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole("guest")).toBe(false);
    expect(isAdminRole("admins")).toBe(false);
    expect(isAdminRole("super")).toBe(false);
  });

  it("空值与普通用户一律拒绝", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("")).toBe(false);
    expect(isAdminRole("   ")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("SuperAdmin")).toBe(true);
  });
});

describe("isUserInAdminList", () => {
  const list = ["admin@nuln.net", "ops@nuln.net"];

  it("精确命中", () => {
    expect(isUserInAdminList("admin@nuln.net", list)).toBe(true);
    expect(isUserInAdminList("ops@nuln.net", list)).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(isUserInAdminList("ADMIN@NULN.NET", list)).toBe(true);
  });

  it("未命中返回 false", () => {
    expect(isUserInAdminList("other@nuln.net", list)).toBe(false);
  });

  it("空用户 / 空名单 → false（fail-closed）", () => {
    expect(isUserInAdminList(null, list)).toBe(false);
    expect(isUserInAdminList("", list)).toBe(false);
    expect(isUserInAdminList(undefined, list)).toBe(false);
    expect(isUserInAdminList("admin@nuln.net", [])).toBe(false);
    // 第二参数省略时按默认空数组处理
    expect(isUserInAdminList("admin@nuln.net")).toBe(false);
  });

  it("名单项周围的空白应被忽略", () => {
    expect(isUserInAdminList("admin@nuln.net", ["  admin@nuln.net  "])).toBe(true);
  });
});

describe("computeEffectiveUserGroups", () => {
  it("显式组与默认组合并去重", () => {
    const g = computeEffectiveUserGroups(["a", "b"], ["b", "c"]);
    expect([...g].sort()).toEqual(["a", "b", "c"]);
  });

  it("超级管理员自动获得 admin 组", () => {
    expect(computeEffectiveUserGroups([], [], true)).toContain("admin");
    expect(computeEffectiveUserGroups([], [], false)).not.toContain("admin");
  });

  it("空白项被忽略（不得产生空串组名）", () => {
    const g = computeEffectiveUserGroups(["  a  ", "", "   ", "b"], ["", "  "]);
    expect(g).toEqual(["a", "b"]);
    expect(g.some((x) => x.trim() === "")).toBe(false);
  });

  it("无任何命中时返回空数组（不得返回 undefined/null）", () => {
    const g = computeEffectiveUserGroups([], []);
    expect(Array.isArray(g)).toBe(true);
    expect(g).toEqual([]);
  });

  it("第二参数省略时按默认空数组处理", () => {
    expect(computeEffectiveUserGroups(["a"])).toEqual(["a"]);
  });
});
