import { appEventBus } from "../events/appEventBus";
import { registerMeEventReducer } from "./meEventReducer";
import { hydrateMeThroughEventBus } from "./meHydration";
import { pullEconomyOverBus } from "./pullEconomyOverBus";

let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileGen = 0;

/**
 * Подписки на шину для домена `me`. Импортировать один раз при старте приложения.
 */
export function registerMeDomain(): void {
  registerMeEventReducer();

  appEventBus.subscribe("me:reconcile:economy", ({ delayMs = 200 }) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const gen = ++reconcileGen;
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (gen !== reconcileGen) return;
      void pullEconomyOverBus();
    }, delayMs);
  });

  appEventBus.subscribe("app:me:hydrate", ({ showToast }) => {
    void hydrateMeThroughEventBus(showToast);
  });
}
