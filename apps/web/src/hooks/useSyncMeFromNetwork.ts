import { useCallback } from "react";
import { useToast } from "../context/ToastContext";
import { hydrateMeThroughEventBus } from "../meDomain/meHydration";

/** Toast-aware гидратация me — только HTTP → `me:update` в reducer. */
export function useSyncMeFromNetwork() {
  const { showToast } = useToast();
  return useCallback(() => hydrateMeThroughEventBus(showToast), [showToast]);
}
