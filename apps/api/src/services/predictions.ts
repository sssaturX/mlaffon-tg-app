import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  pointPlatforms,
  predictionBets,
  predictions,
  transactions,
  userBalances,
  userPlatformBalances,
} from "../db/schema.js";
import { getPointPlatformById, getPointPlatformByType, type PointPlatform } from "./platformBalances.js";
import { publishBalanceUpdate, publishBroadcastEvent } from "./realtimePublish.js";

type PredictionOption = "A" | "B";
type PredictionStatus = "draft" | "active" | "paused" | "closed" | "resolved";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isLegacyPlatform(platformType: string): platformType is "twitch" | "kick" {
  return platformType === "twitch" || platformType === "kick";
}

function roundPayout(totalPool: number, winnerPool: number, amount: number): number {
  if (winnerPool <= 0 || totalPool <= 0 || amount <= 0) return 0;
  return Math.floor((amount * totalPool) / winnerPool);
}

function isUniqueViolationError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = "code" in e ? String((e as { code?: unknown }).code ?? "") : "";
  if (code === "23505") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique/i.test(msg);
}

async function aggregatePredictionStats(predictionId: string): Promise<{
  participantsA: number;
  participantsB: number;
}> {
  const rows = await db
    .select({
      option: predictionBets.option,
      count: sql<number>`count(*)::int`,
    })
    .from(predictionBets)
    .where(eq(predictionBets.predictionId, predictionId))
    .groupBy(predictionBets.option);
  let participantsA = 0;
  let participantsB = 0;
  for (const row of rows) {
    if (row.option === "A") participantsA = row.count ?? 0;
    if (row.option === "B") participantsB = row.count ?? 0;
  }
  return { participantsA, participantsB };
}

export type PredictionSnapshot = {
  id: string;
  title: string;
  status: PredictionStatus;
  optionA: string;
  optionB: string;
  platform: { id: string; type: string; name: string };
  totalPool: number;
  optionAPool: number;
  optionBPool: number;
  participantsA: number;
  participantsB: number;
  coefficientA: number | null;
  coefficientB: number | null;
  startAt: string | null;
  autoCloseAt: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  winnerOption: PredictionOption | null;
  myBet: { option: PredictionOption; amount: number } | null;
  myPlatformBalance: number | null;
};

async function readUserBalanceTx(
  tx: Tx,
  userId: string,
  platform: PointPlatform
): Promise<number> {
  if (isLegacyPlatform(platform.type)) {
    const [row] = await tx
      .select({
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);
    return platform.type === "twitch" ? row?.twitchCoins ?? 0 : row?.kickCoins ?? 0;
  }
  const [row] = await tx
    .select({ balance: userPlatformBalances.balance })
    .from(userPlatformBalances)
    .where(
      and(
        eq(userPlatformBalances.userId, userId),
        eq(userPlatformBalances.platformId, platform.id)
      )
    )
    .limit(1);
  return row?.balance ?? 0;
}

async function toSnapshot(
  row: typeof predictions.$inferSelect,
  platform: PointPlatform,
  userId: string | null
): Promise<PredictionSnapshot> {
  const participants = await aggregatePredictionStats(row.id);
  let myBet: PredictionSnapshot["myBet"] = null;
  let myPlatformBalance: number | null = null;

  if (userId) {
    const [bet] = await db
      .select({ option: predictionBets.option, amount: predictionBets.amount })
      .from(predictionBets)
      .where(
        and(
          eq(predictionBets.predictionId, row.id),
          eq(predictionBets.userId, userId)
        )
      )
      .limit(1);
    if (bet && (bet.option === "A" || bet.option === "B")) {
      myBet = { option: bet.option, amount: bet.amount };
    }
    myPlatformBalance = await db.transaction((tx) =>
      readUserBalanceTx(tx, userId, platform)
    );
  }

  const cA = row.optionAPool > 0 ? row.totalPool / row.optionAPool : null;
  const cB = row.optionBPool > 0 ? row.totalPool / row.optionBPool : null;

  return {
    id: row.id,
    title: row.title,
    status: row.status as PredictionStatus,
    optionA: row.optionA,
    optionB: row.optionB,
    platform: { id: platform.id, type: platform.type, name: platform.name },
    totalPool: row.totalPool,
    optionAPool: row.optionAPool,
    optionBPool: row.optionBPool,
    participantsA: participants.participantsA,
    participantsB: participants.participantsB,
    coefficientA: cA,
    coefficientB: cB,
    startAt: row.startAt ? row.startAt.toISOString() : null,
    autoCloseAt: row.autoCloseAt ? row.autoCloseAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    winnerOption:
      row.winnerOption === "A" || row.winnerOption === "B" ? row.winnerOption : null,
    myBet,
    myPlatformBalance,
  };
}

export async function listPredictionPlatforms(includeInactive = false) {
  const q = db
    .select({
      id: pointPlatforms.id,
      name: pointPlatforms.name,
      type: pointPlatforms.type,
      isActive: pointPlatforms.isActive,
    })
    .from(pointPlatforms);
  if (!includeInactive) {
    return q.where(eq(pointPlatforms.isActive, true));
  }
  return q;
}

export async function createPrediction(input: {
  title: string;
  optionA: string;
  optionB: string;
  platformType: string;
  startAt?: string | null;
  autoCloseAt?: string | null;
  createdBy?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; code: "bad_platform" }> {
  const platform = await getPointPlatformByType(input.platformType);
  if (!platform || !platform.isActive) return { ok: false, code: "bad_platform" };

  const [ins] = await db
    .insert(predictions)
    .values({
      title: input.title.trim(),
      optionA: input.optionA.trim(),
      optionB: input.optionB.trim(),
      platformId: platform.id,
      status: "draft",
      startAt: input.startAt ? new Date(input.startAt) : null,
      autoCloseAt: input.autoCloseAt ? new Date(input.autoCloseAt) : null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: predictions.id });
  return { ok: true, id: ins!.id };
}

export async function listPredictionsAdmin(): Promise<PredictionSnapshot[]> {
  const rows = await db.select().from(predictions).orderBy(desc(predictions.createdAt));
  const platformIds = Array.from(new Set(rows.map((r) => r.platformId)));
  const platforms = platformIds.length
    ? await db
        .select()
        .from(pointPlatforms)
        .where(inArray(pointPlatforms.id, platformIds))
    : [];
  const byId = new Map(platforms.map((p) => [p.id, p]));
  const out: PredictionSnapshot[] = [];
  for (const row of rows) {
    const p = byId.get(row.platformId);
    if (!p) continue;
    out.push(await toSnapshot(row, p, null));
  }
  return out;
}

export async function getPredictionById(
  id: string,
  userId: string | null
): Promise<PredictionSnapshot | null> {
  const [row] = await db.select().from(predictions).where(eq(predictions.id, id)).limit(1);
  if (!row) return null;
  const platform = await getPointPlatformById(row.platformId);
  if (!platform) return null;
  return toSnapshot(row, platform, userId);
}

export async function getActivePrediction(
  userId: string | null
): Promise<PredictionSnapshot | null> {
  const [row] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.status, "active"))
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  if (!row) return null;
  const platform = await getPointPlatformById(row.platformId);
  if (!platform) return null;
  return toSnapshot(row, platform, userId);
}

async function publishPredictionState(predictionId: string): Promise<void> {
  const snap = await getPredictionById(predictionId, null);
  if (!snap) return;
  await publishBroadcastEvent({ type: "prediction_state", v: 1, data: snap });
}

export async function startPrediction(
  predictionId: string
): Promise<
  { ok: true } | { ok: false; code: "not_found" | "bad_status" | "another_active" }
> {
  const r = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(predictions)
      .where(eq(predictions.id, predictionId))
      .limit(1);
    if (!row) return { ok: false as const, code: "not_found" as const };
    if (row.status !== "draft" && row.status !== "paused") {
      return { ok: false as const, code: "bad_status" as const };
    }
    const [otherActive] = await tx
      .select({ id: predictions.id })
      .from(predictions)
      .where(and(eq(predictions.status, "active"), sql`${predictions.id} <> ${predictionId}`))
      .limit(1);
    if (otherActive) return { ok: false as const, code: "another_active" as const };
    const [updated] = await tx
      .update(predictions)
      .set({ status: "active", startAt: row.startAt ?? sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(predictions.id, predictionId),
          sql`${predictions.status} in ('draft','paused')`
        )
      )
      .returning({ id: predictions.id });
    if (!updated) return { ok: false as const, code: "bad_status" as const };
    return { ok: true as const };
  });
  if (!r.ok) return r;
  await publishPredictionState(predictionId);
  return { ok: true };
}

export async function closePrediction(
  predictionId: string
): Promise<{ ok: true } | { ok: false; code: "not_found" | "bad_status" }> {
  const [updated] = await db
    .update(predictions)
    .set({ status: "closed", closedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(predictions.id, predictionId),
        sql`${predictions.status} in ('active','paused')`
      )
    )
    .returning({ id: predictions.id });
  if (!updated) {
    const [exists] = await db
      .select({ id: predictions.id })
      .from(predictions)
      .where(eq(predictions.id, predictionId))
      .limit(1);
    return { ok: false, code: exists ? "bad_status" : "not_found" };
  }
  await publishPredictionState(predictionId);
  return { ok: true };
}

export async function pausePrediction(
  predictionId: string
): Promise<{ ok: true } | { ok: false; code: "not_found" | "bad_status" }> {
  const [updated] = await db
    .update(predictions)
    .set({ status: "paused", updatedAt: sql`now()` })
    .where(and(eq(predictions.id, predictionId), eq(predictions.status, "active")))
    .returning({ id: predictions.id });
  if (!updated) {
    const [exists] = await db
      .select({ id: predictions.id })
      .from(predictions)
      .where(eq(predictions.id, predictionId))
      .limit(1);
    return { ok: false, code: exists ? "bad_status" : "not_found" };
  }
  await publishPredictionState(predictionId);
  return { ok: true };
}

export async function placePredictionBet(input: {
  predictionId: string;
  userId: string;
  option: PredictionOption;
  amount: number;
}): Promise<
  | { ok: true; prediction: PredictionSnapshot }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_active"
        | "already_bet"
        | "insufficient_balance"
        | "platform_inactive";
    }
> {
  if (input.amount <= 0) throw new Error("amount_must_be_positive");

  let platformTypeUsed: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const [predictionRow] = await tx
        .select()
        .from(predictions)
        .where(eq(predictions.id, input.predictionId))
        .limit(1);
      if (!predictionRow) throw new Error("not_found");
      if (predictionRow.status !== "active") throw new Error("not_active");

      const [p] = await tx
        .select({
          id: pointPlatforms.id,
          name: pointPlatforms.name,
          type: pointPlatforms.type,
          isActive: pointPlatforms.isActive,
        })
        .from(pointPlatforms)
        .where(eq(pointPlatforms.id, predictionRow.platformId))
        .limit(1);
      if (!p || !p.isActive) throw new Error("platform_inactive");
      platformTypeUsed = p.type;

      const [existingBet] = await tx
        .select({ id: predictionBets.id })
        .from(predictionBets)
        .where(
          and(
            eq(predictionBets.predictionId, input.predictionId),
            eq(predictionBets.userId, input.userId)
          )
        )
        .limit(1);
      if (existingBet) throw new Error("already_bet");

      if (isLegacyPlatform(p.type)) {
        const [updated] = await tx
          .update(userBalances)
          .set(
            p.type === "twitch"
              ? {
                  twitchCoins: sql`${userBalances.twitchCoins} - ${input.amount}`,
                  coins: sql`${userBalances.coins} - ${input.amount}`,
                }
              : {
                  kickCoins: sql`${userBalances.kickCoins} - ${input.amount}`,
                  coins: sql`${userBalances.coins} - ${input.amount}`,
                }
          )
          .where(
            and(
              eq(userBalances.userId, input.userId),
              p.type === "twitch"
                ? sql`${userBalances.twitchCoins} >= ${input.amount}`
                : sql`${userBalances.kickCoins} >= ${input.amount}`
            )
          )
          .returning({ userId: userBalances.userId });
        if (!updated) throw new Error("insufficient_balance");
      } else {
        await tx
          .insert(userPlatformBalances)
          .values({ userId: input.userId, platformId: p.id, balance: 0 })
          .onConflictDoNothing();
        const [updated] = await tx
          .update(userPlatformBalances)
          .set({
            balance: sql`${userPlatformBalances.balance} - ${input.amount}`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(userPlatformBalances.userId, input.userId),
              eq(userPlatformBalances.platformId, p.id),
              sql`${userPlatformBalances.balance} >= ${input.amount}`
            )
          )
          .returning({ id: userPlatformBalances.id });
        if (!updated) throw new Error("insufficient_balance");
      }

      await tx.insert(transactions).values({
        userId: input.userId,
        amount: -input.amount,
        kind: "prediction_bet",
        referenceType: "prediction",
        referenceId: input.predictionId,
        idempotencyKey: `prediction_bet:${input.predictionId}:${input.userId}`,
        meta: { option: input.option, platformType: p.type, platformId: p.id },
      });

      await tx.insert(predictionBets).values({
        predictionId: input.predictionId,
        userId: input.userId,
        option: input.option,
        amount: input.amount,
        platformId: p.id,
      });

      await tx
        .update(predictions)
        .set(
          input.option === "A"
            ? {
                optionAPool: sql`${predictions.optionAPool} + ${input.amount}`,
                totalPool: sql`${predictions.totalPool} + ${input.amount}`,
                updatedAt: sql`now()`,
              }
            : {
                optionBPool: sql`${predictions.optionBPool} + ${input.amount}`,
                totalPool: sql`${predictions.totalPool} + ${input.amount}`,
                updatedAt: sql`now()`,
              }
        )
        .where(eq(predictions.id, input.predictionId));
    });
  } catch (e) {
    if (isUniqueViolationError(e)) {
      return { ok: false, code: "already_bet" };
    }
    const msg = e instanceof Error ? e.message : "unknown";
    if (
      msg === "not_found" ||
      msg === "not_active" ||
      msg === "already_bet" ||
      msg === "insufficient_balance" ||
      msg === "platform_inactive"
    ) {
      return { ok: false, code: msg };
    }
    throw e;
  }

  if (platformTypeUsed && isLegacyPlatform(platformTypeUsed)) {
    void publishBalanceUpdate(input.userId);
  }
  await publishPredictionState(input.predictionId);
  const snapshot = await getPredictionById(input.predictionId, input.userId);
  if (!snapshot) return { ok: false, code: "not_found" };
  return { ok: true, prediction: snapshot };
}

export async function resolvePrediction(input: {
  predictionId: string;
  winnerOption: PredictionOption;
}): Promise<{ ok: true } | { ok: false; code: "not_found" | "bad_status" }> {
  const [row] = await db.select().from(predictions).where(eq(predictions.id, input.predictionId)).limit(1);
  if (!row) return { ok: false, code: "not_found" };
  if (row.status !== "closed") return { ok: false, code: "bad_status" };

  const platform = await getPointPlatformById(row.platformId);
  if (!platform) return { ok: false, code: "not_found" };

  const winnerPool = input.winnerOption === "A" ? row.optionAPool : row.optionBPool;
  const totalPool = row.totalPool;
  const legacyUsersToNotify = new Set<string>();

  const committed = await db.transaction(async (tx) => {
    const [locked] = await tx
      .update(predictions)
      .set({
        status: "resolved",
        winnerOption: input.winnerOption,
        resolvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(predictions.id, input.predictionId),
          eq(predictions.status, "closed")
        )
      )
      .returning({ id: predictions.id });
    if (!locked) return false;

    const winners = await tx
      .select({ userId: predictionBets.userId, amount: predictionBets.amount })
      .from(predictionBets)
      .where(
        and(
          eq(predictionBets.predictionId, input.predictionId),
          eq(predictionBets.option, input.winnerOption)
        )
      );

    for (const w of winners) {
      const payout = roundPayout(totalPool, winnerPool, w.amount);
      if (payout <= 0) continue;

      await tx.insert(transactions).values({
        userId: w.userId,
        amount: payout,
        kind: "prediction_payout",
        referenceType: "prediction",
        referenceId: input.predictionId,
        idempotencyKey: `prediction_payout:${input.predictionId}:${w.userId}`,
        meta: {
          platformType: platform.type,
          platformId: platform.id,
          winnerOption: input.winnerOption,
        },
      });

      if (isLegacyPlatform(platform.type)) {
        await tx
          .update(userBalances)
          .set(
            platform.type === "twitch"
              ? {
                  twitchCoins: sql`${userBalances.twitchCoins} + ${payout}`,
                  coins: sql`${userBalances.coins} + ${payout}`,
                }
              : {
                  kickCoins: sql`${userBalances.kickCoins} + ${payout}`,
                  coins: sql`${userBalances.coins} + ${payout}`,
                }
          )
          .where(eq(userBalances.userId, w.userId));
        legacyUsersToNotify.add(w.userId);
      } else {
        await tx
          .insert(userPlatformBalances)
          .values({
            userId: w.userId,
            platformId: platform.id,
            balance: payout,
          })
          .onConflictDoUpdate({
            target: [userPlatformBalances.userId, userPlatformBalances.platformId],
            set: {
              balance: sql`${userPlatformBalances.balance} + ${payout}`,
              updatedAt: sql`now()`,
            },
          });
      }
    }
    return true;
  });
  if (!committed) return { ok: false, code: "bad_status" };

  for (const userId of legacyUsersToNotify) {
    void publishBalanceUpdate(userId);
  }
  await publishPredictionState(input.predictionId);
  return { ok: true };
}
