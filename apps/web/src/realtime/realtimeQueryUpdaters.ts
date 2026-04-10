import type { DropSnapshot } from "../components/DropOverlay";
import type {
  DropStartedPayload,
  GiveawaysWsSnapshotPayload,
  PredictionStatePayload,
  WsInitialStatePayload,
} from "../hooks/useRealtimeWebSocket";
import type { HomeGiveawaysResponse } from "shared";
import type { GiveawayListItemDto } from "../query/fetchers";
import type { LiveBroadcastActive } from "../components/LiveBroadcastCard";
import type { LiveBroadcastPublic } from "../store/liveBroadcastStore";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";

function dispatchLiveEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent("mlaffon-live"));
  } catch {
    /* ignore */
  }
}

export function normalizePredictionState(
  prediction: PredictionStatePayload
): PredictionStatePayload | null {
  if (
    prediction.status === "active" ||
    prediction.status === "paused" ||
    prediction.status === "closed" ||
    prediction.status === "resolved"
  ) {
    return prediction;
  }
  return null;
}

export function applyDropStartedToQuery(data: DropStartedPayload): void {
  const snap: DropSnapshot = {
    hasActiveDrop: true,
    dropId: data.dropId,
    endsAt: data.endsAt,
    serverNow: data.serverNow,
    remainingSeconds: data.remainingSeconds,
    platform:
      data.platform === "twitch" ||
      data.platform === "kick" ||
      data.platform === "both"
        ? data.platform
        : undefined,
    maxWinners: data.maxWinners,
    winnersCount: data.winnersCount,
    won: false,
    rewardCoins: null,
  };
  queryClient.setQueryData(queryKeys.drops.active(), snap);
}

export function applyDropFinishedToQuery(dropId: string): void {
  queryClient.setQueryData(queryKeys.drops.active(), (prev: DropSnapshot | undefined) =>
    prev?.hasActiveDrop && prev.dropId === dropId
      ? { hasActiveDrop: false }
      : prev
  );
}

export function applyDropClaimedToQuery(dropId: string, reward: number): void {
  queryClient.setQueryData(queryKeys.drops.active(), (prev: DropSnapshot | undefined) =>
    prev?.hasActiveDrop && prev.dropId === dropId
      ? { ...prev, won: true, rewardCoins: reward }
      : prev
  );
}

export function applyLiveStartedToQuery(data: {
  id: string;
  platform: string;
  streamUrl: string;
  startedAt: string;
  vpnNote?: string | null;
}): void {
  const b: LiveBroadcastActive = {
    active: true,
    id: data.id,
    platform: data.platform === "kick" ? "kick" : "twitch",
    streamUrl: data.streamUrl,
    vpnNote: data.vpnNote ?? null,
    startedAt: data.startedAt,
  };
  queryClient.setQueryData<LiveBroadcastPublic>(
    queryKeys.liveBroadcast.current(),
    b
  );
  dispatchLiveEvent();
}

export function applyLiveEndedToQuery(): void {
  queryClient.setQueryData<LiveBroadcastPublic>(
    queryKeys.liveBroadcast.current(),
    { active: false }
  );
  dispatchLiveEvent();
}

export function applyPredictionStateToQuery(data: PredictionStatePayload): void {
  const normalized = normalizePredictionState(data);
  queryClient.setQueryData(
    queryKeys.predictions.active(),
    normalized
  );
}

export function applyGiveawaysSnapshotToQueries(
  data: GiveawaysWsSnapshotPayload
): void {
  queryClient.setQueryData<HomeGiveawaysResponse>(
    queryKeys.home.giveaways(),
    data.home
  );
  queryClient.setQueryData<GiveawayListItemDto[]>(
    queryKeys.giveaways.list(),
    data.list
  );
}

/** Снимок `initial_state` — единственная запись в кэш, без HTTP. */
export function applyWsInitialStateToQueries(
  data: WsInitialStatePayload
): void {
  if (data.live.active) {
    applyLiveStartedToQuery({
      id: data.live.id,
      platform: data.live.platform,
      streamUrl: data.live.streamUrl,
      startedAt: data.live.startedAt,
      vpnNote: data.live.vpnNote,
    });
  } else {
    applyLiveEndedToQuery();
  }

  queryClient.setQueryData(
    queryKeys.drops.active(),
    data.drop.hasActiveDrop ? data.drop : { hasActiveDrop: false }
  );

  if (data.prediction) {
    applyPredictionStateToQuery(data.prediction);
  } else {
    queryClient.setQueryData(queryKeys.predictions.active(), null);
  }

  if (data.giveaways?.home && Array.isArray(data.giveaways.list)) {
    applyGiveawaysSnapshotToQueries(data.giveaways);
  }
}
