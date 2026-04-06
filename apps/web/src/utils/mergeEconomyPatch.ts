import type { MeEconomyPatch, MeResponse } from "shared";

const ECONOMY_NUM_KEYS: (keyof MeEconomyPatch)[] = [
  "coins",
  "coinsTwitch",
  "coinsKick",
  "lifetimeEarned",
  "lifetimeTwitch",
  "lifetimeKick",
  "level",
  "rewardMultiplier",
  "rankProgressPercent",
];

/** Полный валидный срез экономики (ответ API/WS может быть неполным). */
export function isMeEconomyPatch(x: unknown): x is MeEconomyPatch {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!ECONOMY_NUM_KEYS.every((k) => typeof o[k] === "number")) return false;
  if (typeof o.rankTierEmoji !== "string" || typeof o.rankTierLabel !== "string")
    return false;
  if (
    o.rankLifetimeToNext != null &&
    typeof o.rankLifetimeToNext !== "number"
  )
    return false;
  return true;
}

/** Частичный срез экономики по WS (не все поля числа). */
export function pickPartialEconomyFields(data: object): Partial<MeResponse> | null {
  const o = data as Record<string, unknown>;
  const out: Partial<MeResponse> = {};
  let any = false;
  for (const k of ECONOMY_NUM_KEYS) {
    const v = o[k];
    if (typeof v === "number") {
      (out as Record<string, number>)[k] = v;
      any = true;
    }
  }
  if (typeof o.rankTierEmoji === "string") {
    out.rankTierEmoji = o.rankTierEmoji;
    any = true;
  }
  if (typeof o.rankTierLabel === "string") {
    out.rankTierLabel = o.rankTierLabel;
    any = true;
  }
  if (o.rankLifetimeToNext === null || typeof o.rankLifetimeToNext === "number") {
    if (o.rankLifetimeToNext !== undefined) {
      out.rankLifetimeToNext = o.rankLifetimeToNext;
      any = true;
    }
  }
  return any ? out : null;
}

/** Мержит срез экономики из API/WS в `me` (баланс в шапке и т.д.). */
export function mergeEconomyIntoMe(
  patch: MeEconomyPatch
): (prev: MeResponse) => Partial<MeResponse> {
  return (_prev: MeResponse) => ({
    coins: patch.coins,
    coinsTwitch: patch.coinsTwitch,
    coinsKick: patch.coinsKick,
    lifetimeEarned: patch.lifetimeEarned,
    lifetimeTwitch: patch.lifetimeTwitch,
    lifetimeKick: patch.lifetimeKick,
    level: patch.level,
    rewardMultiplier: patch.rewardMultiplier,
    rankTierEmoji: patch.rankTierEmoji,
    rankTierLabel: patch.rankTierLabel,
    rankProgressPercent: patch.rankProgressPercent,
    rankLifetimeToNext: patch.rankLifetimeToNext,
  });
}
