import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../api";
import {
  fetchGiveawayDetail,
  fetchGiveawaysList,
} from "../../query/fetchers";
import { queryKeys } from "../../query/queryKeys";

const STALE_GIVEAWAYS_LIST = 1000 * 60 * 2;
const STALE_GIVEAWAY_DETAIL = 1000 * 60 * 1;

export function useGiveawaysList() {
  return useQuery({
    queryKey: queryKeys.giveaways.list(),
    queryFn: fetchGiveawaysList,
    enabled: Boolean(getToken()),
    staleTime: STALE_GIVEAWAYS_LIST,
  });
}

export function useGiveawayDetail(giveawayId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.giveaways.detail(giveawayId ?? ""),
    queryFn: () => fetchGiveawayDetail(giveawayId!),
    enabled: Boolean(getToken()) && Boolean(giveawayId),
    staleTime: STALE_GIVEAWAY_DETAIL,
  });
}

export function useInvalidateGiveaways() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.giveaways.list() });
  };
}
