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
  syncMeFromNetwork as syncMeFromNetworkCore,
} from "../services/meService";
import { queryClient } from "../query/queryClient";
import { queryKeys } from "../query/queryKeys";
import { bumpEconomyEpoch, bumpProfileEpoch } from "../query/meSyncEpoch";
import { splitMePartial } from "../utils/splitMePartial";
import { useToast } from "./ToastContext";

type Ctx = {
  /** Оптимистичный патч только в React Query (profile / economy по полям). */
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  patchEconomy: (patch: MeEconomyPatch | null | undefined) => void;
  /** Параллельный HTTP sync profile + economy (эпохи против WS). */
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
    const { profile: pp, economy: ep } = splitMePartial(partial);
    if (Object.keys(pp).length > 0) {
      bumpProfileEpoch();
      queryClient.setQueryData<MeProfileResponse>(queryKeys.me.profile(), (old) =>
        old ? { ...old, ...pp } : old
      );
    }
    if (Object.keys(ep).length > 0) {
      bumpEconomyEpoch();
      queryClient.setQueryData<MeEconomyResponse>(queryKeys.me.economy(), (old) =>
        old ? { ...old, ...ep } : old
      );
    }
  }, []);

  const patchEconomy = useCallback(
    (patch: MeEconomyPatch | null | undefined) => {
      applyEconomyFromMutationResponse(patch);
    },
    []
  );

  const syncMeFromNetwork = useCallback(
    () => syncMeFromNetworkCore(showToast),
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
