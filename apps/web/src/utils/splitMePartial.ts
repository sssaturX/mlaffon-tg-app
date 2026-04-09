import type { MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";

const PROFILE_KEYS = new Set<keyof MeResponse>([
  "id",
  "telegramId",
  "email",
  "username",
  "firstName",
  "photoUrl",
  "referralCode",
  "referralLinkMiniApp",
  "referralLinkWeb",
  "referralLink",
  "referralCount",
  "platforms",
  "banned",
  "banReason",
  "banAppealPending",
  "leaderboardRankCoins",
]);

const ECONOMY_KEYS = new Set<keyof MeResponse>([
  "coins",
  "coinsTwitch",
  "coinsKick",
  "lifetimeEarned",
  "lifetimeTwitch",
  "lifetimeKick",
  "level",
  "rewardMultiplier",
  "streak",
  "streakTwitch",
  "streakKick",
]);

/** Разнести клиентский патч по срезам profile / economy для setQueryData. */
export function splitMePartial(
  partial: Partial<MeResponse>
): {
  profile: Partial<MeProfileResponse>;
  economy: Partial<MeEconomyResponse>;
} {
  const profile: Partial<MeProfileResponse> = {};
  const economy: Partial<MeEconomyResponse> = {};
  for (const [k, v] of Object.entries(partial) as [
    keyof MeResponse,
    unknown,
  ][]) {
    if (v === undefined) continue;
    if (PROFILE_KEYS.has(k)) {
      (profile as Record<string, unknown>)[k] = v;
    }
    if (ECONOMY_KEYS.has(k)) {
      (economy as Record<string, unknown>)[k] = v;
    }
  }
  return { profile, economy };
}
