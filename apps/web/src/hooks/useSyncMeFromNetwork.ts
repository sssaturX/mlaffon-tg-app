import { useCallback } from "react";
import { useToast } from "../context/ToastContext";
import { syncMeFromNetwork } from "../services/meService";

/** Toast-aware обёртка над единственной точкой sync домена `me`. */
export function useSyncMeFromNetwork() {
  const { showToast } = useToast();
  return useCallback(() => syncMeFromNetwork(showToast), [showToast]);
}
