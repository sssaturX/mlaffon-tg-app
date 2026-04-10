import { useMemo } from "react";
import {
  mergeMeProfileAndEconomy,
  type MeEconomyResponse,
  type MeProfileResponse,
  type MeResponse,
} from "shared";
import { getToken } from "../../api";
import { queryClient } from "../../query/queryClient";
import { queryKeys } from "../../query/queryKeys";
import { useMeEconomyQuery, useMeProfileQuery } from "./useMeQueries";

export function getMeFromCache(): MeResponse | null {
  const p = queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile());
  const e = queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy());
  if (!p || !e) return null;
  return mergeMeProfileAndEconomy(p, e);
}

/**
 * Единый срез пользователя из React Query (без zustand).
 */
export function useMergedMe() {
  const enabled = Boolean(getToken());
  const profileQ = useMeProfileQuery(enabled);
  const profileFetchSettled =
    profileQ.isSuccess || profileQ.isError || profileQ.isFetched;
  const economyQ = useMeEconomyQuery(enabled, profileFetchSettled);

  const me: MeResponse | null = useMemo(() => {
    if (!profileQ.data || !economyQ.data) return null;
    return mergeMeProfileAndEconomy(profileQ.data, economyQ.data);
  }, [profileQ.data, economyQ.data]);

  const isInitialLoading =
    enabled &&
    me === null &&
    !profileQ.isError &&
    !economyQ.isError &&
    (profileQ.isPending ||
      (profileQ.isSuccess && economyQ.isPending) ||
      profileQ.data === undefined ||
      (profileQ.isSuccess && economyQ.data === undefined));

  return {
    me,
    isInitialLoading,
    profileQ,
    economyQ,
  };
}
