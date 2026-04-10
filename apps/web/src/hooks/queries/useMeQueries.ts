import { useQuery } from "@tanstack/react-query";
import { getToken } from "../../api";
import {
  meEconomyQueryFn,
  meProfileQueryFn,
} from "../../query/meQueryFns";
import { queryKeys } from "../../query/queryKeys";

const STALE_ME_PROFILE = 1000 * 60 * 5;
const GC_ME_PROFILE = 1000 * 60 * 30;
/** Экономика: HTTP только bootstrap; дальше WS + reconcile при офлайне. */
const STALE_ME_ECONOMY = 1000 * 60 * 10;
const GC_ME_ECONOMY = 1000 * 60 * 30;

export function useMeProfileQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: meProfileQueryFn,
    enabled: enabled && Boolean(getToken()),
    staleTime: STALE_ME_PROFILE,
    gcTime: GC_ME_PROFILE,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** После профиля — `GET /me/economy` или кэш; дальше только WS. */
export function useMeEconomyQuery(enabled: boolean, profileFetchSettled: boolean) {
  return useQuery({
    queryKey: queryKeys.me.economy(),
    queryFn: meEconomyQueryFn,
    enabled: enabled && Boolean(getToken()) && profileFetchSettled,
    staleTime: STALE_ME_ECONOMY,
    gcTime: GC_ME_ECONOMY,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
