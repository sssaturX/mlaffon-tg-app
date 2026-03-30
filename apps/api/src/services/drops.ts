import { randomInt } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dropUserStates, drops } from "../db/schema.js";
import { applyCreditSplit } from "./economy.js";

function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 8);
}

function randomReward(min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return randomInt(min, max + 1);
}

export type ActiveDropPublic = {
  hasActiveDrop: true;
  dropId: string;
  endsAt: string;
  remainingSeconds: number;
  maxWinners: number;
  winnersCount: number;
  won: boolean;
  rewardCoins: number | null;
};

export type ActiveDropNone = { hasActiveDrop: false };

export async function getActiveDropSnapshot(
  userId: string
): Promise<ActiveDropPublic | ActiveDropNone> {
  const now = new Date();
  const [d] = await db
    .select()
    .from(drops)
    .where(and(eq(drops.active, true), sql`${drops.endsAt} > ${now}`))
    .orderBy(desc(drops.startedAt))
    .limit(1);

  if (!d) return { hasActiveDrop: false };

  const remainingMs = Math.max(0, d.endsAt.getTime() - now.getTime());
  const remainingSeconds = Math.floor(remainingMs / 1000);

  const [st] = await db
    .select()
    .from(dropUserStates)
    .where(
      and(eq(dropUserStates.dropId, d.id), eq(dropUserStates.userId, userId))
    )
    .limit(1);

  const won = st?.won ?? false;
  const rewardCoins = st?.rewardCoins ?? null;

  return {
    hasActiveDrop: true,
    dropId: d.id,
    endsAt: d.endsAt.toISOString(),
    remainingSeconds,
    maxWinners: d.maxWinners,
    winnersCount: d.winnersCount,
    won,
    rewardCoins,
  };
}

export type AttemptResult =
  | { ok: true; reward: number }
  | {
      ok: false;
      code:
        | "not_found"
        | "drop_ended"
        | "wrong_code"
        | "already_won"
        | "pool_full"
        | "duplicate";
    };

export async function attemptDropCode(
  userId: string,
  rawCode: string
): Promise<AttemptResult> {
  const now = new Date();
  const [d] = await db
    .select()
    .from(drops)
    .where(and(eq(drops.active, true), sql`${drops.endsAt} > ${now}`))
    .orderBy(desc(drops.startedAt))
    .limit(1);

  if (!d) return { ok: false, code: "drop_ended" };

  const input = normalizeCode(rawCode);
  const expected = normalizeCode(d.code);
  if (expected.length < 4) {
    return { ok: false, code: "not_found" };
  }

  const [existing] = await db
    .select()
    .from(dropUserStates)
    .where(
      and(eq(dropUserStates.dropId, d.id), eq(dropUserStates.userId, userId))
    )
    .limit(1);

  if (existing?.won) {
    return { ok: false, code: "already_won" };
  }

  if (input !== expected) {
    return { ok: false, code: "wrong_code" };
  }

  const [slot] = await db
    .update(drops)
    .set({ winnersCount: sql`${drops.winnersCount} + 1` })
    .where(and(eq(drops.id, d.id), lt(drops.winnersCount, drops.maxWinners)))
    .returning({ id: drops.id });

  if (!slot) {
    return { ok: false, code: "pool_full" };
  }

  const reward = randomReward(d.rewardMin, d.rewardMax);
  const idem = `drop:${d.id}:${userId}`;
  const credit = await applyCreditSplit({
    userId,
    amount: reward,
    idempotencyKey: idem,
    kind: "drop_reward",
    referenceType: "drop",
    referenceId: String(d.id),
  });

  if (!credit.ok) {
    await db
      .update(drops)
      .set({ winnersCount: sql`${drops.winnersCount} - 1` })
      .where(eq(drops.id, d.id));
    if (credit.reason === "duplicate") {
      const [st] = await db
        .select()
        .from(dropUserStates)
        .where(
          and(
            eq(dropUserStates.dropId, d.id),
            eq(dropUserStates.userId, userId)
          )
        )
        .limit(1);
      if (st?.won && st.rewardCoins != null) {
        return { ok: true, reward: st.rewardCoins };
      }
      return { ok: false, code: "duplicate" };
    }
    return { ok: false, code: "wrong_code" };
  }

  const paid = credit.creditedAmount;

  if (existing) {
    await db
      .update(dropUserStates)
      .set({
        won: true,
        rewardCoins: paid,
        lastAttemptAt: now,
      })
      .where(eq(dropUserStates.id, existing.id));
  } else {
    await db.insert(dropUserStates).values({
      dropId: d.id,
      userId,
      attemptsCount: 1,
      lastAttemptAt: now,
      won: true,
      rewardCoins: paid,
    });
  }

  return { ok: true, reward: paid };
}

export async function startDrop(params: {
  code: string;
  durationSeconds: number;
  maxWinners: number;
  rewardMin: number;
  rewardMax: number;
}): Promise<{ id: string }> {
  const code = normalizeCode(params.code);
  if (code.length < 4) throw new Error("code_invalid");

  const startedAt = new Date();
  const endsAt = new Date(Date.now() + params.durationSeconds * 1000);
  let min = params.rewardMin;
  let max = params.rewardMax;
  if (max < min) [min, max] = [max, min];

  await db.update(drops).set({ active: false }).where(eq(drops.active, true));

  const [ins] = await db
    .insert(drops)
    .values({
      code,
      rewardMin: min,
      rewardMax: max,
      maxWinners: params.maxWinners,
      winnersCount: 0,
      startedAt,
      endsAt,
      active: true,
    })
    .returning({ id: drops.id });

  return { id: ins!.id };
}

export async function stopActiveDrops(): Promise<void> {
  await db.update(drops).set({ active: false }).where(eq(drops.active, true));
}

export async function getAdminDropStatus(): Promise<{
  active: boolean;
  drop: {
    id: string;
    code: string;
    rewardMin: number;
    rewardMax: number;
    maxWinners: number;
    winnersCount: number;
    startedAt: string;
    endsAt: string;
  } | null;
}> {
  const now = new Date();
  const [d] = await db
    .select()
    .from(drops)
    .where(and(eq(drops.active, true), sql`${drops.endsAt} > ${now}`))
    .orderBy(desc(drops.startedAt))
    .limit(1);

  if (!d) return { active: false, drop: null };

  return {
    active: true,
    drop: {
      id: d.id,
      code: d.code,
      rewardMin: d.rewardMin,
      rewardMax: d.rewardMax,
      maxWinners: d.maxWinners,
      winnersCount: d.winnersCount,
      startedAt: d.startedAt.toISOString(),
      endsAt: d.endsAt.toISOString(),
    },
  };
}
