import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { platformAccounts, referrals, userBalances } from "../db/schema.js";
import { applyCreditSplit } from "./economy.js";
import { gameConfig } from "../config.js";

export async function maybeQualifyReferral(refereeUserId: string): Promise<void> {
  const [ref] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.refereeId, refereeUserId))
    .limit(1);
  if (!ref || ref.qualifiedAt) return;

  const [pa] = await db
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(eq(platformAccounts.userId, refereeUserId))
    .limit(1);
  if (!pa) return;

  const { qualifyMinLifetimeEarned, referrerReward } = gameConfig.referral;

  const [b] = await db
    .select({ le: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, refereeUserId))
    .limit(1);

  const le = b?.le ?? 0;
  if (le < qualifyMinLifetimeEarned) return;

  await qualifyReferralInternal(ref.id, ref.referrerId, referrerReward);
}

/**
 * Квалификация реферала: привязана минимум одна платформа (Twitch/Kick) и
 * набран порог lifetime по конфигу (ЭКОНОМИКА: ~1k поинтов).
 */
export async function qualifyReferralOnPlatformLink(refereeUserId: string): Promise<void> {
  const [ref] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.refereeId, refereeUserId))
    .limit(1);
  if (!ref || ref.qualifiedAt) return;

  const [pa] = await db
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(eq(platformAccounts.userId, refereeUserId))
    .limit(1);
  if (!pa) return;

  const { qualifyMinLifetimeEarned, referrerReward } = gameConfig.referral;
  const [b] = await db
    .select({ le: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, refereeUserId))
    .limit(1);
  const le = b?.le ?? 0;
  if (le < qualifyMinLifetimeEarned) return;

  await qualifyReferralInternal(ref.id, ref.referrerId, referrerReward);
}

async function qualifyReferralInternal(
  referralId: string,
  referrerId: string,
  referrerReward: number,
): Promise<void> {
  await db
    .update(referrals)
    .set({ qualifiedAt: sql`now()` })
    .where(eq(referrals.id, referralId));

  if (referrerReward <= 0) return;

  const idem = `referral_referrer_qualified:${referralId}`;
  await applyCreditSplit({
    userId: referrerId,
    amount: referrerReward,
    idempotencyKey: idem,
    kind: "referral_referrer",
    referenceType: "referral",
    referenceId: referralId,
  });
}
