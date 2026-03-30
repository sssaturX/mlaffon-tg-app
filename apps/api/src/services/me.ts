import { count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  platformAccounts,
  referrals,
  userBalances,
  users,
} from "../db/schema.js";
import { computeLevel, computeRewardMultiplier } from "../config.js";
import { ensureStreamStreakRow } from "./streamStreak.js";

export async function buildMeResponse(userId: string): Promise<{
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  coins: number;
  lifetimeEarned: number;
  level: number;
  rewardMultiplier: number;
  /** Макс. из двух платформенных стриков (для совместимости и топа). */
  streak: number;
  streakTwitch: number;
  streakKick: number;
  referralCode: string;
  referralLink: string;
  referralCount: number;
  platforms: {
    twitch: "connected" | "not_connected";
    kick: "connected" | "not_connected";
  };
}> {
  const streamStreak = await ensureStreamStreakRow(userId);

  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("user_not_found");

  const [b] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);

  const [{ c }] = await db
    .select({ c: count() })
    .from(referrals)
    .where(eq(referrals.referrerId, userId));

  const pRows = await db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.userId, userId));

  const has = (p: string) =>
    pRows.some((r) => r.platform === p) ? "connected" : "not_connected";

  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "YOUR_BOT";
  const referralLink = `https://t.me/${bot}?start=ref_${u.referralCode}`;

  const lifetimeEarned = b?.lifetimeEarned ?? 0;
  const level = computeLevel(lifetimeEarned);

  const streakTwitch = streamStreak.twitch;
  const streakKick = streamStreak.kick;
  const streak = Math.max(streakTwitch, streakKick);

  return {
    id: u.id,
    telegramId: u.telegramId.toString(),
    username: u.username,
    firstName: u.firstName,
    photoUrl: u.photoUrl,
    coins: b?.coins ?? 0,
    lifetimeEarned,
    level,
    rewardMultiplier: computeRewardMultiplier(level),
    streak,
    streakTwitch,
    streakKick,
    referralCode: u.referralCode,
    referralLink,
    referralCount: Number(c),
    platforms: {
      twitch: has("twitch"),
      kick: has("kick"),
    },
  };
}
