import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import {
  fetchDropActive,
  fetchLiveBroadcast,
  fetchPredictionsActive,
} from "../query/fetchers";

/**
 * Параллельный HTTP catch-up для realtime-сущностей (нет WS / gap / initial_state missing).
 * Один владелец данных — React Query.
 */
export async function syncRealtimeHttpCatchUp(): Promise<void> {
  await Promise.all([
    queryClient.fetchQuery({
      queryKey: queryKeys.drops.active(),
      queryFn: fetchDropActive,
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.liveBroadcast.current(),
      queryFn: fetchLiveBroadcast,
    }),
    queryClient.fetchQuery({
      queryKey: queryKeys.predictions.active(),
      queryFn: fetchPredictionsActive,
    }),
  ]);
}
