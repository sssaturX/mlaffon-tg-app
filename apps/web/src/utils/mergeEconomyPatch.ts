import type { MeEconomyPatch, MeResponse } from "shared";

const ECONOMY_PATCH_KEYS: (keyof MeEconomyPatch)[] = [
  "coins",
  "coinsTwitch",
  "coinsKick",
  "lifetimeEarned",
  "lifetimeTwitch",
  "lifetimeKick",
  "level",
  "rewardMultiplier",
];

/** Полный валидный срез экономики (ответ API/WS может быть неполным). */
export function isMeEconomyPatch(patch: unknown): patch is MeEconomyPatch {
  if (!patch || typeof patch !== "object") return false;
  const p = patch as Record<string, unknown>;
  return ECONOMY_PATCH_KEYS.every((k) => typeof p[k] === "number");
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
  });
}
