import { fetchMeEconomy } from "../query/fetchers";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "./domainVersion";

/** Одна подтяжка экономики → snapshot в шину (без invalidate). */
export async function pullEconomyOverBus(): Promise<void> {
  const economyV0 = getDomainVersion().economy;
  const profileV0 = getDomainVersion().profile;
  try {
    const economy = await fetchMeEconomy();
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
