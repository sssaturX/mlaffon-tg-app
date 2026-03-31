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
import { hasPendingBanAppeal } from "./banAppeals.js";

export async function buildMeResponse(userId: string): Promise<{
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  coins: number;
  coinsTwitch: number;
  coinsKick: number;
  lifetimeEarned: number;
  lifetimeTwitch: number;
  lifetimeKick: number;
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
    twitch:
      | { status: "not_connected" }
      | {
          status: "connected";
          displayName: string | null;
          avatarUrl: string | null;
        };
    kick:
      | { status: "not_connected" }
      | {
          status: "connected";
          displayName: string | null;
          avatarUrl: string | null;
        };
  };
  banned: boolean;
  banReason: string | null;
  banAppealPending: boolean;
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

  const row = (p: string) => pRows.find((r) => r.platform === p);
  const platformDto = (
    p: string
  ):
    | { status: "not_connected" }
    | {
        status: "connected";
        displayName: string | null;
        avatarUrl: string | null;
      } => {
    const r = row(p);
    if (!r) return { status: "not_connected" };
    return {
      status: "connected",
      displayName: r.displayName ?? null,
      avatarUrl: r.avatarUrl ?? null,
    };
  };

  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "YOUR_BOT";
  const referralLink = `https://t.me/${bot}?start=ref_${u.referralCode}`;

  const coinsTwitch = b?.twitchCoins ?? 0;
  const coinsKick = b?.kickCoins ?? 0;
  const lifetimeTwitch = b?.twitchLifetimeEarned ?? 0;
  const lifetimeKick = b?.kickLifetimeEarned ?? 0;
  const lifetimeEarned = lifetimeTwitch + lifetimeKick;
  const coins = coinsTwitch + coinsKick;
  const level = computeLevel(lifetimeEarned);

  const streakTwitch = streamStreak.twitch;
  const streakKick = streamStreak.kick;
  const streak = Math.max(streakTwitch, streakKick);

  const banned = u.banned === true;
  const banAppealPending = banned ? await hasPendingBanAppeal(userId) : false;

  return {
    id: u.id,
    telegramId: u.telegramId.toString(),
    username: u.username,
    firstName: u.firstName,
    photoUrl: u.photoUrl,
    coins,
    coinsTwitch,
    coinsKick,
    lifetimeEarned,
    lifetimeTwitch,
    lifetimeKick,
    level,
    rewardMultiplier: computeRewardMultiplier(level),
    streak,
    streakTwitch,
    streakKick,
    referralCode: u.referralCode,
    referralLink,
    referralCount: Number(c),
    platforms: {
      twitch: platformDto("twitch"),
      kick: platformDto("kick"),
    },
    banned,
    banReason: u.banReason ?? null,
    banAppealPending,
  };
}
