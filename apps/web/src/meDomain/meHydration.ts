import type { MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";
import { mergeMeProfileAndEconomy, splitMeResponse } from "shared";
import { formatApiError, getToken, setToken } from "../api";
import { ApiQueryError } from "../query/apiQueryError";
import { fetchMe, fetchMeProfileNoCache } from "../query/fetchers";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { getMeFromCache } from "../hooks/queries/useMergedMe";
import { appEventBus } from "../events/appEventBus";
import { getDomainVersion } from "./domainVersion";

type ShowToast = (
  message: string,
  variant?: "info" | "success" | "error",
  third?: number | { durationMs?: number; streak?: boolean }
) => void;

const HYDRATE_SKIP_IF_FRESH_MS = 5_000;

/**
 * Bootstrap / retry / OAuth: параллельный HTTP → только через `me:update` snapshot.
 * Не пишет кэш напрямую.
 * Пропускает HTTP, если оба кэша свежие (WS недавно обновил).
 */
export async function hydrateMeThroughEventBus(
  showToast?: ShowToast
): Promise<MeResponse | null> {
  if (!getToken()) {
    appEventBus.emit("me:update", { kind: "clear", reason: "logout" });
    return null;
  }

  const cachedMe = getMeFromCache();
  if (cachedMe) {
    const profileState = queryClient.getQueryState(queryKeys.me.profile());
    const economyState = queryClient.getQueryState(queryKeys.me.economy());
    const now = Date.now();
    const profileFresh =
      profileState?.dataUpdatedAt &&
      now - profileState.dataUpdatedAt < HYDRATE_SKIP_IF_FRESH_MS;
    const economyFresh =
      economyState?.dataUpdatedAt &&
      now - economyState.dataUpdatedAt < HYDRATE_SKIP_IF_FRESH_MS;
    if (profileFresh && economyFresh) return cachedMe;
  }

  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;

  try {
    const full = await fetchMe();
    const { profile, economy } = splitMeResponse(full);

    appEventBus.emit("me:update", {
      kind: "http_snapshot",
      source: "http",
      profile,
      economy,
      profileV0,
      economyV0,
    });
    return getMeFromCache();
  } catch (e) {
    if (e instanceof ApiQueryError) {
      const r = e.apiErr;
      if (r.networkError) {
        showToast?.(formatApiError(r), "error");
        return getMeFromCache();
      }
      appEventBus.emit("me:update", { kind: "clear", reason: "auth_error" });
      setToken(null);
      showToast?.(formatApiError(r), "error");
      return null;
    }
    throw e;
  }
}

/**
 * Лёгкая гидратация: только `GET /me/profile`, economy из кэша.
 * Используется в циклах ожидания (OAuth link polling),
 * где economy не нужна — нужен только обновлённый список платформ.
 * Принудительно обходит HTTP-кэш браузера (no-store),
 * чтобы не получить устаревший ответ из max-age.
 */
export async function refreshProfileOnly(): Promise<MeResponse | null> {
  if (!getToken()) return null;

  const profileV0 = getDomainVersion().profile;
  const economyV0 = getDomainVersion().economy;

  try {
    const profile = await fetchMeProfileNoCache();
    appEventBus.emit("me:update", {
      kind: "http_snapshot",
      source: "http",
      profile,
      profileV0,
      economyV0,
    });
    const economy = queryClient.getQueryData<MeEconomyResponse>(
      queryKeys.me.economy()
    );
    if (profile && economy) return mergeMeProfileAndEconomy(profile, economy);
    return getMeFromCache();
  } catch {
    return getMeFromCache();
  }
}
