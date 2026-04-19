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
import type {
  MeEconomyPatch,
  MeEconomyResponse,
  MeProfileResponse,
  MeResponse,
} from "shared";

export async function buildMeProfileResponse(
  userId: string
): Promise<MeProfileResponse> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("user_not_found");

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
  const referralLinkMiniApp = `https://t.me/${bot}?startapp=ref_${u.referralCode}`;
  const baseWeb = (process.env.PUBLIC_WEB_URL ?? "http://localhost:5173").replace(
    /\/$/,
    ""
  );
  const referralLinkWeb = `${baseWeb}/?ref=${encodeURIComponent(u.referralCode)}`;
  const referralLink = referralLinkMiniApp;

  const banned = u.banned === true;
  const banAppealPending = banned ? await hasPendingBanAppeal(userId) : false;

  return {
    id: u.id,
    telegramId: u.telegramId != null ? u.telegramId.toString() : null,
    email: u.email ?? null,
    username: u.username,
    firstName: u.firstName,
    photoUrl: u.photoUrl,
    referralCode: u.referralCode,
    referralLinkMiniApp,
    referralLinkWeb,
    referralLink,
    referralCount: Number(c),
    platforms: {
      twitch: platformDto("twitch"),
      kick: platformDto("kick"),
    },
    banned,
    banReason: u.banReason ?? null,
    banAppealPending,
    leaderboardRankCoins: null,
  };
}

export async function buildMeEconomyResponse(
  userId: string
): Promise<MeEconomyResponse> {
  const [streamStreak, balRows] = await Promise.all([
    ensureStreamStreakRow(userId),
    db
      .select()
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1),
  ]);
  const b = balRows[0];
  if (!b) throw new Error("user_not_found");

  const coinsTwitch = b.twitchCoins ?? 0;
  const coinsKick = b.kickCoins ?? 0;
  const lifetimeTwitch = b.twitchLifetimeEarned ?? 0;
  const lifetimeKick = b.kickLifetimeEarned ?? 0;
  const lifetimeEarned = lifetimeTwitch + lifetimeKick;
  const coins = coinsTwitch + coinsKick;
  const level = computeLevel(lifetimeEarned);

  const streakTwitch = streamStreak.twitch;
  const streakKick = streamStreak.kick;
  const streak = Math.max(streakTwitch, streakKick);

  return {
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
  };
}

export async function buildMeResponse(userId: string): Promise<MeResponse> {
  const [profile, economy] = await Promise.all([
    buildMeProfileResponse(userId),
    buildMeEconomyResponse(userId),
  ]);
  return { ...profile, ...economy };
}

export async function buildMeEconomyPatch(userId: string): Promise<MeEconomyPatch> {
  const streamStreak = await ensureStreamStreakRow(userId);
  const [b] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);
  if (!b) throw new Error("user_not_found");
  const coinsTwitch = b.twitchCoins ?? 0;
  const coinsKick = b.kickCoins ?? 0;
  const lifetimeTwitch = b.twitchLifetimeEarned ?? 0;
  const lifetimeKick = b.kickLifetimeEarned ?? 0;
  const lifetimeEarned = lifetimeTwitch + lifetimeKick;
  const coins = coinsTwitch + coinsKick;
  const level = computeLevel(lifetimeEarned);
  const streakTwitch = streamStreak.twitch;
  const streakKick = streamStreak.kick;
  const streak = Math.max(streakTwitch, streakKick);
  return {
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
  };
}
