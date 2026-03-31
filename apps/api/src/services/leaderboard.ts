import { eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  platformAccounts,
  referrals,
  userBalances,
  userStreamStreaks,
  users,
} from "../db/schema.js";

export type LeaderSort = "coins" | "streak" | "referrals";
export type PlatformFilter = "all" | "twitch" | "kick";

async function userIdsForPlatformFilter(
  platform: PlatformFilter
): Promise<string[] | null> {
  if (platform === "all") return null;
  const rows = await db
    .select({ userId: platformAccounts.userId })
    .from(platformAccounts)
    .where(eq(platformAccounts.platform, platform));
  return rows.map((r) => r.userId);
}

export async function getLeaderboard(params: {
  sort: LeaderSort;
  platform: PlatformFilter;
  limit?: number;
}): Promise<
  {
    userId: string;
    displayName: string;
    photoUrl: string | null;
    value: number;
  }[]
> {
  const limit = params.limit ?? 50;
  const ids = await userIdsForPlatformFilter(params.platform);

  if (ids && ids.length === 0) return [];

  const baseUsers = await db.select().from(users);
  let filtered = baseUsers;
  if (ids) {
    const set = new Set(ids);
    filtered = baseUsers.filter((u) => set.has(u.id));
  }

  const userIds = filtered.map((u) => u.id);
  if (userIds.length === 0) return [];

  const [balances, streaks, refCounts] = await Promise.all([
    db.select().from(userBalances).where(inArray(userBalances.userId, userIds)),
    db
      .select()
      .from(userStreamStreaks)
      .where(inArray(userStreamStreaks.userId, userIds)),
    db
      .select({
        referrerId: referrals.referrerId,
        c: sql<number>`count(*)::int`,
      })
      .from(referrals)
      .where(inArray(referrals.referrerId, userIds))
      .groupBy(referrals.referrerId),
  ]);

  const balMap = new Map(
    balances.map((b) => {
      let v = b.coins;
      if (params.sort === "coins") {
        if (params.platform === "twitch") v = b.twitchCoins;
        else if (params.platform === "kick") v = b.kickCoins;
      }
      return [b.userId, v] as const;
    })
  );
  const strMap = new Map(
    streaks.map((s) => {
      let v = Math.max(s.twitchCurrent, s.kickCurrent);
      if (params.sort === "streak") {
        if (params.platform === "twitch") v = s.twitchCurrent;
        else if (params.platform === "kick") v = s.kickCurrent;
      }
      return [s.userId, v] as const;
    })
  );
  const refMap = new Map(refCounts.map((r) => [r.referrerId, r.c]));

  const rows = filtered.map((u) => {
    const displayName =
      u.username ??
      u.firstName ??
      (u.telegramId ? `tg:${u.telegramId}` : "user");
    let value = 0;
    if (params.sort === "coins") value = balMap.get(u.id) ?? 0;
    else if (params.sort === "streak") value = strMap.get(u.id) ?? 0;
    else value = refMap.get(u.id) ?? 0;
    return {
      userId: u.id,
      displayName,
      photoUrl: u.photoUrl,
      value,
    };
  });

  rows.sort((a, b) => b.value - a.value);
  return rows.slice(0, limit);
}

export async function rankOfUser(
  sort: LeaderSort,
  platform: PlatformFilter,
  userId: string
): Promise<{ rank: number; value: number } | null> {
  const board = await getLeaderboard({ sort, platform, limit: 5000 });
  const idx = board.findIndex((e) => e.userId === userId);
  if (idx === -1) return null;
  return { rank: idx + 1, value: board[idx]!.value };
}

/**
 * Ранг по сумме монет (поле `coins`) в глобальном топе: 1 + число пользователей с большим балансом.
 */
export async function getCoinRankAll(userId: string): Promise<number | null> {
  const [me] = await db
    .select({ coins: userBalances.coins })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);
  if (!me) return null;
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(userBalances)
    .where(gt(userBalances.coins, me.coins));
  return Number(c) + 1;
}
