import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions, userBalances } from "../db/schema.js";

export type CreditReason =
  | "task_reward"
  | "referral_referrer"
  | "referral_referee"
  | "streak_bonus"
  | "fortune_wheel"
  | "admin";

/** Куда зачислить / откуда списать монеты. */
export type EconomyPlatform = "twitch" | "kick";

export async function applyCredit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: CreditReason;
  platform: EconomyPlatform;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { ok: true; newCoins: number; newTwitchCoins: number; newKickCoins: number }
  | { ok: false; reason: "duplicate" }
> {
  const {
    userId,
    amount,
    idempotencyKey,
    kind,
    platform,
    referenceType,
    referenceId,
    meta,
  } = params;
  if (amount <= 0) throw new Error("amount_must_be_positive");

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return { ok: false, reason: "duplicate" };

    await tx.insert(transactions).values({
      userId,
      amount,
      kind,
      referenceType: referenceType ?? null,
      referenceId: referenceId ?? null,
      idempotencyKey,
      meta: { ...(meta ?? {}), platform },
    });

    if (platform === "twitch") {
      await tx
        .update(userBalances)
        .set({
          twitchCoins: sql`${userBalances.twitchCoins} + ${amount}`,
          twitchLifetimeEarned: sql`${userBalances.twitchLifetimeEarned} + ${amount}`,
          coins: sql`${userBalances.coins} + ${amount}`,
          lifetimeEarned: sql`${userBalances.lifetimeEarned} + ${amount}`,
        })
        .where(eq(userBalances.userId, userId));
    } else {
      await tx
        .update(userBalances)
        .set({
          kickCoins: sql`${userBalances.kickCoins} + ${amount}`,
          kickLifetimeEarned: sql`${userBalances.kickLifetimeEarned} + ${amount}`,
          coins: sql`${userBalances.coins} + ${amount}`,
          lifetimeEarned: sql`${userBalances.lifetimeEarned} + ${amount}`,
        })
        .where(eq(userBalances.userId, userId));
    }

    const [row] = await tx
      .select({
        coins: userBalances.coins,
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);

    return {
      ok: true,
      newCoins: row?.coins ?? 0,
      newTwitchCoins: row?.twitchCoins ?? 0,
      newKickCoins: row?.kickCoins ?? 0,
    };
  });
}

/** Награды без привязки к платформе — делим 50/50 между Twitch и Kick. */
export async function applyCreditSplit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: CreditReason;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { ok: true; newCoins: number; newTwitchCoins: number; newKickCoins: number }
  | { ok: false; reason: "duplicate" }
> {
  const { amount, idempotencyKey } = params;
  if (amount <= 0) throw new Error("amount_must_be_positive");
  const half = Math.floor(amount / 2);
  const rest = amount - half;
  const a = await applyCredit({
    ...params,
    amount: half,
    platform: "twitch",
    idempotencyKey: `${idempotencyKey}:tw`,
  });
  if (!a.ok) return a;
  const b = await applyCredit({
    ...params,
    amount: rest,
    platform: "kick",
    idempotencyKey: `${idempotencyKey}:kick`,
  });
  if (!b.ok) return b;
  return {
    ok: true,
    newCoins: b.newCoins,
    newTwitchCoins: b.newTwitchCoins,
    newKickCoins: b.newKickCoins,
  };
}

export async function applyDebit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: string;
  platform: EconomyPlatform;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { ok: true; newCoins: number; newTwitchCoins: number; newKickCoins: number }
  | { ok: false; reason: "duplicate" | "insufficient" }
> {
  const {
    userId,
    amount,
    idempotencyKey,
    kind,
    platform,
    referenceType,
    referenceId,
    meta,
  } = params;
  if (amount <= 0) throw new Error("amount_must_be_positive");

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return { ok: false, reason: "duplicate" };

    const [bal] = await tx
      .select({
        coins: userBalances.coins,
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);
    const platformBal =
      platform === "twitch" ? bal?.twitchCoins : bal?.kickCoins;
    if (!bal || (platformBal ?? 0) < amount)
      return { ok: false, reason: "insufficient" };

    await tx.insert(transactions).values({
      userId,
      amount: -amount,
      kind,
      referenceType: referenceType ?? null,
      referenceId: referenceId ?? null,
      idempotencyKey,
      meta: { ...(meta ?? {}), platform },
    });

    if (platform === "twitch") {
      await tx
        .update(userBalances)
        .set({
          twitchCoins: sql`${userBalances.twitchCoins} - ${amount}`,
          coins: sql`${userBalances.coins} - ${amount}`,
        })
        .where(eq(userBalances.userId, userId));
    } else {
      await tx
        .update(userBalances)
        .set({
          kickCoins: sql`${userBalances.kickCoins} - ${amount}`,
          coins: sql`${userBalances.coins} - ${amount}`,
        })
        .where(eq(userBalances.userId, userId));
    }

    const [row] = await tx
      .select({
        coins: userBalances.coins,
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);

    return {
      ok: true,
      newCoins: row?.coins ?? 0,
      newTwitchCoins: row?.twitchCoins ?? 0,
      newKickCoins: row?.kickCoins ?? 0,
    };
  });
}
