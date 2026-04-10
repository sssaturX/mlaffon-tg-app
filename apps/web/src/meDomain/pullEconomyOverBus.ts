import { splitMeResponse } from "shared";
import { fetchMe } from "../query/fetchers";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "./domainVersion";

/** Подтяжка экономики через полный `/me` (отдельного роута economy нет). */
export async function pullEconomyOverBus(): Promise<void> {
  const economyV0 = getDomainVersion().economy;
  const profileV0 = getDomainVersion().profile;
  try {
    const me = await fetchMe();
    const { economy } = splitMeResponse(me);
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
