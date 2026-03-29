import { count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  platformAccounts,
  referrals,
  userBalances,
  userStreaks,
  users,
} from "../db/schema.js";
import { computeLevel, computeRewardMultiplier } from "../config.js";
import { touchActivityAndStreak } from "./streak.js";

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
  streak: number;
  referralCode: string;
  referralLink: string;
  referralCount: number;
  platforms: {
    twitch: "connected" | "not_connected";
    kick: "connected" | "not_connected";
  };
}> {
  await touchActivityAndStreak(userId);

  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("user_not_found");

  const [b] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);
  const [s] = await db
    .select()
    .from(userStreaks)
    .where(eq(userStreaks.userId, userId))
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
    streak: s?.currentStreak ?? 0,
    referralCode: u.referralCode,
    referralLink,
    referralCount: Number(c),
    platforms: {
      twitch: has("twitch"),
      kick: has("kick"),
    },
  };
}
