import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { fortuneSpins } from "../db/schema.js";
import { gameConfig } from "../config.js";
import {
  applyCredit,
  applyDebit,
  type EconomyPlatform,
} from "./economy.js";
import { utcDateString } from "./streak.js";

export type FortuneSegmentPublic = {
  index: number;
  type: "coins" | "nothing";
  value?: number;
  label: string;
};

function labelForOutcome(
  o: (typeof gameConfig.fortune.outcomes)[number]
): string {
  if (o.type === "coins") return `${o.value ?? 0} монет`;
  return "Пусто";
}

export function getFortuneSegments(): FortuneSegmentPublic[] {
  return gameConfig.fortune.outcomes.map((o, i) => ({
    index: i,
    type: o.type,
    value: o.value,
    label: labelForOutcome(o),
  }));
}

function pickOutcome(): {
  outcome: (typeof gameConfig.fortune.outcomes)[number];
  segmentIndex: number;
} {
  const items = gameConfig.fortune.outcomes;
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    const o = items[i]!;
    r -= o.weight;
    if (r <= 0) return { outcome: o, segmentIndex: i };
  }
  const last = items.length - 1;
  return {
    outcome: items[last]!,
    segmentIndex: last,
  };
}

export function getFortuneConfigResponse(): {
  paidSpinCost: number;
  segments: FortuneSegmentPublic[];
} {
  return {
    paidSpinCost: gameConfig.fortune.paidSpinCost,
    segments: getFortuneSegments(),
  };
}

export async function getFortuneStateResponse(userId: string): Promise<{
  utcDate: string;
  freeAvailable: boolean;
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
  };
}

/** Совместимость: конфиг + состояние в одном ответе. */
export async function getFortuneStatus(userId: string): Promise<{
  utcDate: string;
  freeAvailable: boolean;
  paidSpinCost: number;
  segments: FortuneSegmentPublic[];
}> {
  const [config, state] = await Promise.all([
    Promise.resolve(getFortuneConfigResponse()),
    getFortuneStateResponse(userId),
  ]);
  return { ...config, ...state };
}

export async function spinFortuneWheel(
  userId: string,
  mode: "free" | "paid",
  platform: EconomyPlatform
): Promise<
  | {
      ok: true;
      outcome: "coins" | "nothing";
      /** Индекс сектора на колесе (0..n-1), совпадает с GET /games/fortune segments. */
      segmentIndex: number;
      amount?: number;
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
    if (row) {
      const [locked] = await db
        .update(fortuneSpins)
        .set({ freeUsed: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(fortuneSpins.id, row.id),
            eq(fortuneSpins.freeUsed, false)
          )
        )
        .returning({ id: fortuneSpins.id });
      if (!locked) return { ok: false, error: "free_spin_used" };
    }
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

  const { outcome, segmentIndex } = pickOutcome();
  let coinsDelta = 0;
  let coinsCredited = 0;
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
    if (credit.ok) {
      coinsCredited = credit.creditedAmount;
    }
  }

  if (mode === "free" && row) {
    /* row already atomically set freeUsed=true above; only bump paid if needed (no-op here). */
  } else {
    await db
      .insert(fortuneSpins)
      .values({
        userId,
        utcDate: day,
        freeUsed: mode === "free",
        paidCount: mode === "paid" ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [fortuneSpins.userId, fortuneSpins.utcDate],
        set: {
          paidCount:
            mode === "paid"
              ? sql`${fortuneSpins.paidCount} + 1`
              : sql`${fortuneSpins.paidCount}`,
          updatedAt: sql`now()`,
        },
      });
  }

  return {
    ok: true,
    outcome: outcome.type,
    segmentIndex,
    amount: outcome.type === "coins" ? coinsCredited : undefined,
  };
}
