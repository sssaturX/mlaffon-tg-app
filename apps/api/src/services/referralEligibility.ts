import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { referrals } from "../db/schema.js";

/** После OAuth Twitch/Kick — реферал участвует в недельных %. */
export async function markReferralPercentEligible(refereeUserId: string): Promise<void> {
  await db
    .update(referrals)
    .set({
      eligibleForPercentAt: sql`coalesce(${referrals.eligibleForPercentAt}, now())`,
    })
    .where(eq(referrals.refereeId, refereeUserId));
}
