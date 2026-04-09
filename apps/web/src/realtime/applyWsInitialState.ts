import type { Dispatch, SetStateAction } from "react";
import type { DropSnapshot } from "../components/DropOverlay";
import type { WsInitialStatePayload } from "../hooks/useRealtimeWebSocket";
import { useLiveBroadcastStore } from "../store/liveBroadcastStore";
import { usePredictionStore } from "../store/predictionStore";

/** Единая точка применения снимка после `initial_state` по WS. */
export function applyWsInitialState(
  data: WsInitialStatePayload,
  setDropSnap: Dispatch<SetStateAction<DropSnapshot | null>>
): void {
  if (data.live.active) {
    useLiveBroadcastStore.getState().applyLiveStartedFromWs({
      id: data.live.id,
      platform: data.live.platform,
      streamUrl: data.live.streamUrl,
      startedAt: data.live.startedAt,
      vpnNote: data.live.vpnNote,
    });
  } else {
    useLiveBroadcastStore.getState().applyLiveEndedFromWs();
  }

  setDropSnap(
    data.drop.hasActiveDrop ? data.drop : { hasActiveDrop: false }
  );

  if (data.prediction) {
    usePredictionStore.getState().applyFromWs(data.prediction);
  } else {
    usePredictionStore.setState({ prediction: null });
  }
}
