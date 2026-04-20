import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  mergeMeProfileAndEconomy,
  type MeEconomyResponse,
  type MeProfileResponse,
  type MeResponse,
} from "shared";
import { getToken } from "../../api";
import { queryClient } from "../../query/queryClient";
import { queryKeys } from "../../query/queryKeys";
import {
  meEconomyQueryFn,
  meProfileQueryFn,
  meSessionQueryFn,
} from "../../query/meQueryFns";

const STALE_ME_SESSION = 1000 * 60 * 5;
const GC_ME_SESSION = 1000 * 60 * 30;

export function getMeFromCache(): MeResponse | null {
  const p = queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile());
  const e = queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy());
  if (!p || !e) return null;
  return mergeMeProfileAndEconomy(p, e);
}

/**
 * Единый срез пользователя из React Query (без zustand).
 * Bootstrap: один `GET /api/v1/me` (ключ session). Профиль/экономика в кэше
 * обновляются по WS и reconcile — подписка через queryKey без лишних fetch.
 */
/**
 * @param sessionBootstrapReady — пока false (например, ждём Telegram initData/auth),
 * не дергаем `GET /me`, чтобы старый JWT не давал 401 до обмена initData.
 */
export function useMergedMe(sessionBootstrapReady: boolean) {
  const enabled = Boolean(getToken()) && sessionBootstrapReady;

  const sessionQ = useQuery({
    queryKey: queryKeys.me.session(),
    queryFn: meSessionQueryFn,
    enabled,
    staleTime: STALE_ME_SESSION,
    gcTime: GC_ME_SESSION,
  });

  const profileQ = useQuery({
    queryKey: queryKeys.me.profile(),
    queryFn: meProfileQueryFn,
    enabled: false,
  });
  const economyQ = useQuery({
    queryKey: queryKeys.me.economy(),
    queryFn: meEconomyQueryFn,
    enabled: false,
  });

  const me: MeResponse | null = useMemo(() => {
    if (!profileQ.data || !economyQ.data) return null;
    return mergeMeProfileAndEconomy(profileQ.data, economyQ.data);
  }, [profileQ.data, economyQ.data]);

  return {
    me,
    sessionQ,
    profileQ,
    economyQ,
  };
}
