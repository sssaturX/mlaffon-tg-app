import { getLastBroadcastSeq } from "../lib/realtimeSeq.js";
import { getActiveDropSnapshot } from "./drops.js";
import {
  buildGiveawaysWsSnapshot,
  type GiveawaysWsSnapshot,
} from "./giveawaysRealtime.js";
import { getActiveLiveBroadcast } from "./liveBroadcast.js";
import { getActivePrediction } from "./predictions.js";
import { WS_EVENT_VERSION } from "../events/domainEvents.js";

export type WsInitialStateEvent = {
  type: "initial_state";
  v: typeof WS_EVENT_VERSION;
  /** Монотонный номер последнего broadcast-события (Redis). Клиент сверяет с `seq` на событиях. */
  broadcastSeq: number;
  data: {
    serverNow: string;
    live:
      | { active: false }
      | {
          active: true;
          id: string;
          platform: string;
          streamUrl: string;
          vpnNote: string | null;
          startedAt: string;
        };
    drop: Awaited<ReturnType<typeof getActiveDropSnapshot>>;
    prediction: Awaited<ReturnType<typeof getActivePrediction>>;
    giveaways: GiveawaysWsSnapshot;
  };
};

export async function buildWsInitialState(userId: string): Promise<WsInitialStateEvent> {
  const serverNow = new Date().toISOString();
  const [broadcastSeq, liveRow, drop, prediction, giveaways] = await Promise.all([
    getLastBroadcastSeq(),
    getActiveLiveBroadcast(),
    getActiveDropSnapshot(userId),
    getActivePrediction(userId),
    buildGiveawaysWsSnapshot(),
  ]);

  const live = liveRow
    ? {
        active: true as const,
        id: liveRow.id,
        platform: liveRow.platform,
        streamUrl: liveRow.streamUrl,
        vpnNote: liveRow.vpnNote ?? null,
        startedAt: liveRow.startedAt.toISOString(),
      }
    : { active: false as const };

  return {
    type: "initial_state",
    v: WS_EVENT_VERSION,
    broadcastSeq,
    data: {
      serverNow,
      live,
      drop,
      prediction,
      giveaways,
    },
  };
}
