import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { banAppeals, users } from "../db/schema.js";

export async function hasPendingBanAppeal(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: banAppeals.id })
    .from(banAppeals)
    .where(and(eq(banAppeals.userId, userId), eq(banAppeals.status, "pending")))
    .limit(1);
  return Boolean(row);
}

export async function createBanAppeal(
  userId: string,
  message: string
): Promise<
  | { ok: true }
  | { ok: false; code: "not_banned" | "already_pending" | "too_short" }
> {
  const text = message.trim();
  if (text.length < 10) return { ok: false, code: "too_short" };

  const [u] = await db
    .select({ banned: users.banned })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.banned) return { ok: false, code: "not_banned" };

  const pending = await hasPendingBanAppeal(userId);
  if (pending) return { ok: false, code: "already_pending" };

  await db.insert(banAppeals).values({
    userId,
    message: text,
    status: "pending",
  });
  return { ok: true };
}

export type BanAppealAdminRow = {
  id: string;
  userId: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  message: string;
  status: string;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export async function listBanAppealsAdmin(): Promise<BanAppealAdminRow[]> {
  const rows = await db
    .select({
      id: banAppeals.id,
      userId: banAppeals.userId,
      message: banAppeals.message,
      status: banAppeals.status,
      adminNote: banAppeals.adminNote,
      reviewedAt: banAppeals.reviewedAt,
      createdAt: banAppeals.createdAt,
      telegramId: users.telegramId,
      username: users.username,
      firstName: users.firstName,
    })
    .from(banAppeals)
    .innerJoin(users, eq(banAppeals.userId, users.id))
    .orderBy(desc(banAppeals.createdAt));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    telegramId: String(r.telegramId),
    username: r.username,
    firstName: r.firstName,
    message: r.message,
    status: r.status,
    adminNote: r.adminNote ?? null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function markBanAppealReviewed(
  appealId: string,
  adminNote: string | null
): Promise<boolean> {
  const [u] = await db
    .update(banAppeals)
    .set({
      status: "reviewed",
      adminNote: adminNote?.trim() ? adminNote.trim() : null,
      reviewedAt: new Date(),
    })
    .where(and(eq(banAppeals.id, appealId), eq(banAppeals.status, "pending")))
    .returning({ id: banAppeals.id });
  return Boolean(u);
}
