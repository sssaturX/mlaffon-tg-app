import type { MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";
import { mergeMeProfileAndEconomy, splitMeResponse } from "shared";
import { setToken } from "../api";
import {
  fetchMe,
  fetchMeEconomy,
  fetchMeNoCache,
  fetchMeProfile,
  fetchMeProfileNoCache,
} from "./fetchers";
import { ApiQueryError } from "./apiQueryError";
import { queryClient } from "./queryClient";
import { queryKeys } from "./queryKeys";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "../meDomain/domainVersion";
import { looksLikeTelegramMiniApp } from "../utils/waitForTelegramInitData";

function reactToMeUnauthorized(): void {
  setToken(null);
  appEventBus.emit("me:update", { kind: "clear", reason: "auth_error" });
  queryClient.removeQueries({ queryKey: queryKeys.me.all });
  if (
    import.meta.env.VITE_ALLOW_WEB_AUTH !== "0" &&
    !looksLikeTelegramMiniApp()
  ) {
    appEventBus.emit("auth:web_login_required", {});
  }
}

async function guardMeUnauthorized<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiQueryError && e.apiErr.status === 401) {
      reactToMeUnauthorized();
    }
    throw e;
  }
}

/** Bootstrap: один `GET /api/v1/me` → кэши profile + economy + событие домена. */
export async function meSessionQueryFn(): Promise<MeResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const full = await guardMeUnauthorized(() => fetchMe());
  const { profile, economy } = splitMeResponse(full);
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile,
    economy,
    profileV0,
    economyV0,
  });
  const p =
    queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile()) ?? profile;
  const e =
    queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy()) ?? economy;
  return mergeMeProfileAndEconomy(p, e);
}

/** После OAuth в Telegram — тот же ответ, без кэша HTTP. */
export async function meSessionQueryFnNoCache(): Promise<MeResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const full = await guardMeUnauthorized(() => fetchMeNoCache());
  const { profile, economy } = splitMeResponse(full);
  appEventBus.emit("me:update", {
    kind: "http_snapshot",
    source: "http",
    profile,
    economy,
    profileV0,
    economyV0,
  });
  const p =
    queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile()) ?? profile;
  const e =
    queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy()) ?? economy;
  return mergeMeProfileAndEconomy(p, e);
}

/** Профиль без «тяжёлого» объединённого `GET /me` — экономика отдельно и по WS. */
export async function meProfileQueryFn(): Promise<MeProfileResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const profile = await guardMeUnauthorized(() => fetchMeProfile());
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

/**
 * Обходит HTTP-кэш браузера. Используется при возврате после OAuth
 * (startapp=oauth_ok), когда браузерный max-age ещё не истёк,
 * а на сервере профиль уже содержит привязанную платформу.
 */
export async function meProfileQueryFnNoCache(): Promise<MeProfileResponse> {
  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;
  const profile = await guardMeUnauthorized(() => fetchMeProfileNoCache());
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
  const economy = await guardMeUnauthorized(() => fetchMeEconomy());
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
