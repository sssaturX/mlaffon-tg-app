import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../api";
import { queryKeys } from "../../query/queryKeys";
import { fetchFortuneConfig, fetchFortuneState } from "../../query/fetchers";

const STALE_FORTUNE_CONFIG = 1000 * 60 * 60 * 24;

/** STATIC: сегменты колеса и стоимость (из game config). */
export function useFortuneConfig() {
  return useQuery({
    queryKey: queryKeys.fortune.config(),
    queryFn: fetchFortuneConfig,
    enabled: Boolean(getToken()),
    staleTime: STALE_FORTUNE_CONFIG,
  });
}

/** SEMI_STATIC / user state: бесплатный спин на дату. */
export function useFortuneState() {
  return useQuery({
    queryKey: queryKeys.fortune.state(),
    queryFn: fetchFortuneState,
    enabled: Boolean(getToken()),
    staleTime: 0,
    gcTime: 1000 * 60 * 15,
  });
}

export function useInvalidateFortuneState() {
  const qc = useQueryClient();
  return () =>
    void qc.invalidateQueries({ queryKey: queryKeys.fortune.state() });
}
