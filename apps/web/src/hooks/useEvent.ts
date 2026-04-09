import { useEffect, type DependencyList } from "react";
import { appEventBus } from "../events/appEventBus";
import type { AppEventMap } from "../events/appEvents";

/** Подписка на шину внутри компонента (очистка при размонтировании). */
export function useAppEvent<K extends keyof AppEventMap>(
  event: K,
  handler: (payload: AppEventMap[K]) => void,
  deps: DependencyList
): void {
  useEffect(() => {
    return appEventBus.subscribe(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps передаёт вызывающий
  }, deps);
}
