import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { transactions, userBalances, userInventory } from "../db/schema.js";
import { gameConfig } from "../config.js";
import { publishBalanceUpdate } from "./balanceEvents.js";

export type CreditReason =
  | "task_reward"
  | "referral_referrer"
  | "referral_referee"
  | "referral_weekly_l1"
  | "referral_weekly_l2"
  | "streak_bonus"
  | "fortune_wheel"
  | "admin"
  | "promo_code"
  | "drop_reward";

/** Куда зачислить / откуда списать монеты. */
export type EconomyPlatform = "twitch" | "kick";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function boostEligible(kind: CreditReason): boolean {
  return kind !== "admin";
}

/**
 * При наличии заряда в инвентаре (boost_x2) умножает сумму на множитель (не выше max из конфига),
 * списывает один заряд. Без заряда возвращает baseAmount.
 */
async function consumeBoostMultiply(
  tx: Tx,
  userId: string,
  baseAmount: number,
  eligible: boolean
): Promise<{
  finalAmount: number;
  boostApplied: boolean;
  multiplier: number;
}> {
  if (!eligible || baseAmount <= 0) {
    return { finalAmount: baseAmount, boostApplied: false, multiplier: 1 };
  }

  const itemId = gameConfig.boost.inventoryItemId;
  const maxM = gameConfig.boost.maxMultiplier;

  const [consumed] = await tx
    .update(userInventory)
    .set({
      quantity: sql`${userInventory.quantity} - 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(userInventory.userId, userId),
        eq(userInventory.itemId, itemId),
        sql`${userInventory.quantity} > 0`
      )
    )
    .returning({ id: userInventory.id });

  if (!consumed) {
    return { finalAmount: baseAmount, boostApplied: false, multiplier: 1 };
  }

  const mult = Math.min(maxM, 2);
  const finalAmount = Math.floor(baseAmount * mult);
  return {
    finalAmount,
    boostApplied: true,
    multiplier: mult,
  };
}

async function readBalances(tx: Tx, userId: string) {
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
    newCoins: row?.coins ?? 0,
    newTwitchCoins: row?.twitchCoins ?? 0,
    newKickCoins: row?.kickCoins ?? 0,
  };
}

async function insertCreditTx(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    idempotencyKey: string;
    kind: CreditReason;
    platform: EconomyPlatform;
    referenceType?: string;
    referenceId?: string;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
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
}

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
  | {
      ok: true;
      newCoins: number;
      newTwitchCoins: number;
      newKickCoins: number;
      creditedAmount: number;
    }
  | { ok: false; reason: "duplicate" }
> {
  const {
    userId,
    amount: baseAmount,
    idempotencyKey,
    kind,
    platform,
    referenceType,
    referenceId,
    meta,
  } = params;
  if (baseAmount <= 0) throw new Error("amount_must_be_positive");

  const result = await db.transaction(async (tx): Promise<
    | {
        ok: true;
        newCoins: number;
        newTwitchCoins: number;
        newKickCoins: number;
        creditedAmount: number;
      }
    | { ok: false; reason: "duplicate" }
  > => {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return { ok: false, reason: "duplicate" };

    const { finalAmount, boostApplied, multiplier } = await consumeBoostMultiply(
      tx,
      userId,
      baseAmount,
      boostEligible(kind)
    );
    if (finalAmount <= 0) throw new Error("amount_must_be_positive");

    const metaOut = {
      ...(meta ?? {}),
      rewardBeforeBoost: baseAmount,
      boostMultiplier: boostApplied ? multiplier : 1,
      boostApplied,
    };

    await insertCreditTx(tx, {
      userId,
      amount: finalAmount,
      idempotencyKey,
      kind,
      platform,
      referenceType,
      referenceId,
      meta: metaOut,
    });

    const balances = await readBalances(tx, userId);
    return {
      ok: true,
      ...balances,
      creditedAmount: finalAmount,
    };
  });
  if (result.ok) void publishBalanceUpdate(userId);
  return result;
}

/** Награды без привязки к платформе — делим 50/50 между Twitch и Kick. Один заряд буста на всю сумму. */
export async function applyCreditSplit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: CreditReason;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<
  | {
      ok: true;
      newCoins: number;
      newTwitchCoins: number;
      newKickCoins: number;
      creditedAmount: number;
    }
  | { ok: false; reason: "duplicate" }
> {
  const {
    userId,
    amount: baseAmount,
    idempotencyKey,
    kind,
    referenceType,
    referenceId,
    meta,
  } = params;
  if (baseAmount <= 0) throw new Error("amount_must_be_positive");

  const keyTw = `${idempotencyKey}:tw`;
  const keyKick = `${idempotencyKey}:kick`;

  const result = await db.transaction(async (tx): Promise<
    | {
        ok: true;
        newCoins: number;
        newTwitchCoins: number;
        newKickCoins: number;
        creditedAmount: number;
      }
    | { ok: false; reason: "duplicate" }
  > => {
    const [dupTw] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, keyTw))
      .limit(1);
    const [dupKick] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, keyKick))
      .limit(1);
    if (dupTw || dupKick) return { ok: false, reason: "duplicate" };

    const { finalAmount, boostApplied, multiplier } = await consumeBoostMultiply(
      tx,
      userId,
      baseAmount,
      boostEligible(kind)
    );
    if (finalAmount <= 0) throw new Error("amount_must_be_positive");

    const metaOut = {
      ...(meta ?? {}),
      rewardBeforeBoost: baseAmount,
      boostMultiplier: boostApplied ? multiplier : 1,
      boostApplied,
    };

    const half = Math.floor(finalAmount / 2);
    const rest = finalAmount - half;

    await insertCreditTx(tx, {
      userId,
      amount: half,
      idempotencyKey: keyTw,
      kind,
      platform: "twitch",
      referenceType,
      referenceId,
      meta: metaOut,
    });
    await insertCreditTx(tx, {
      userId,
      amount: rest,
      idempotencyKey: keyKick,
      kind,
      platform: "kick",
      referenceType,
      referenceId,
      meta: metaOut,
    });

    const balances = await readBalances(tx, userId);
    return {
      ok: true,
      ...balances,
      creditedAmount: finalAmount,
    };
  });
  if (result.ok) void publishBalanceUpdate(userId);
  return result;
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

  const result = await db.transaction(async (tx): Promise<
    | { ok: true; newCoins: number; newTwitchCoins: number; newKickCoins: number }
    | { ok: false; reason: "duplicate" | "insufficient" }
  > => {
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

    const b = await readBalances(tx, userId);
    return { ok: true, ...b };
  });
  if (result.ok) void publishBalanceUpdate(userId);
  return result;
}
