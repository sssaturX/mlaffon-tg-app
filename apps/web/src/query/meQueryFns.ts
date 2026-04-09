import type { MeEconomyResponse, MeProfileResponse } from "shared";
import { fetchMeEconomy, fetchMeProfile } from "./fetchers";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { getEconomyEpoch, getProfileEpoch } from "./meSyncEpoch";

export async function meProfileQueryFn(): Promise<MeProfileResponse> {
  const e0 = getProfileEpoch();
  const data = await fetchMeProfile();
  if (e0 !== getProfileEpoch()) {
    const cached = queryClient.getQueryData<MeProfileResponse>(
      queryKeys.me.profile()
    );
    if (cached) return cached;
  }
  return data;
}

export async function meEconomyQueryFn(): Promise<MeEconomyResponse> {
  const e0 = getEconomyEpoch();
  const data = await fetchMeEconomy();
  if (e0 !== getEconomyEpoch()) {
    const cached = queryClient.getQueryData<MeEconomyResponse>(
      queryKeys.me.economy()
    );
    if (cached) return cached;
  }
  return data;
}
