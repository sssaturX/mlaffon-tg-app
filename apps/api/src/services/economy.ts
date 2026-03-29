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

export async function applyCredit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: CreditReason;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: true; newCoins: number } | { ok: false; reason: "duplicate" }> {
  const { userId, amount, idempotencyKey, kind, referenceType, referenceId, meta } =
    params;
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
      meta: meta ?? null,
    });

    await tx
      .update(userBalances)
      .set({
        coins: sql`${userBalances.coins} + ${amount}`,
        lifetimeEarned: sql`${userBalances.lifetimeEarned} + ${amount}`,
      })
      .where(eq(userBalances.userId, userId));

    const [row] = await tx
      .select({ coins: userBalances.coins })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);

    return { ok: true, newCoins: row?.coins ?? 0 };
  });
}

export async function applyDebit(params: {
  userId: string;
  amount: number;
  idempotencyKey: string;
  kind: string;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<
  | { ok: true; newCoins: number }
  | { ok: false; reason: "duplicate" | "insufficient" }
> {
  const { userId, amount, idempotencyKey, kind, referenceType, referenceId, meta } =
    params;
  if (amount <= 0) throw new Error("amount_must_be_positive");

  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return { ok: false, reason: "duplicate" };

    const [bal] = await tx
      .select({ coins: userBalances.coins })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);
    if (!bal || bal.coins < amount) return { ok: false, reason: "insufficient" };

    await tx.insert(transactions).values({
      userId,
      amount: -amount,
      kind,
      referenceType: referenceType ?? null,
      referenceId: referenceId ?? null,
      idempotencyKey,
      meta: meta ?? null,
    });

    await tx
      .update(userBalances)
      .set({
        coins: sql`${userBalances.coins} - ${amount}`,
      })
      .where(eq(userBalances.userId, userId));

    const [row] = await tx
      .select({ coins: userBalances.coins })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);

    return { ok: true, newCoins: row?.coins ?? 0 };
  });
}
