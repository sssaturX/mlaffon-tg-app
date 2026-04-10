import type { DropSnapshot } from "../components/DropOverlay";
import type { PredictionStatePayload } from "../hooks/useRealtimeWebSocket";
import type { LiveBroadcastPublic } from "../store/liveBroadcastStore";

/**
 * React Query держит эти ключи в кэше, но заполняет их только `initial_state` и WS.
 * `queryFn` не должен вызываться (`enabled: false`); при ошибочном refetch — явный сбой.
 */
export async function liveBroadcastWsOnlyQueryFn(): Promise<LiveBroadcastPublic> {
  throw new Error(
    "live-broadcast: HTTP отключён, данные только из WebSocket"
  );
}

export async function dropsActiveWsOnlyQueryFn(): Promise<DropSnapshot> {
  throw new Error("drops/active: HTTP отключён, данные только из WebSocket");
}

export async function predictionsActiveWsOnlyQueryFn(): Promise<PredictionStatePayload | null> {
  throw new Error(
    "predictions/active: HTTP отключён, данные только из WebSocket"
  );
}
