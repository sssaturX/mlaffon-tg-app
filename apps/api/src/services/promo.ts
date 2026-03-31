import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { promoCodes, promoRedemptions } from "../db/schema.js";
import { applyCredit, applyCreditSplit } from "./economy.js";

export async function applyPromoForUser(
  userId: string,
  rawCode: string
): Promise<
  { ok: true; reward: number } | { ok: false; error: string }
> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "empty_code" };

  const [p] = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.code, code), eq(promoCodes.active, true)))
    .limit(1);
  if (!p) return { ok: false, error: "not_found" };

  if (p.maxUses > 0 && p.usesCount >= p.maxUses) {
    return { ok: false, error: "exhausted" };
  }

  const [existing] = await db
    .select({ id: promoRedemptions.id })
    .from(promoRedemptions)
    .where(
      and(
        eq(promoRedemptions.userId, userId),
        eq(promoRedemptions.promoId, p.id)
      )
    )
    .limit(1);
  if (existing) return { ok: false, error: "already_used" };

  const idem = `promo:${userId}:${p.id}`;
  const refId = String(p.id);
  const platform = p.creditPlatform;

  let credited = 0;
  if (p.rewardCoins > 0) {
    const credit =
      platform === "twitch" || platform === "kick"
        ? await applyCredit({
            userId,
            amount: p.rewardCoins,
            idempotencyKey: idem,
            kind: "promo_code",
            platform,
            referenceType: "promo",
            referenceId: refId,
          })
        : await applyCreditSplit({
            userId,
            amount: p.rewardCoins,
            idempotencyKey: idem,
            kind: "promo_code",
            referenceType: "promo",
            referenceId: refId,
          });
    if (!credit.ok) {
      return { ok: false, error: "duplicate" };
    }
    credited = credit.creditedAmount;
  }

  await db.insert(promoRedemptions).values({
    userId,
    promoId: p.id,
  });

  await db
    .update(promoCodes)
    .set({ usesCount: sql`${promoCodes.usesCount} + 1` })
    .where(eq(promoCodes.id, p.id));

  return { ok: true, reward: credited };
}
