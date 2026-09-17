/**
 * Example 13: RBAC Role & Permission Matrix
 *
 * Demonstrates:
 * 1. Defining hierarchical roles: superadmin > admin > operator > viewer
 * 2. Evaluating permission matrices and role inheritance
 * 3. Intercepting unauthorized requests in route handlers
 */

import {
  hasPermission,
  canAccessRole,
  ROLES,
  type Role,
  type Permission,
} from "@nuln/worker-kit";

export function verifyUserAccess(userRole: Role, requiredPermission: Permission) {
  console.log("=== [Example 13] RBAC Permission Matrix ===");

  const allowed = hasPermission(userRole, requiredPermission);
  console.log(`Role '${userRole}' has permission '${requiredPermission}': ${allowed}`);

  const canManageAdmin = canAccessRole(userRole, "admin");
  console.log(`Role '${userRole}' can manage 'admin' role: ${canManageAdmin}`);

  return allowed;
}
