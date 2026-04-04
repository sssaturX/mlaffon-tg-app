import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  pointPlatforms,
  transactions,
  userBalances,
  userPlatformBalances,
} from "../db/schema.js";
import { publishBalanceUpdate } from "./realtimePublish.js";

export type PointPlatform = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isLegacyPlatformType(type: string): type is "twitch" | "kick" {
  return type === "twitch" || type === "kick";
}

export async function seedDefaultPointPlatforms(): Promise<void> {
  const defaults = [
    { name: "Twitch points", type: "twitch" },
    { name: "Kick points", type: "kick" },
    { name: "Internal points", type: "internal" },
  ];
  for (const p of defaults) {
    await db
      .insert(pointPlatforms)
      .values({ name: p.name, type: p.type, isActive: true })
      .onConflictDoUpdate({
        target: pointPlatforms.type,
        set: { name: p.name, isActive: true, updatedAt: sql`now()` },
      });
  }
}

export async function listActivePointPlatforms(): Promise<PointPlatform[]> {
  const rows = await db
    .select({
      id: pointPlatforms.id,
      name: pointPlatforms.name,
      type: pointPlatforms.type,
      isActive: pointPlatforms.isActive,
    })
    .from(pointPlatforms)
    .where(eq(pointPlatforms.isActive, true));
  return rows;
}

export async function getPointPlatformByType(
  type: string
): Promise<PointPlatform | null> {
  const [row] = await db
    .select({
      id: pointPlatforms.id,
      name: pointPlatforms.name,
      type: pointPlatforms.type,
      isActive: pointPlatforms.isActive,
    })
    .from(pointPlatforms)
    .where(eq(pointPlatforms.type, type))
    .limit(1);
  return row ?? null;
}

export async function getPointPlatformById(
  platformId: string
): Promise<PointPlatform | null> {
  const [row] = await db
    .select({
      id: pointPlatforms.id,
      name: pointPlatforms.name,
      type: pointPlatforms.type,
      isActive: pointPlatforms.isActive,
    })
    .from(pointPlatforms)
    .where(eq(pointPlatforms.id, platformId))
    .limit(1);
  return row ?? null;
}

async function getUserBalanceFromTx(
  tx: Tx,
  userId: string,
  platform: PointPlatform
): Promise<number> {
  if (isLegacyPlatformType(platform.type)) {
    const [row] = await tx
      .select({
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);
    if (!row) return 0;
    return platform.type === "twitch" ? row.twitchCoins : row.kickCoins;
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

export async function getUserBalanceForPlatform(
  userId: string,
  platform: PointPlatform
): Promise<number> {
  return db.transaction((tx) => getUserBalanceFromTx(tx, userId, platform));
}

async function insertLedgerTx(
  tx: Tx,
  params: {
    userId: string;
    amount: number;
    idempotencyKey: string;
    kind: string;
    platform: PointPlatform;
    referenceType?: string;
    referenceId?: string;
    meta?: Record<string, unknown>;
  }
): Promise<"ok" | "duplicate"> {
  const [existing] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (existing) return "duplicate";
  await tx.insert(transactions).values({
    userId: params.userId,
    amount: params.amount,
    kind: params.kind,
    idempotencyKey: params.idempotencyKey,
    referenceType: params.referenceType ?? null,
    referenceId: params.referenceId ?? null,
    meta: {
      platformId: params.platform.id,
      platformType: params.platform.type,
      ...(params.meta ?? {}),
    },
  });
  return "ok";
}

export async function debitPlatformBalance(params: {
  userId: string;
  amount: number;
  platform: PointPlatform;
  idempotencyKey: string;
  kind: string;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: "duplicate" | "insufficient" }> {
  if (params.amount <= 0) throw new Error("amount_must_be_positive");
  const out = await db.transaction(async (tx) => {
    const ledger = await insertLedgerTx(tx, {
      userId: params.userId,
      amount: -params.amount,
      idempotencyKey: params.idempotencyKey,
      kind: params.kind,
      platform: params.platform,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      meta: params.meta,
    });
    if (ledger === "duplicate") return { ok: false as const, reason: "duplicate" as const };

    if (isLegacyPlatformType(params.platform.type)) {
      const [updated] = await tx
        .update(userBalances)
        .set(
          params.platform.type === "twitch"
            ? {
                twitchCoins: sql`${userBalances.twitchCoins} - ${params.amount}`,
                coins: sql`${userBalances.coins} - ${params.amount}`,
              }
            : {
                kickCoins: sql`${userBalances.kickCoins} - ${params.amount}`,
                coins: sql`${userBalances.coins} - ${params.amount}`,
              }
        )
        .where(
          and(
            eq(userBalances.userId, params.userId),
            params.platform.type === "twitch"
              ? sql`${userBalances.twitchCoins} >= ${params.amount}`
              : sql`${userBalances.kickCoins} >= ${params.amount}`
          )
        )
        .returning({ userId: userBalances.userId });
      if (!updated) return { ok: false as const, reason: "insufficient" as const };
      return { ok: true as const };
    }

    await tx
      .insert(userPlatformBalances)
      .values({
        userId: params.userId,
        platformId: params.platform.id,
        balance: 0,
      })
      .onConflictDoNothing();

    const [updated] = await tx
      .update(userPlatformBalances)
      .set({
        balance: sql`${userPlatformBalances.balance} - ${params.amount}`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(userPlatformBalances.userId, params.userId),
          eq(userPlatformBalances.platformId, params.platform.id),
          sql`${userPlatformBalances.balance} >= ${params.amount}`
        )
      )
      .returning({ id: userPlatformBalances.id });
    if (!updated) return { ok: false as const, reason: "insufficient" as const };
    return { ok: true as const };
  });
  if (out.ok && isLegacyPlatformType(params.platform.type)) {
    void publishBalanceUpdate(params.userId);
  }
  return out;
}

export async function creditPlatformBalance(params: {
  userId: string;
  amount: number;
  platform: PointPlatform;
  idempotencyKey: string;
  kind: string;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: "duplicate" }> {
  if (params.amount <= 0) throw new Error("amount_must_be_positive");
  const out = await db.transaction(async (tx) => {
    const ledger = await insertLedgerTx(tx, {
      userId: params.userId,
      amount: params.amount,
      idempotencyKey: params.idempotencyKey,
      kind: params.kind,
      platform: params.platform,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      meta: params.meta,
    });
    if (ledger === "duplicate") return { ok: false as const, reason: "duplicate" as const };

    if (isLegacyPlatformType(params.platform.type)) {
      await tx
        .update(userBalances)
        .set(
          params.platform.type === "twitch"
            ? {
                twitchCoins: sql`${userBalances.twitchCoins} + ${params.amount}`,
                coins: sql`${userBalances.coins} + ${params.amount}`,
              }
            : {
                kickCoins: sql`${userBalances.kickCoins} + ${params.amount}`,
                coins: sql`${userBalances.coins} + ${params.amount}`,
              }
        )
        .where(eq(userBalances.userId, params.userId));
      return { ok: true as const };
    }

    await tx
      .insert(userPlatformBalances)
      .values({
        userId: params.userId,
        platformId: params.platform.id,
        balance: params.amount,
      })
      .onConflictDoUpdate({
        target: [userPlatformBalances.userId, userPlatformBalances.platformId],
        set: {
          balance: sql`${userPlatformBalances.balance} + ${params.amount}`,
          updatedAt: sql`now()`,
        },
      });
    return { ok: true as const };
  });
  if (out.ok && isLegacyPlatformType(params.platform.type)) {
    void publishBalanceUpdate(params.userId);
  }
  return out;
}
