import type { MeEconomyResponse, MeProfileResponse } from "shared";
import { splitMeResponse } from "shared";
import { fetchMe } from "./fetchers";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "../meDomain/domainVersion";

/** Профиль + экономика одним `GET /me`; экономика дальше только WS + reconcile. */
export async function meProfileQueryFn(): Promise<MeProfileResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const me = await fetchMe();
  const { profile, economy } = splitMeResponse(me);
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile,
    economy,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile()) ?? profile
  );
}

/** Заполняется из того же ответа, что и profile; отдельного HTTP к economy нет. */
export async function meEconomyQueryFn(): Promise<MeEconomyResponse> {
  const cached = queryClient.getQueryData<MeEconomyResponse>(
    queryKeys.me.economy()
  );
  if (cached) return cached;

  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const me = await fetchMe();
  const { profile, economy } = splitMeResponse(me);
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile,
    economy,
    profileV0,
    economyV0,
  });
  return (
    queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy()) ?? economy
  );
}
