import { desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { adminAuditLog } from "../db/schema.js";

export async function logAdminAction(params: {
  adminEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown> | null;
  ip?: string | null;
  role?: string | null;
  requestId?: string | null;
  success?: boolean;
}): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      adminEmail: params.adminEmail,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      payload: params.payload ?? null,
      ip: params.ip ?? null,
      role: params.role ?? null,
      requestId: params.requestId ?? null,
      success: params.success ?? true,
    });
  } catch {
    /* audit log failure must not break the main operation */
  }
}

export async function listAuditLog(params: {
  limit?: number;
  offset?: number;
}): Promise<{ items: unknown[]; total: number }> {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditLog);
  const items = await db
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit)
    .offset(offset);
  return { items, total };
}
