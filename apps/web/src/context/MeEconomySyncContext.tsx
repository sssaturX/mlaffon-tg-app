import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import type { MeEconomyPatch, MeEconomyResponse, MeProfileResponse, MeResponse } from "shared";
import {
  applyEconomyFromMutationResponse,
  scheduleSmartRefresh,
} from "../services/meService";
import { hydrateMeThroughEventBus } from "../meDomain/meHydration";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { splitMePartial } from "../utils/splitMePartial";
import { appEventBus } from "../events/appEventBus";
import { useToast } from "./ToastContext";

type Ctx = {
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  patchEconomy: (patch: MeEconomyPatch | null | undefined) => void;
  syncMeFromNetwork: () => Promise<MeResponse | null>;
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
    const p = queryClient.getQueryData<MeProfileResponse>(queryKeys.me.profile());
    const e = queryClient.getQueryData<MeEconomyResponse>(queryKeys.me.economy());
    if (!p || !e) return;
    const merged: MeResponse = { ...p, ...e };
    const partial = u(merged);
    appEventBus.emit("me:update", {
      kind: "merged_partial",
      source: "optimistic",
      partial,
    });
  }, []);

  const patchEconomy = useCallback(
    (patch: MeEconomyPatch | null | undefined) => {
      applyEconomyFromMutationResponse(patch);
    },
    []
  );

  const syncMeFromNetwork = useCallback(
    () => hydrateMeThroughEventBus(showToast),
    [showToast]
  );

  const reconcileFromServer = useCallback(() => {
    scheduleSmartRefresh(450);
  }, []);

  const value = useMemo(
    () => ({
      patchMe,
      patchEconomy,
      syncMeFromNetwork,
      reconcileFromServer,
    }),
    [patchMe, patchEconomy, syncMeFromNetwork, reconcileFromServer]
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
