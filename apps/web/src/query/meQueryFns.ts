import type { MeEconomyResponse, MeProfileResponse } from "shared";
import { fetchMeEconomy, fetchMeProfile } from "./fetchers";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "../meDomain/domainVersion";

export async function meProfileQueryFn(): Promise<MeProfileResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const data = await fetchMeProfile();
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile: data,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile()) ?? data
  );
}

export async function meEconomyQueryFn(): Promise<MeEconomyResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const data = await fetchMeEconomy();
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    economy: data,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy()) ?? data
  );
}
