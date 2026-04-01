import { randomInt } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dropUserStates, drops, platformAccounts } from "../db/schema.js";
import { applyCredit, applyCreditSplit } from "./economy.js";
import {
  publishBroadcastEvent,
  publishUserEvent,
} from "./realtimePublish.js";

function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 8);
}

function randomReward(min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return randomInt(min, max + 1);
}

export type DropPlatformScope = "twitch" | "kick" | "both";

async function userConnectedPlatforms(
  userId: string
): Promise<{ twitch: boolean; kick: boolean }> {
  const rows = await db
    .select({ platform: platformAccounts.platform })
    .from(platformAccounts)
    .where(eq(platformAccounts.userId, userId));
  const s = new Set(rows.map((r) => r.platform));
  return { twitch: s.has("twitch"), kick: s.has("kick") };
}

function canParticipateDrop(
  dropPlatform: string,
  u: { twitch: boolean; kick: boolean }
): boolean {
  if (dropPlatform === "twitch") return u.twitch;
  if (dropPlatform === "kick") return u.kick;
  return u.twitch && u.kick;
}

/** Откат слота и состояния пользователя, если начисление не прошло. */
async function compensateDropAfterCreditFailure(
  dropId: string,
  userId: string,
  hadExistingRow: boolean,
  existingStateId: string | undefined
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(drops)
      .set({ winnersCount: sql`${drops.winnersCount} - 1` })
      .where(eq(drops.id, dropId));

    if (hadExistingRow && existingStateId) {
      await tx
        .update(dropUserStates)
        .set({
          won: false,
          rewardCoins: null,
        })
        .where(eq(dropUserStates.id, existingStateId));
    } else {
      await tx
        .delete(dropUserStates)
        .where(
          and(
            eq(dropUserStates.dropId, dropId),
            eq(dropUserStates.userId, userId)
          )
        );
    }
  });
}

export type ActiveDropPublic = {
  hasActiveDrop: true;
  dropId: string;
  endsAt: string;
  /** ISO — для синхронизации таймера с клиентом */
  serverNow: string;
  remainingSeconds: number;
  platform: DropPlatformScope;
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

  const platforms = await userConnectedPlatforms(userId);
  const dp = (d.platform ?? "both") as DropPlatformScope;
  if (!canParticipateDrop(dp, platforms)) return { hasActiveDrop: false };

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
    serverNow: now.toISOString(),
    remainingSeconds,
    platform: dp,
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
        | "duplicate"
        | "not_eligible";
    };

export async function attemptDropCode(
  userId: string,
  rawCode: string
): Promise<AttemptResult> {
  const now = new Date();
  const input = normalizeCode(rawCode);
  const platforms = await userConnectedPlatforms(userId);

  const reserved = await db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(drops)
      .where(and(eq(drops.active, true), sql`${drops.endsAt} > ${now}`))
      .orderBy(desc(drops.startedAt))
      .for("update")
      .limit(1);

    if (!d) return { kind: "err" as const, code: "drop_ended" as const };

    const dp = (d.platform ?? "both") as DropPlatformScope;
    if (!canParticipateDrop(dp, platforms)) {
      return { kind: "err" as const, code: "not_eligible" as const };
    }

    const expected = normalizeCode(d.code);
    if (expected.length < 4) {
      return { kind: "err" as const, code: "not_found" as const };
    }

    const [existing] = await tx
      .select()
      .from(dropUserStates)
      .where(
        and(eq(dropUserStates.dropId, d.id), eq(dropUserStates.userId, userId))
      )
      .limit(1);

    if (existing?.won) {
      return { kind: "err" as const, code: "already_won" as const };
    }

    if (input !== expected) {
      return { kind: "err" as const, code: "wrong_code" as const };
    }

    const [slot] = await tx
      .update(drops)
      .set({ winnersCount: sql`${drops.winnersCount} + 1` })
      .where(and(eq(drops.id, d.id), lt(drops.winnersCount, drops.maxWinners)))
      .returning({ id: drops.id });

    if (!slot) {
      return { kind: "err" as const, code: "pool_full" as const };
    }

    const reward = randomReward(d.rewardMin, d.rewardMax);
    const hadExistingRow = Boolean(existing);
    const existingStateId = existing?.id;

    if (existing) {
      await tx
        .update(dropUserStates)
        .set({
          won: true,
          rewardCoins: reward,
          lastAttemptAt: now,
          attemptsCount: sql`${dropUserStates.attemptsCount} + 1`,
        })
        .where(eq(dropUserStates.id, existing.id));
    } else {
      await tx.insert(dropUserStates).values({
        dropId: d.id,
        userId,
        attemptsCount: 1,
        lastAttemptAt: now,
        won: true,
        rewardCoins: reward,
      });
    }

    return {
      kind: "ok" as const,
      d,
      dp,
      reward,
      hadExistingRow,
      existingStateId,
    };
  });

  if (reserved.kind === "err") {
    return { ok: false, code: reserved.code };
  }

  const { d, dp, reward, hadExistingRow, existingStateId } = reserved;
  const idem = `drop:${d.id}:${userId}`;
  let paid = 0;

  if (reward <= 0) {
    void publishUserEvent(userId, {
      type: "drop_claimed",
      v: 1,
      data: { dropId: d.id, reward: 0 },
    });
    const [dAfter] = await db
      .select()
      .from(drops)
      .where(eq(drops.id, d.id))
      .limit(1);
    if (dAfter && dAfter.winnersCount >= dAfter.maxWinners) {
      void publishBroadcastEvent({
        type: "drop_finished",
        v: 1,
        data: { dropId: d.id },
      });
    }
    return { ok: true, reward: 0 };
  }

  if (dp === "both") {
    const credit = await applyCreditSplit({
      userId,
      amount: reward,
      idempotencyKey: idem,
      kind: "drop_reward",
      referenceType: "drop",
      referenceId: String(d.id),
    });

    if (!credit.ok) {
      await compensateDropAfterCreditFailure(
        d.id,
        userId,
        hadExistingRow,
        existingStateId
      );
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
    paid = credit.creditedAmount;
  } else {
    const credit = await applyCredit({
      userId,
      amount: reward,
      idempotencyKey: idem,
      kind: "drop_reward",
      platform: dp,
      referenceType: "drop",
      referenceId: String(d.id),
    });

    if (!credit.ok) {
      await compensateDropAfterCreditFailure(
        d.id,
        userId,
        hadExistingRow,
        existingStateId
      );
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
    paid = credit.creditedAmount;
  }

  void publishUserEvent(userId, {
    type: "drop_claimed",
    v: 1,
    data: { dropId: d.id, reward: paid },
  });

  const [dAfter] = await db
    .select()
    .from(drops)
    .where(eq(drops.id, d.id))
    .limit(1);
  if (dAfter && dAfter.winnersCount >= dAfter.maxWinners) {
    void publishBroadcastEvent({
      type: "drop_finished",
      v: 1,
      data: { dropId: d.id },
    });
  }

  return { ok: true, reward: paid };
}

/**
 * При завершении эфира гасим все ещё «живые» по таймеру дропы (правило: дроп только во время стрима).
 */
export async function deactivateActiveDropsOnStreamEnd(): Promise<void> {
  const now = new Date();
  const rows = await db
    .select({ id: drops.id })
    .from(drops)
    .where(and(eq(drops.active, true), sql`${drops.endsAt} > ${now}`));

  if (rows.length === 0) return;

  const ids = rows.map((r) => r.id);
  await db.update(drops).set({ active: false }).where(inArray(drops.id, ids));

  for (const id of ids) {
    void publishBroadcastEvent({
      type: "drop_finished",
      v: 1,
      data: { dropId: id },
    });
  }
}

export async function startDrop(params: {
  code: string;
  durationSeconds: number;
  maxWinners: number;
  rewardMin: number;
  rewardMax: number;
  platform: DropPlatformScope;
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
      platform: params.platform,
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

  const now = new Date();
  void publishBroadcastEvent({
    type: "drop_started",
    v: 1,
    data: {
      dropId: ins!.id,
      endsAt: endsAt.toISOString(),
      serverNow: now.toISOString(),
      remainingSeconds: Math.floor((endsAt.getTime() - now.getTime()) / 1000),
      platform: params.platform,
      maxWinners: params.maxWinners,
      winnersCount: 0,
    },
  });

  const untilEnd = endsAt.getTime() - now.getTime();
  const delay = Math.min(Math.max(0, untilEnd), 2147483647);
  if (delay > 0) {
    setTimeout(() => {
      void publishBroadcastEvent({
        type: "drop_finished",
        v: 1,
        data: { dropId: ins!.id },
      });
    }, delay);
  }

  return { id: ins!.id };
}

export async function getAdminDropStatus(): Promise<{
  active: boolean;
  drop: {
    id: string;
    platform: string;
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
      platform: d.platform ?? "both",
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
