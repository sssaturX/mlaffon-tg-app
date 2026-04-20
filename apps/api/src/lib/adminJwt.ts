import jwt from "jsonwebtoken";
import type { AdminRole } from "../db/schema.js";

function secret(): string {
  const s =
    process.env.ADMIN_JWT_SECRET ??
    process.env.JWT_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "dev-admin-secret");
  if (!s) throw new Error("ADMIN_JWT_SECRET or JWT_SECRET required for admin");
  return s;
}

export interface AdminTokenPayload {
  email: string;
  role: AdminRole;
  adminId: string;
}

export function signAdminToken(
  email: string,
  role: AdminRole,
  adminId: string
): string {
  return jwt.sign({ sub: email, role, adminId }, secret(), {
    expiresIn: "8h",
  });
}

export function verifyAdminToken(token: string): AdminTokenPayload {
  const p = jwt.verify(token, secret()) as {
    sub: string;
    role?: string;
    adminId?: string;
  };
  const validRoles: AdminRole[] = ["super_admin", "moderator", "viewer"];
  const role = (p.role ?? "viewer") as AdminRole;
  if (!validRoles.includes(role)) throw new Error("invalid_role");
  return {
    email: p.sub,
    role,
    adminId: p.adminId ?? "",
  };
}
