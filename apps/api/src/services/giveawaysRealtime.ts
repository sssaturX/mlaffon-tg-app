import type { HomeGiveawaysResponse } from "shared";
import { buildHomeGiveawaysResponse } from "./homePublic.js";
import { listGiveawaysPublic, type GiveawayListItem } from "./giveaways.js";
import { publishBroadcastEvent } from "./realtimePublish.js";

export type GiveawaysWsSnapshot = {
  home: HomeGiveawaysResponse;
  list: GiveawayListItem[];
};

export async function buildGiveawaysWsSnapshot(): Promise<GiveawaysWsSnapshot> {
  const [home, list] = await Promise.all([
    buildHomeGiveawaysResponse(),
    listGiveawaysPublic(),
  ]);
  return { home, list };
}

/** После изменений розыгрышей — один broadcast для главной и списка `/giveaways`. */
export async function publishGiveawaysRealtimeSnapshot(): Promise<void> {
  const data = await buildGiveawaysWsSnapshot();
  await publishBroadcastEvent({
    type: "giveaways_updated",
    v: 1,
    data,
  });
}
