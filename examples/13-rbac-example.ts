/**
 * Example 13: RBAC 角色层级与授权范围
 *
 * 演示：
 * 1. `@nuln/worker-kit/rbac` 提供的角色层级（superadmin > admin > member > guest）
 * 2. 角色继承判定 `hasRole`
 * 3. OAuth/OIDC Scope 校验 `hasScope`
 * 4. 在路由处理器中拦截越权请求
 *
 * ## 关于 fail-closed
 *
 * `hasRole` 对**未定义角色一律返回 false**（`adminstrator` 这类笔误不会被
 * 静默当成"层级 0"从而放行任何角色）。传入的角色必须是 {@link Role} 的取值。
 */

import {
  hasRole,
  hasScope,
  isAdminRole,
  computeEffectiveUserGroups,
  ROLE_HIERARCHY,
  type Role,
} from "@nuln/worker-kit";

/** 判定当前角色是否满足所需角色要求。 */
export function verifyUserAccess(userRole: Role, requiredRole: Role): boolean {
  console.log("=== [Example 13] RBAC 角色层级 ===");
  console.log("角色层级:", JSON.stringify(ROLE_HIERARCHY));

  const allowed = hasRole(userRole, requiredRole);
  console.log(`角色 '${userRole}' 是否满足 '${requiredRole}': ${allowed}`);

  return allowed;
}

/** 未知角色一律拒绝（fail-closed）。 */
export function verifyUnknownRoleRejected(userRole: string, requiredRole: string): boolean {
  // 运行时传入未定义角色时，返回 false 而不是放行
  const allowed = hasRole(userRole as Role, requiredRole as Role);
  console.log(`未定义角色 '${userRole}' → '${requiredRole}': ${allowed}（应为 false）`);
  return allowed;
}

/** OAuth/OIDC Scope 校验（支持空格分隔、数组与 `*` 通配）。 */
export function verifyScope(rawScope: string, required: string): boolean {
  const allowed = hasScope(rawScope, required);
  console.log(`scope '${rawScope}' 含 '${required}': ${allowed}`);
  return allowed;
}

/**
 * 路由守卫：越权返回 403。
 *
 * 注意 403 响应遵循 AGENTS §7.1 的统一契约 `{ ok:false, error, code }`。
 */
export function requireRole(userRole: Role, requiredRole: Role): Response | null {
  if (hasRole(userRole, requiredRole)) return null;
  return new Response(
    JSON.stringify({
      ok: false,
      error: "insufficient_role",
      code: "FORBIDDEN",
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
}

/** 组合判定：admin 角色 + 生效用户组。 */
export function summarizeUser(
  userRole: string,
  explicitGroups: string[],
  defaultGroups: string[] = [],
  isSuperAdmin = false,
): void {
  console.log("=== [Example 13] 组合判定 ===");
  console.log("是否 admin 角色:", isAdminRole(userRole));
  const groups = computeEffectiveUserGroups(explicitGroups, defaultGroups, isSuperAdmin);
  console.log("生效用户组:", JSON.stringify(groups));
}
