import { and, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { referrals, transactions, users } from "../db/schema.js";
import { applyCreditSplit } from "./economy.js";
import { gameConfig } from "../config.js";

const EXCLUDED_FROM_WEEKLY_BASE = [
  "referral_referrer",
  "referral_referee",
  "referral_weekly_l1",
  "referral_weekly_l2",
  "promo_code",
  "drop_reward",
  "admin",
] as const;

export function getLastCompletedWeekUtc(): { start: Date; endExclusive: Date; weekKey: string } {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  const thisMonday = d;
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  return {
    start: lastMonday,
    endExclusive: thisMonday,
    weekKey: lastMonday.toISOString().slice(0, 10),
  };
}

/**
 * Weekly referral payout — batch-optimized version.
 * Pre-loads all referral relationships and user data in bulk to avoid N+1.
 */
export async function runWeeklyReferralPayout(): Promise<{
  weekKey: string;
  payouts: number;
}> {
  const { start, endExclusive, weekKey } = getLastCompletedWeekUtc();
  const { weeklyPercentL1, weeklyPercentL2 } = gameConfig.referral;

  const sums = await db
    .select({
      userId: transactions.userId,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.createdAt, start),
        lt(transactions.createdAt, endExclusive),
        sql`${transactions.amount} > 0`,
        notInArray(transactions.kind, [...EXCLUDED_FROM_WEEKLY_BASE])
      )
    )
    .groupBy(transactions.userId);

  if (sums.length === 0) return { weekKey, payouts: 0 };

  const userIds = sums.filter((s) => (s.total ?? 0) > 0).map((s) => s.userId);
  if (userIds.length === 0) return { weekKey, payouts: 0 };

  const refs = await db
    .select()
    .from(referrals)
    .where(inArray(referrals.refereeId, userIds));
  const refByReferee = new Map(refs.map((r) => [r.refereeId, r]));

  const eligibleReferrerIds = refs
    .filter((r) => r.eligibleForPercentAt != null)
    .map((r) => r.referrerId);

  const uniqueReferrerIds = [...new Set(eligibleReferrerIds)];
  const referrerUsers =
    uniqueReferrerIds.length > 0
      ? await db
          .select({ id: users.id, referredById: users.referredById })
          .from(users)
          .where(inArray(users.id, uniqueReferrerIds))
      : [];
  const referrerById = new Map(referrerUsers.map((u) => [u.id, u]));

  let payouts = 0;

  for (const row of sums) {
    const weeklySum = row.total ?? 0;
    if (weeklySum <= 0) continue;

    const ref = refByReferee.get(row.userId);
    if (!ref?.eligibleForPercentAt) continue;

    const l1 = Math.floor(weeklySum * weeklyPercentL1);
    if (l1 > 0) {
      const idem = `referral_weekly_l1:${weekKey}:${row.userId}`;
      const r = await applyCreditSplit({
        userId: ref.referrerId,
        amount: l1,
        idempotencyKey: idem,
        kind: "referral_weekly_l1",
        referenceType: "referee",
        referenceId: row.userId,
        meta: { weekKey, weeklySum },
      });
      if (r.ok) payouts += 1;
    }

    const l2Amount = Math.floor(weeklySum * weeklyPercentL2);
    if (l2Amount <= 0) continue;

    const referrerUser = referrerById.get(ref.referrerId);
    const grandReferrerId = referrerUser?.referredById ?? null;
    if (!grandReferrerId) continue;

    const idem2 = `referral_weekly_l2:${weekKey}:${row.userId}`;
    const r2 = await applyCreditSplit({
      userId: grandReferrerId,
      amount: l2Amount,
      idempotencyKey: idem2,
      kind: "referral_weekly_l2",
      referenceType: "referee",
      referenceId: row.userId,
      meta: { weekKey, weeklySum },
    });
    if (r2.ok) payouts += 1;
  }

  return { weekKey, payouts };
}
