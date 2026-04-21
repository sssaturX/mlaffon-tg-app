import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken } from "../../api";
import { queryKeys } from "../../query/queryKeys";
import { fetchFortuneConfig, fetchFortuneState } from "../../query/fetchers";

const STALE_FORTUNE_CONFIG = 1000 * 60 * 60 * 24;

/**
 * Не 0: иначе каждый второй prefetch (pointerdown + click, двойной intent) и
 * бэк-ту-бэк prefetch+mount дают лишний network при том же queryKey.
 * После спина по-прежнему инвалидируем `fortune.state`.
 */
export const FORTUNE_STATE_STALE_MS = 1000 * 30;

/** STATIC: сегменты колеса и стоимость (из game config). */
export function useFortuneConfig() {
  return useQuery({
    queryKey: queryKeys.fortune.config(),
    queryFn: fetchFortuneConfig,
    /** Сервер: GET /api/v1/games/fortune/config без JWT — параллельно с /me, не ждём токен. */
    staleTime: STALE_FORTUNE_CONFIG,
  });
}

/** SEMI_STATIC / user state: бесплатный спин на дату. */
export function useFortuneState() {
  return useQuery({
    queryKey: queryKeys.fortune.state(),
    queryFn: fetchFortuneState,
    enabled: Boolean(getToken()),
    staleTime: FORTUNE_STATE_STALE_MS,
    gcTime: 1000 * 60 * 15,
  });
}

export function useInvalidateFortuneState() {
  const qc = useQueryClient();
  return () =>
    void qc.invalidateQueries({ queryKey: queryKeys.fortune.state() });
}
