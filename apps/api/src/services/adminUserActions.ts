import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformAccounts, referrals, users } from "../db/schema.js";
import { applyCredit, applyDebit } from "./economy.js";
import { deleteUserAccount } from "./users.js";
import { nanoid } from "nanoid";

export async function adminDeleteUser(targetUserId: string): Promise<void> {
  await deleteUserAccount(targetUserId);
}

export async function adminUnlinkPlatform(
  targetUserId: string,
  platform: "twitch" | "kick"
): Promise<boolean> {
  const r = await db
    .delete(platformAccounts)
    .where(
      and(
        eq(platformAccounts.userId, targetUserId),
        eq(platformAccounts.platform, platform)
      )
    )
    .returning({ id: platformAccounts.id });
  return r.length > 0;
}

export async function adminAdjustBalance(params: {
  targetUserId: string;
  twitchDelta: number;
  kickDelta: number;
}): Promise<{ ok: true } | { ok: false; code: "no_change" | "insufficient" }> {
  const { targetUserId, twitchDelta, kickDelta } = params;
  if (twitchDelta === 0 && kickDelta === 0) {
    return { ok: false, code: "no_change" };
  }

  if (twitchDelta > 0) {
    await applyCredit({
      userId: targetUserId,
      amount: twitchDelta,
      idempotencyKey: `admin_bal:${targetUserId}:tw:${nanoid()}`,
      kind: "admin",
      platform: "twitch",
      referenceType: "admin_adjust",
      referenceId: targetUserId,
    });
  } else if (twitchDelta < 0) {
    const d = await applyDebit({
      userId: targetUserId,
      amount: -twitchDelta,
      idempotencyKey: `admin_bal:${targetUserId}:twd:${nanoid()}`,
      kind: "admin",
      platform: "twitch",
      referenceType: "admin_adjust",
      referenceId: targetUserId,
    });
    if (!d.ok) return { ok: false, code: "insufficient" };
  }

  if (kickDelta > 0) {
    await applyCredit({
      userId: targetUserId,
      amount: kickDelta,
      idempotencyKey: `admin_bal:${targetUserId}:ki:${nanoid()}`,
      kind: "admin",
      platform: "kick",
      referenceType: "admin_adjust",
      referenceId: targetUserId,
    });
  } else if (kickDelta < 0) {
    const d = await applyDebit({
      userId: targetUserId,
      amount: -kickDelta,
      idempotencyKey: `admin_bal:${targetUserId}:kid:${nanoid()}`,
      kind: "admin",
      platform: "kick",
      referenceType: "admin_adjust",
      referenceId: targetUserId,
    });
    if (!d.ok) return { ok: false, code: "insufficient" };
  }

  return { ok: true };
}

export async function adminListUserReferrals(userId: string): Promise<
  Array<{
    refereeId: string;
    username: string | null;
    firstName: string | null;
    telegramId: string | null;
    qualified: boolean;
    createdAt: string;
  }>
> {
  const rows = await db
    .select({
      refereeId: referrals.refereeId,
      qualifiedAt: referrals.qualifiedAt,
      createdAt: referrals.createdAt,
      username: users.username,
      firstName: users.firstName,
      telegramId: users.telegramId,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .where(eq(referrals.referrerId, userId))
    .orderBy(sql`${referrals.createdAt} desc`);

  return rows.map((r) => ({
    refereeId: r.refereeId,
    username: r.username,
    firstName: r.firstName,
    telegramId: r.telegramId != null ? String(r.telegramId) : null,
    qualified: r.qualifiedAt != null,
    createdAt: r.createdAt.toISOString(),
  }));
}
