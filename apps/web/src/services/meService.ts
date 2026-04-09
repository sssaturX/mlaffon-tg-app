import type { MeResponse } from "shared";
import type { ApiErr } from "../api";
import { api, formatApiError, getToken, setToken } from "../api";
import {
  isMeEconomyPatch,
  pickPartialEconomyFields,
} from "../utils/mergeEconomyPatch";
import { useMeStore } from "../store/meStore";

type ShowToast = (
  message: string,
  variant?: "info" | "success" | "error",
  third?: number | { durationMs?: number; streak?: boolean }
) => void;

/** Счётчик запросов GET /me: ответ применяем только если id совпадает с текущим. */
let meRefreshSeq = 0;

/** Время последнего успешного применения ответа GET /me (для анти-спама smart refresh). */
let lastSyncAt = 0;

/** Один активный GET /me — параллельные вызовы ждут тот же Promise. */
let refreshMeInflight: Promise<MeResponse | null> | null = null;

const ME_REQUEST_TIMEOUT_MS = 5000;

function isTransientMeFailure(r: ApiErr): boolean {
  if (r.networkError) return true;
  return r.status >= 500 && r.status < 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** Если давно не было успешного sync, разрешаем принудительно принять /me даже при рассинхроне version. */
const STALE_SYNC_ALLOW_FORCE_MS = 5000;

/**
 * Любое событие «новее HTTP» (прежде всего WS `me_update`) — инвалидирует
 * уже ушедший GET /me, чтобы старый ответ не перетёр свежий баланс.
 */
export function invalidateInflightMeRefresh(): void {
  meRefreshSeq++;
}

let smartRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const MIN_MS_BETWEEN_SMART_REFRESH = 1000;

/** Отложенный GET /me (дебаунс) — после мутаций и при отсутствии валидного economy. */
export function scheduleSmartRefresh(delayMs = 200): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (smartRefreshTimer) clearTimeout(smartRefreshTimer);
  smartRefreshTimer = setTimeout(() => {
    smartRefreshTimer = null;
    if (Date.now() - lastSyncAt < MIN_MS_BETWEEN_SMART_REFRESH) return;
    void refreshMe();
  }, delayMs);
}

export function applyEconomyFromMutationResponse(patch: unknown): void {
  if (isMeEconomyPatch(patch)) {
    useMeStore.getState().patchEconomy(patch);
    scheduleSmartRefresh(450);
  } else {
    scheduleSmartRefresh(200);
  }
}

function applyMeUpdatePayload(
  data: unknown,
  opts?: { fromWs?: boolean }
): void {
  if (isMeEconomyPatch(data)) {
    useMeStore.getState().patchEconomy(data);
    return;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const partial = pickPartialEconomyFields(data);
    if (partial) {
      useMeStore.getState().patchMe(() => partial);
      if (!isMeEconomyPatch(partial) && !opts?.fromWs) {
        scheduleSmartRefresh(200);
      }
      return;
    }
  }
  if (opts?.fromWs) {
    scheduleSmartRefresh(1500);
  } else {
    void refreshMe();
  }
}

/** Сразу в store (без rAF-батча — он давал пропуски кадров и «тишину» в UI). */
export function handleMeUpdateFromWs(data: unknown): void {
  invalidateInflightMeRefresh();
  applyMeUpdatePayload(data, { fromWs: true });
}

/**
 * Полный профиль с сервера. Сетевые/403 ошибки — опционально через showToast (экран входа без toast).
 */
export async function refreshMe(showToast?: ShowToast): Promise<MeResponse | null> {
  if (!getToken()) {
    useMeStore.getState().clearMe();
    refreshMeInflight = null;
    return null;
  }

  if (refreshMeInflight) {
    return refreshMeInflight;
  }

  refreshMeInflight = (async (): Promise<MeResponse | null> => {
    try {
      const versionSnapshot = useMeStore.getState().version;
      const myId = ++meRefreshSeq;

      async function fetchMeOnce() {
        const ctrl = new AbortController();
        const timeoutId = window.setTimeout(() => ctrl.abort(), ME_REQUEST_TIMEOUT_MS);
        try {
          return await api<MeResponse>(`/api/v1/me?_=${Date.now()}`, {
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      }

      let r = await fetchMeOnce();
      for (let attempt = 0; attempt < 2 && !r.ok; attempt++) {
        if (!isTransientMeFailure(r)) break;
        if (myId !== meRefreshSeq) {
          return useMeStore.getState().me;
        }
        await sleep(400 * (attempt + 1));
        if (myId !== meRefreshSeq) {
          return useMeStore.getState().me;
        }
        r = await fetchMeOnce();
      }
      if (myId !== meRefreshSeq) {
        return useMeStore.getState().me;
      }
      if (r.ok) {
        let applied = useMeStore
          .getState()
          .replaceMeFromServer(r.data, versionSnapshot);
        /** Долго не было успешного GET /me — принимаем ответ, чтобы не «залипнуть». Только если за время запроса не было WS (version не ушёл вперёд). */
        const allowStaleOverwrite =
          lastSyncAt === 0 ||
          Date.now() - lastSyncAt > STALE_SYNC_ALLOW_FORCE_MS;
        const v = useMeStore.getState().version;
        if (!applied && allowStaleOverwrite && v === versionSnapshot) {
          useMeStore.getState().replaceMeFromServerForce(r.data);
          applied = true;
        }
        if (applied) {
          lastSyncAt = Date.now();
        }
        return useMeStore.getState().me;
      }
      if (r.networkError) {
        showToast?.(formatApiError(r), "error");
        return useMeStore.getState().me;
      }
      useMeStore.getState().clearMe();
      setToken(null);
      showToast?.(formatApiError(r), "error");
      return null;
    } finally {
      refreshMeInflight = null;
    }
  })();

  return refreshMeInflight;
}
