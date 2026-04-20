import type { AdminRole } from "../db/schema.js";

/**
 * RBAC permission matrix.
 *
 * super_admin: full access
 * moderator: read + moderation (review evidence, manage giveaways, view users)
 * viewer: read-only access to dashboards and lists
 */
const PERMISSIONS: Record<string, AdminRole[]> = {
  // Read operations — all roles
  "read:users": ["super_admin", "moderator", "viewer"],
  "read:giveaways": ["super_admin", "moderator", "viewer"],
  "read:promos": ["super_admin", "moderator", "viewer"],
  "read:tasks": ["super_admin", "moderator", "viewer"],
  "read:evidence": ["super_admin", "moderator", "viewer"],
  "read:predictions": ["super_admin", "moderator", "viewer"],
  "read:shop": ["super_admin", "moderator", "viewer"],
  "read:drops": ["super_admin", "moderator", "viewer"],
  "read:appeals": ["super_admin", "moderator", "viewer"],
  "read:audit": ["super_admin", "moderator", "viewer"],
  "read:settings": ["super_admin", "moderator", "viewer"],

  // Moderation — moderator + super_admin
  "mod:review_evidence": ["super_admin", "moderator"],
  "mod:review_appeal": ["super_admin", "moderator"],
  "mod:ban_user": ["super_admin", "moderator"],
  "mod:manage_giveaways": ["super_admin", "moderator"],
  "mod:manage_promos": ["super_admin", "moderator"],
  "mod:manage_tasks": ["super_admin", "moderator"],
  "mod:manage_drops": ["super_admin", "moderator"],
  "mod:manage_live": ["super_admin", "moderator"],
  "mod:manage_predictions": ["super_admin", "moderator"],

  // Destructive / financial — super_admin only
  "admin:delete_user": ["super_admin"],
  "admin:adjust_balance": ["super_admin"],
  "admin:resolve_prediction": ["super_admin"],
  "admin:draw_giveaway": ["super_admin"],
  "admin:merge_users": ["super_admin"],
  "admin:manage_shop": ["super_admin"],
  "admin:manage_settings": ["super_admin"],
  "admin:manage_admins": ["super_admin"],
  "admin:upload_media": ["super_admin", "moderator"],
};

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: AdminRole, perm: string): boolean {
  const allowed = PERMISSIONS[perm];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function getPermissionsForRole(role: AdminRole): string[] {
  return Object.entries(PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([perm]) => perm);
}
