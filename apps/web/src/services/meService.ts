import type { MeResponse } from "shared";
import { getToken } from "../api";
import { appEventBus } from "../events/appEventBus";
import { isMeEconomyPatch } from "../utils/mergeEconomyPatch";
import { hydrateMeThroughEventBus } from "../meDomain/meHydration";

type ShowToast = (
  message: string,
  variant?: "info" | "success" | "error",
  third?: number | { durationMs?: number; streak?: boolean }
) => void;

export function handleMeUpdateFromWs(data: unknown): void {
  appEventBus.emit("me:update", { kind: "ws_raw", source: "ws", data });
}

export function invalidateInflightMeRefresh(): void {
  appEventBus.emit("me:update", { kind: "bump_economy_only", source: "ws" });
}

export function applyEconomyFromMutationResponse(patch: unknown): void {
  if (isMeEconomyPatch(patch)) {
    appEventBus.emit("me:update", {
      kind: "economy_patch",
      source: "mutation",
      patch,
    });
  } else {
    appEventBus.emit("me:reconcile:economy", { delayMs: 200 });
  }
}

export function scheduleSmartRefresh(delayMs = 200): void {
  appEventBus.emit("me:reconcile:economy", { delayMs });
}

/**
 * @deprecated Имя сохранено для совместимости импортов; делегирует в `hydrateMeThroughEventBus`.
 * Все записи кэша — только через `me:update` в reducer.
 */
export async function syncMeFromNetwork(
  showToast?: ShowToast
): Promise<MeResponse | null> {
  if (!getToken()) {
    appEventBus.emit("me:update", { kind: "clear", reason: "logout" });
    return null;
  }
  return hydrateMeThroughEventBus(showToast);
}

export { hydrateMeThroughEventBus } from "../meDomain/meHydration";
