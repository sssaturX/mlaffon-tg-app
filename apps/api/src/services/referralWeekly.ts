import { and, eq, gte, lt, notInArray, sql } from "drizzle-orm";
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

/** Прошлая полная неделя UTC: с понедельника 00:00 до воскресенья (конец исключительно). */
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
 * Начисление % реферерам за прошлую неделю (запуск по cron в понедельник).
 * L1: 2% от суммы положительных начислений реферала (без реф- и промо-транзакций).
 * L2: 0.5% — реферер реферера (дед по цепочке приглашения).
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

  let payouts = 0;

  for (const row of sums) {
    const weeklySum = row.total ?? 0;
    if (weeklySum <= 0) continue;

    const [ref] = await db
      .select()
      .from(referrals)
      .where(eq(referrals.refereeId, row.userId))
      .limit(1);
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

    const [directReferrer] = await db
      .select({ referredById: users.referredById })
      .from(users)
      .where(eq(users.id, ref.referrerId))
      .limit(1);
    const grandReferrerId = directReferrer?.referredById ?? null;
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
