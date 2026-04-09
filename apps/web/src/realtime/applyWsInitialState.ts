import type { WsInitialStatePayload } from "../hooks/useRealtimeWebSocket";
import { applyWsInitialStateToQueries } from "./realtimeQueryUpdaters";

/** Применяет `initial_state` только в React Query (без локального React state). */
export function applyWsInitialState(data: WsInitialStatePayload): void {
  applyWsInitialStateToQueries(data);
}
