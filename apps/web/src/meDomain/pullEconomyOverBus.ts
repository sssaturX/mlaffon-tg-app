import type { MeEconomyResponse } from "shared";
import { fetchMeEconomy } from "../query/fetchers";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "./domainVersion";

export async function pullEconomyOverBus(): Promise<void> {
  const cached = queryClient.getQueryData<MeEconomyResponse>(
    queryKeys.me.economy()
  );
  const state = queryClient.getQueryState(queryKeys.me.economy());
  if (cached && state?.dataUpdatedAt && Date.now() - state.dataUpdatedAt < 10_000) {
    return;
  }

  const economyV0 = getDomainVersion().economy;
  const profileV0 = getDomainVersion().profile;
  try {
    const economy = await fetchMeEconomy();
    if (getDomainVersion().economy !== economyV0) return;
    appEventBus.emit("me:update", {
      kind: "http_snapshot",
      source: "http",
      economy,
      profileV0,
      economyV0,
    });
  } catch {
    /* сеть — тихо; пользователь увидит старый кэш */
  }
}
