import type { MeEconomyResponse, MeProfileResponse } from "shared";
import { fetchMeEconomy, fetchMeProfile } from "./fetchers";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "../meDomain/domainVersion";

/** Профиль без «тяжёлого» объединённого `GET /me` — экономика отдельно и по WS. */
export async function meProfileQueryFn(): Promise<MeProfileResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const profile = await fetchMeProfile();
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile()) ?? profile
  );
}

export async function meEconomyQueryFn(): Promise<MeEconomyResponse> {
  const cached = queryClient.getQueryData<MeEconomyResponse>(
    queryKeys.me.economy()
  );
  if (cached) return cached;

  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const economy = await fetchMeEconomy();
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    economy,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy()) ?? economy
  );
}
