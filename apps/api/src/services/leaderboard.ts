import { and, eq, gt, sql } from "drizzle-orm";
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

type LeaderRow = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  value: number;
};

export async function getLeaderboard(params: {
  sort: LeaderSort;
  platform: PlatformFilter;
  limit?: number;
}): Promise<LeaderRow[]> {
  const limit = params.limit ?? 50;
  const { sort, platform } = params;

  if (sort === "coins") {
    return getLeaderboardByCoins(platform, limit);
  }
  if (sort === "streak") {
    return getLeaderboardByStreak(platform, limit);
  }
  return getLeaderboardByReferrals(platform, limit);
}

async function getLeaderboardByCoins(
  platform: PlatformFilter,
  limit: number
): Promise<LeaderRow[]> {
  const valueExpr =
    platform === "twitch"
      ? userBalances.twitchCoins
      : platform === "kick"
        ? userBalances.kickCoins
        : userBalances.coins;

  const platformJoinCondition =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = u.id AND pa.platform = ${platform})`
      : sql``;

  const rows = await db.execute<{
    user_id: string;
    display_name: string;
    photo_url: string | null;
    value: number;
  }>(sql`
    SELECT
      u.id                                                   AS user_id,
      COALESCE(u.username, u.first_name, 'user')             AS display_name,
      u.photo_url,
      COALESCE(b.${sql.raw(valueExpr.name)}, 0)::int        AS value
    FROM users u
    LEFT JOIN user_balances b ON b.user_id = u.id
    WHERE TRUE ${platformJoinCondition}
    ORDER BY value DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    photoUrl: r.photo_url,
    value: r.value,
  }));
}

async function getLeaderboardByStreak(
  platform: PlatformFilter,
  limit: number
): Promise<LeaderRow[]> {
  const valueExpr =
    platform === "twitch"
      ? sql`s.twitch_current`
      : platform === "kick"
        ? sql`s.kick_current`
        : sql`GREATEST(s.twitch_current, s.kick_current)`;

  const platformJoinCondition =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = u.id AND pa.platform = ${platform})`
      : sql``;

  const rows = await db.execute<{
    user_id: string;
    display_name: string;
    photo_url: string | null;
    value: number;
  }>(sql`
    SELECT
      u.id                                                   AS user_id,
      COALESCE(u.username, u.first_name, 'user')             AS display_name,
      u.photo_url,
      COALESCE(${valueExpr}, 0)::int                         AS value
    FROM users u
    LEFT JOIN user_stream_streaks s ON s.user_id = u.id
    WHERE TRUE ${platformJoinCondition}
    ORDER BY value DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    photoUrl: r.photo_url,
    value: r.value,
  }));
}

async function getLeaderboardByReferrals(
  platform: PlatformFilter,
  limit: number
): Promise<LeaderRow[]> {
  const platformJoinCondition =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = u.id AND pa.platform = ${platform})`
      : sql``;

  const rows = await db.execute<{
    user_id: string;
    display_name: string;
    photo_url: string | null;
    value: number;
  }>(sql`
    SELECT
      u.id                                                   AS user_id,
      COALESCE(u.username, u.first_name, 'user')             AS display_name,
      u.photo_url,
      COALESCE(rc.c, 0)::int                                 AS value
    FROM users u
    LEFT JOIN (
      SELECT referrer_id, count(*)::int AS c FROM referrals GROUP BY referrer_id
    ) rc ON rc.referrer_id = u.id
    WHERE TRUE ${platformJoinCondition}
    ORDER BY value DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    photoUrl: r.photo_url,
    value: r.value,
  }));
}

export async function rankOfUser(
  sort: LeaderSort,
  platform: PlatformFilter,
  userId: string
): Promise<{ rank: number; value: number } | null> {
  if (sort === "coins") {
    return rankOfUserByCoins(platform, userId);
  }
  if (sort === "streak") {
    return rankOfUserByStreak(platform, userId);
  }
  return rankOfUserByReferrals(platform, userId);
}

async function rankOfUserByCoins(
  platform: PlatformFilter,
  userId: string
): Promise<{ rank: number; value: number } | null> {
  const col =
    platform === "twitch"
      ? "twitch_coins"
      : platform === "kick"
        ? "kick_coins"
        : "coins";

  const [me] = await db
    .select({ val: sql<number>`${sql.raw(col)}` })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);
  if (!me) return null;

  const myVal = me.val ?? 0;

  const platformCond =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = user_balances.user_id AND pa.platform = ${platform})`
      : sql``;

  const [{ c }] = (
    await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM user_balances WHERE ${sql.raw(col)} > ${myVal} ${platformCond}`
    )
  ).rows;
  return { rank: Number(c) + 1, value: myVal };
}

async function rankOfUserByStreak(
  platform: PlatformFilter,
  userId: string
): Promise<{ rank: number; value: number } | null> {
  const [me] = await db
    .select()
    .from(userStreamStreaks)
    .where(eq(userStreamStreaks.userId, userId))
    .limit(1);
  if (!me) return null;

  const myVal =
    platform === "twitch"
      ? me.twitchCurrent
      : platform === "kick"
        ? me.kickCurrent
        : Math.max(me.twitchCurrent, me.kickCurrent);

  const valExpr =
    platform === "twitch"
      ? sql`twitch_current`
      : platform === "kick"
        ? sql`kick_current`
        : sql`GREATEST(twitch_current, kick_current)`;

  const platformCond =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = user_stream_streaks.user_id AND pa.platform = ${platform})`
      : sql``;

  const [{ c }] = (
    await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM user_stream_streaks WHERE ${valExpr} > ${myVal} ${platformCond}`
    )
  ).rows;
  return { rank: Number(c) + 1, value: myVal };
}

async function rankOfUserByReferrals(
  platform: PlatformFilter,
  userId: string
): Promise<{ rank: number; value: number } | null> {
  const [me] = (
    await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM referrals WHERE referrer_id = ${userId}`
    )
  ).rows;
  if (!me) return null;
  const myVal = me.c;

  const platformCond =
    platform !== "all"
      ? sql`AND EXISTS (SELECT 1 FROM platform_accounts pa WHERE pa.user_id = r.referrer_id AND pa.platform = ${platform})`
      : sql``;

  const [{ c }] = (
    await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM (SELECT referrer_id, count(*) AS cnt FROM referrals GROUP BY referrer_id) r WHERE r.cnt > ${myVal} ${platformCond}`
    )
  ).rows;
  return { rank: Number(c) + 1, value: myVal };
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
