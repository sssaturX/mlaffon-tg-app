import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { referrals, userBalances } from "../db/schema.js";
import { applyCreditSplit } from "./economy.js";
import { gameConfig } from "../config.js";

export async function maybeQualifyReferral(refereeUserId: string): Promise<void> {
  const [ref] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.refereeId, refereeUserId))
    .limit(1);
  if (!ref || ref.qualifiedAt) return;

  const { qualifyMinLifetimeEarned, referrerReward } = gameConfig.referral;

  const [b] = await db
    .select({ le: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, refereeUserId))
    .limit(1);

  const le = b?.le ?? 0;
  if (le < qualifyMinLifetimeEarned) return;

  await db
    .update(referrals)
    .set({ qualifiedAt: sql`now()` })
    .where(eq(referrals.id, ref.id));

  if (referrerReward <= 0) return;

  const idem = `referral_referrer_qualified:${ref.id}`;
  await applyCreditSplit({
    userId: ref.referrerId,
    amount: referrerReward,
    idempotencyKey: idem,
    kind: "referral_referrer",
    referenceType: "referral",
    referenceId: ref.id,
  });
}
