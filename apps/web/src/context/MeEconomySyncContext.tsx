import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import type { MeEconomyPatch, MeResponse } from "shared";
import { useMeStore } from "../store/meStore";
import {
  applyEconomyFromMutationResponse,
  refreshMe as refreshMeCore,
  scheduleSmartRefresh,
} from "../services/meService";
import { useToast } from "./ToastContext";

type Ctx = {
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  /** Ответ мутации / дроп: валидный economy → patch + отложенный GET; иначе только debounce GET. */
  patchEconomy: (patch: MeEconomyPatch | null | undefined) => void;
  refreshMe: () => Promise<MeResponse | null>;
  /** Отложенная синхронизация с сервером после начислений. */
  reconcileFromServer: () => void;
};

const MeEconomySyncContext = createContext<Ctx | null>(null);

export function MeEconomySyncProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showToast } = useToast();

  const patchMe = useCallback((u: (prev: MeResponse) => Partial<MeResponse>) => {
    useMeStore.getState().patchMe(u);
  }, []);

  const patchEconomy = useCallback(
    (patch: MeEconomyPatch | null | undefined) => {
      applyEconomyFromMutationResponse(patch);
    },
    []
  );

  const refreshMe = useCallback(() => refreshMeCore(showToast), [showToast]);

  const reconcileFromServer = useCallback(() => {
    scheduleSmartRefresh(450);
  }, []);

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
