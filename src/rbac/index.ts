/**
 * @nuln/worker-kit/rbac
 *
 * 边缘 RBAC / ABAC 权限与角色判定引擎
 */

export type Role = "superadmin" | "admin" | "member" | "guest";

export const ROLE_HIERARCHY: Record<Role, number> = {
  superadmin: 100,
  admin: 50,
  member: 10,
  guest: 1,
};

/**
 * 判断当前角色是否满足目标所需角色要求（按层级关系）
 */
export function hasRole(currentRole: string | Role, requiredRole: Role): boolean {
  const cur = (currentRole || "").trim().toLowerCase() as Role;
  const curLevel = ROLE_HIERARCHY[cur] ?? 0;
  const reqLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return curLevel >= reqLevel;
}

/**
 * 校验 OAuth/OIDC Scope 是否包含目标权限
 * 支持空格分隔与数组格式，支持通配符 `*`
 */
export function hasScope(
  grantedScopes: string | string[] | undefined | null,
  requiredScope: string,
): boolean {
  if (!grantedScopes) return false;
  const list = Array.isArray(grantedScopes)
    ? grantedScopes
    : String(grantedScopes).split(/\s+/);
  const normalizedList = list.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const target = requiredScope.trim().toLowerCase();

  if (normalizedList.includes("*")) return true;
  if (normalizedList.includes(target)) return true;

  // 支持冒号前缀通配符，如 'mail:*' 匹配 'mail:send'
  if (target.includes(":")) {
    const prefix = target.split(":")[0];
    if (normalizedList.includes(`${prefix}:*`)) return true;
  }
  return false;
}

/**
 * 判定给定的分组或角色名称是否属于管理员范畴
 */
export function isAdminRole(roleOrGroupName: string | undefined | null): boolean {
  if (!roleOrGroupName) return false;
  const s = String(roleOrGroupName).trim().toLowerCase();
  return (
    s === "admin" ||
    s === "superadmin" ||
    s === "administrator" ||
    s === "administrators" ||
    s === "管理员" ||
    s === "超级管理员"
  );
}

/**
 * 判断邮箱是否在管理员名单中（大小写不敏感）
 */
export function isUserInAdminList(
  email: string | undefined | null,
  adminEmails: string[] = [],
): boolean {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;
  return adminEmails.some((e) => (e || "").trim().toLowerCase() === normalized);
}

/**
 * 计算用户最终有效分组列表（聚合显式分组、默认全局分组与超管自动注入）
 */
export function computeEffectiveUserGroups(
  explicitGroups: string[],
  defaultGroups: string[] = [],
  isSuperAdmin = false,
): string[] {
  const set = new Set<string>();
  for (const g of explicitGroups) {
    if (g && g.trim()) set.add(g.trim());
  }
  for (const g of defaultGroups) {
    if (g && g.trim()) set.add(g.trim());
  }
  if (isSuperAdmin) {
    set.add("admin");
  }
  return [...set];
}
