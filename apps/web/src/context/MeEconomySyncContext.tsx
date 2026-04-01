import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { MeEconomyPatch, MeResponse } from "shared";
import {
  isMeEconomyPatch,
  mergeEconomyIntoMe,
} from "../utils/mergeEconomyPatch";

type Ctx = {
  /** Произвольный мерж в `me` (стрик, частичные поля). */
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  /** Срез баланса с сервера (как в WS `me_update`). Без валидного среза — только reconcile. */
  patchEconomy: (patch: MeEconomyPatch | null | undefined) => void;
  /** Полный профиль с сервера — если нет среза в ответе мутации. */
  refreshMe: () => Promise<MeResponse | null>;
  /**
   * После начисления/списания: отложенный GET /me (Telegram WebView и реплики
   * иногда отдают устаревшее; мгновенный patch + reconcile = актуальная шапка).
   */
  reconcileFromServer: () => void;
};

const MeEconomySyncContext = createContext<Ctx | null>(null);

const RECONCILE_MS = 450;

export function MeEconomySyncProvider({
  children,
  patchMe,
  refreshMe,
}: {
  children: React.ReactNode;
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  refreshMe: () => Promise<MeResponse | null>;
}) {
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reconcileFromServer = useCallback(() => {
    if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null;
      void refreshMe();
    }, RECONCILE_MS);
  }, [refreshMe]);

  const patchEconomy = useCallback(
    (patch: MeEconomyPatch | null | undefined) => {
      if (isMeEconomyPatch(patch)) {
        patchMe(mergeEconomyIntoMe(patch));
      }
      reconcileFromServer();
    },
    [patchMe, reconcileFromServer]
  );

  const value = useMemo(
    () => ({ patchMe, patchEconomy, refreshMe, reconcileFromServer }),
    [patchMe, patchEconomy, refreshMe, reconcileFromServer]
  );

  return (
    <MeEconomySyncContext.Provider value={value}>
      {children}
    </MeEconomySyncContext.Provider>
  );
}

export function useMeEconomySync(): Ctx {
  const x = useContext(MeEconomySyncContext);
  if (!x) {
    throw new Error("useMeEconomySync must be used within MeEconomySyncProvider");
  }
  return x;
}
