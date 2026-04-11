import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../query/queryKeys";
import { fetchHomeContent, fetchHomeGiveaways } from "../../query/fetchers";

const STALE_HOME_CONTENT = 1000 * 60 * 30;
const GC_HOME_CONTENT = 1000 * 60 * 60;
const STALE_HOME_GIVEAWAYS = 1000 * 60 * 5;
const GC_HOME_GIVEAWAYS = 1000 * 60 * 30;

/** STATIC / rarely changes: FAQ. */
export function useHomeContent() {
  return useQuery({
    queryKey: queryKeys.home.content(),
    queryFn: fetchHomeContent,
    staleTime: STALE_HOME_CONTENT,
    gcTime: GC_HOME_CONTENT,
  });
}

/**
 * SEMI_STATIC: список розыгрышей и счётчики участников.
 * WS `giveaways_updated` pushes updates in real-time,
 * so HTTP is only a fallback / initial load.
 */
export function useHomeGiveaways() {
  return useQuery({
    queryKey: queryKeys.home.giveaways(),
    queryFn: fetchHomeGiveaways,
    staleTime: STALE_HOME_GIVEAWAYS,
    gcTime: GC_HOME_GIVEAWAYS,
  });
}
