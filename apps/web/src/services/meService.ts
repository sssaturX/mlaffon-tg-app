import type { MeEconomyResponse, MeResponse } from "shared";
import { mergeMeProfileAndEconomy } from "shared";
import { formatApiError, getToken, setToken } from "../api";
import { ApiQueryError } from "../query/apiQueryError";
import { getMeFromCache } from "../hooks/queries/useMergedMe";
import {
  meEconomyQueryFn,
  meProfileQueryFn,
} from "../query/meQueryFns";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { bumpEconomyEpoch } from "../query/meSyncEpoch";
import {
  isMeEconomyPatch,
  pickPartialEconomyFields,
} from "../utils/mergeEconomyPatch";

type ShowToast = (
  message: string,
  variant?: "info" | "success" | "error",
  third?: number | { durationMs?: number; streak?: boolean }
) => void;

let smartRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const MIN_MS_BETWEEN_SMART_REFRESH = 1000;

let lastEconomyInvalidateAt = 0;

function patchEconomyCache(
  updater: (
    prev: MeEconomyResponse | undefined
  ) => MeEconomyResponse | undefined
): void {
  queryClient.setQueryData<MeEconomyResponse | undefined>(
    queryKeys.me.economy(),
    updater
  );
}

/** Только экономика; без `invalidateQueries(me.all)`. */
export function scheduleSmartRefresh(delayMs = 200): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (smartRefreshTimer) clearTimeout(smartRefreshTimer);
  smartRefreshTimer = setTimeout(() => {
    smartRefreshTimer = null;
    if (Date.now() - lastEconomyInvalidateAt < MIN_MS_BETWEEN_SMART_REFRESH)
      return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.economy() });
  }, delayMs);
}

export function applyEconomyFromMutationResponse(patch: unknown): void {
  if (isMeEconomyPatch(patch)) {
    bumpEconomyEpoch();
    patchEconomyCache((prev) => (prev ? { ...prev, ...patch } : prev));
    scheduleSmartRefresh(450);
  } else {
    scheduleSmartRefresh(200);
  }
}

function mergePartialEconomyIntoCache(partial: Partial<MeResponse>): void {
  patchEconomyCache((prev) => {
    if (!prev) return prev;
    const next = { ...prev };
    for (const k of [
      "coins",
      "coinsTwitch",
      "coinsKick",
      "lifetimeEarned",
      "lifetimeTwitch",
      "lifetimeKick",
      "level",
      "rewardMultiplier",
    ] as const) {
      const v = partial[k];
      if (typeof v === "number") next[k] = v;
    }
    return next;
  });
}

function applyMeUpdatePayload(
  data: unknown,
  opts?: { fromWs?: boolean }
): void {
  if (isMeEconomyPatch(data)) {
    patchEconomyCache((prev) => (prev ? { ...prev, ...data } : prev));
    return;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const partial = pickPartialEconomyFields(data);
    if (partial) {
      mergePartialEconomyIntoCache(partial);
      if (!isMeEconomyPatch(partial) && !opts?.fromWs) {
        scheduleSmartRefresh(200);
      }
      return;
    }
  }
  if (opts?.fromWs) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.economy() });
  } else {
    void syncMeFromNetwork();
  }
}

/** Устаревший HTTP-ответ экономики не должен перетереть свежий WS — см. meQueryFns + meSyncEpoch. */
export function invalidateInflightMeRefresh(): void {
  bumpEconomyEpoch();
}

export function handleMeUpdateFromWs(data: unknown): void {
  bumpEconomyEpoch();
  applyMeUpdatePayload(data, { fromWs: true });
}

/**
 * Единственная точка параллельного HTTP sync для домена me (profile + economy).
 * QueryFn с эпохами — не перетирает более свежий WS-кэш.
 */
export async function syncMeFromNetwork(
  showToast?: ShowToast
): Promise<MeResponse | null> {
  if (!getToken()) {
    queryClient.removeQueries({ queryKey: queryKeys.me.all });
    return null;
  }

  try {
    await Promise.all([
      queryClient.fetchQuery({
        queryKey: queryKeys.me.profile(),
        queryFn: meProfileQueryFn,
      }),
      queryClient.fetchQuery({
        queryKey: queryKeys.me.economy(),
        queryFn: meEconomyQueryFn,
      }),
    ]);
    lastEconomyInvalidateAt = Date.now();
    return getMeFromCache();
  } catch (e) {
    if (e instanceof ApiQueryError) {
      const r = e.apiErr;
      if (r.networkError) {
        showToast?.(formatApiError(r), "error");
        return getMeFromCache();
      }
      queryClient.removeQueries({ queryKey: queryKeys.me.all });
      setToken(null);
      showToast?.(formatApiError(r), "error");
      return null;
    }
    throw e;
  }
}
