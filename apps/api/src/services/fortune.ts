import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  fortuneSpins,
  userBalances,
  userInventory,
} from "../db/schema.js";
import { gameConfig } from "../config.js";
import {
  applyCredit,
  applyDebit,
  type EconomyPlatform,
} from "./economy.js";
import { utcDateString } from "./streak.js";

function pickOutcome(): (typeof gameConfig.fortune.outcomes)[number] {
  const items = gameConfig.fortune.outcomes;
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const o of items) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return items[items.length - 1]!;
}

export async function getFortuneStatus(userId: string): Promise<{
  utcDate: string;
  freeAvailable: boolean;
  paidSpinCost: number;
}> {
  const day = utcDateString();
  const [row] = await db
    .select()
    .from(fortuneSpins)
    .where(
      and(eq(fortuneSpins.userId, userId), eq(fortuneSpins.utcDate, day))
    )
    .limit(1);
  return {
    utcDate: day,
    freeAvailable: !row?.freeUsed,
    paidSpinCost: gameConfig.fortune.paidSpinCost,
  };
}

export async function spinFortuneWheel(
  userId: string,
  mode: "free" | "paid",
  platform: EconomyPlatform
): Promise<
  | {
      ok: true;
      outcome: "coins" | "boost" | "nothing";
      amount?: number;
      coins: number;
    }
  | { ok: false; error: string }
> {
  const day = utcDateString();
  const [row] = await db
    .select()
    .from(fortuneSpins)
    .where(
      and(eq(fortuneSpins.userId, userId), eq(fortuneSpins.utcDate, day))
    )
    .limit(1);

  if (mode === "free") {
    if (row?.freeUsed) return { ok: false, error: "free_spin_used" };
  } else {
    const cost = gameConfig.fortune.paidSpinCost;
    const debit = await applyDebit({
      userId,
      amount: cost,
      platform,
      idempotencyKey: `fortune_paid:${userId}:${day}:${nanoid()}`,
      kind: "fortune_paid",
      referenceType: "fortune",
      referenceId: day,
    });
    if (!debit.ok) {
      if (debit.reason === "insufficient")
        return { ok: false, error: "insufficient_coins" };
      return { ok: false, error: "duplicate_spin" };
    }
  }

  const outcome = pickOutcome();
  let coinsDelta = 0;
  if (outcome.type === "coins") coinsDelta = outcome.value ?? 0;

  if (coinsDelta > 0) {
    const credit = await applyCredit({
      userId,
      amount: coinsDelta,
      platform,
      idempotencyKey: `fortune_win:${userId}:${day}:${mode}:${nanoid()}`,
      kind: "fortune_wheel",
      referenceType: "fortune",
      referenceId: day,
      meta: { mode, outcome: outcome.type },
    });
    if (!credit.ok) {
      /* extremely unlikely; still return current balance */
    }
  }

  if (outcome.type === "boost") {
    const qty = outcome.value ?? 1;
    await db
      .insert(userInventory)
      .values({
        userId,
        itemId: "boost_x2",
        quantity: qty,
      })
      .onConflictDoUpdate({
        target: [userInventory.userId, userInventory.itemId],
        set: {
          quantity: sql`${userInventory.quantity} + ${qty}`,
          updatedAt: sql`now()`,
        },
      });
  }

  if (row) {
    await db
      .update(fortuneSpins)
      .set({
        freeUsed: mode === "free" ? true : row.freeUsed,
        paidCount: mode === "paid" ? row.paidCount + 1 : row.paidCount,
        updatedAt: sql`now()`,
      })
      .where(eq(fortuneSpins.id, row.id));
  } else {
    await db.insert(fortuneSpins).values({
      userId,
      utcDate: day,
      freeUsed: mode === "free",
      paidCount: mode === "paid" ? 1 : 0,
    });
  }

  const [b] = await db
    .select({ coins: userBalances.coins })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);

  return {
    ok: true,
    outcome: outcome.type,
    amount: outcome.type === "coins" ? coinsDelta : undefined,
    coins: b?.coins ?? 0,
  };
}
