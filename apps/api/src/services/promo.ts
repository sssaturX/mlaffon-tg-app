import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { promoCodes, promoRedemptions } from "../db/schema.js";
import { applyCredit, applyCreditSplit } from "./economy.js";
export async function applyPromoForUser(
  userId: string,
  rawCode: string
): Promise<{ ok: true; reward: number } | { ok: false; error: string }> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "empty_code" };

  const reserved = await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(promoCodes)
      .where(and(eq(promoCodes.code, code), eq(promoCodes.active, true)))
      .for("update")
      .limit(1);

    if (!p) return { ok: false as const, error: "not_found" as const };

    if (p.maxUses > 0 && p.usesCount >= p.maxUses) {
      return { ok: false as const, error: "exhausted" as const };
    }

    const [existing] = await tx
      .select({ id: promoRedemptions.id })
      .from(promoRedemptions)
      .where(
        and(
          eq(promoRedemptions.userId, userId),
          eq(promoRedemptions.promoId, p.id)
        )
      )
      .limit(1);
    if (existing) return { ok: false as const, error: "already_used" as const };

    try {
      await tx.insert(promoRedemptions).values({
        userId,
        promoId: p.id,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return { ok: false as const, error: "already_used" as const };
      }
      throw e;
    }

    await tx
      .update(promoCodes)
      .set({ usesCount: sql`${promoCodes.usesCount} + 1` })
      .where(eq(promoCodes.id, p.id));

    return { ok: true as const, promo: p };
  });

  if (!reserved.ok) {
    return { ok: false, error: reserved.error };
  }

  const p = reserved.promo;
  const idemKey = `promo:${userId}:${p.id}`;
  const refId = String(p.id);
  const platform = p.creditPlatform;

  if (p.rewardCoins <= 0) {
    return { ok: true, reward: 0 };
  }

  const credit =
    platform === "twitch" || platform === "kick"
      ? await applyCredit({
          userId,
          amount: p.rewardCoins,
          idempotencyKey: idemKey,
          kind: "promo_code",
          platform,
          referenceType: "promo",
          referenceId: refId,
        })
      : await applyCreditSplit({
          userId,
          amount: p.rewardCoins,
          idempotencyKey: idemKey,
          kind: "promo_code",
          referenceType: "promo",
          referenceId: refId,
        });

  if (!credit.ok) {
    await db.transaction(async (tx) => {
      await tx
        .delete(promoRedemptions)
        .where(
          and(
            eq(promoRedemptions.userId, userId),
            eq(promoRedemptions.promoId, p.id)
          )
        );
      await tx
        .update(promoCodes)
        .set({ usesCount: sql`${promoCodes.usesCount} - 1` })
        .where(eq(promoCodes.id, p.id));
    });
    return {
      ok: false,
      error: credit.reason === "duplicate" ? "duplicate" : "credit_failed",
    };
  }

  return { ok: true, reward: credit.creditedAmount };
}
