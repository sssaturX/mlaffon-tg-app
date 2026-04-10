import { useQuery } from "@tanstack/react-query";
import { getToken } from "../../api";
import {
  meEconomyQueryFn,
  meProfileQueryFn,
} from "../../query/meQueryFns";
import { queryKeys } from "../../query/queryKeys";

const STALE_ME_PROFILE = 1000 * 60 * 5;
/** Экономика: HTTP только гидратация; дальше WS + setQueryData. */
const STALE_ME_ECONOMY = 1000 * 60 * 10;

export function useMeProfileQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: meProfileQueryFn,
    enabled: enabled && Boolean(getToken()),
    staleTime: STALE_ME_PROFILE,
  });
}

/** Экономика приезжает в том же `GET /me`, что и профиль; отдельный запрос к /me/economy не делаем. */
export function useMeEconomyQuery(enabled: boolean, profileFetchSettled: boolean) {
  return useQuery({
    queryKey: queryKeys.me.economy(),
    queryFn: meEconomyQueryFn,
    enabled: enabled && Boolean(getToken()) && profileFetchSettled,
    staleTime: STALE_ME_ECONOMY,
  });
}
