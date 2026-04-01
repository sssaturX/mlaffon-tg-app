import { useCallback } from "react";
import { useToast } from "../context/ToastContext";
import { refreshMe } from "../services/meService";

/** GET /me с тостами об ошибках сети (для экранов с ToastProvider). */
export function useMeRefresh() {
  const { showToast } = useToast();
  return useCallback(() => refreshMe(showToast), [showToast]);
}
