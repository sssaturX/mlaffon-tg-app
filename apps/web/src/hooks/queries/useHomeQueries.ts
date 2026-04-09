import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../query/queryKeys";
import { fetchHomeContent, fetchHomeGiveaways } from "../../query/fetchers";

const STALE_HOME_CONTENT = 1000 * 60 * 30;
const STALE_HOME_GIVEAWAYS = 1000 * 60 * 2;

/** STATIC / rarely changes: FAQ, cashback block. */
export function useHomeContent() {
  return useQuery({
    queryKey: queryKeys.home.content(),
    queryFn: fetchHomeContent,
    staleTime: STALE_HOME_CONTENT,
  });
}

/** SEMI_STATIC: список розыгрышей и счётчики участников. */
export function useHomeGiveaways() {
  return useQuery({
    queryKey: queryKeys.home.giveaways(),
    queryFn: fetchHomeGiveaways,
    staleTime: STALE_HOME_GIVEAWAYS,
  });
}
