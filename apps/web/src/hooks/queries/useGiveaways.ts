import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../api";
import {
  fetchGiveawayDetail,
  fetchGiveawaysList,
} from "../../query/fetchers";
import { queryKeys } from "../../query/queryKeys";

const STALE_GIVEAWAYS_LIST = 1000 * 60 * 5;
const GC_GIVEAWAYS_LIST = 1000 * 60 * 30;
const STALE_GIVEAWAY_DETAIL = 1000 * 60 * 2;
const GC_GIVEAWAY_DETAIL = 1000 * 60 * 15;

/**
 * Список гивэвеев. WS `giveaways_updated` обновляет кэш в реальном времени,
 * HTTP нужен только для начальной загрузки и fallback.
 */
export function useGiveawaysList() {
  return useQuery({
    queryKey: queryKeys.giveaways.list(),
    queryFn: fetchGiveawaysList,
    enabled: Boolean(getToken()),
    staleTime: STALE_GIVEAWAYS_LIST,
    gcTime: GC_GIVEAWAYS_LIST,
  });
}

export function useGiveawayDetail(giveawayId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.giveaways.detail(giveawayId ?? ""),
    queryFn: () => fetchGiveawayDetail(giveawayId!),
    enabled: Boolean(getToken()) && Boolean(giveawayId),
    staleTime: STALE_GIVEAWAY_DETAIL,
    gcTime: GC_GIVEAWAY_DETAIL,
  });
}

export function useInvalidateGiveaways() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.giveaways.list() });
  };
}
