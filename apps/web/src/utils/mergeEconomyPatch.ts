import type { MeEconomyPatch, MeResponse } from "shared";

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
