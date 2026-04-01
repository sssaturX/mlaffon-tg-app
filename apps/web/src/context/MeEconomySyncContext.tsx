import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from "react";
import type { MeEconomyPatch, MeResponse } from "shared";
import { mergeEconomyIntoMe } from "../utils/mergeEconomyPatch";

type Ctx = {
  /** Произвольный мерж в `me` (стрик, частичные поля). */
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  /** Срез баланса с сервера (как в WS `me_update`). */
  patchEconomy: (patch: MeEconomyPatch) => void;
  /** Полный профиль с сервера — если нет среза в ответе мутации. */
  refreshMe: () => Promise<MeResponse | null>;
};

const MeEconomySyncContext = createContext<Ctx | null>(null);

export function MeEconomySyncProvider({
  children,
  patchMe,
  refreshMe,
}: {
  children: React.ReactNode;
  patchMe: (u: (prev: MeResponse) => Partial<MeResponse>) => void;
  refreshMe: () => Promise<MeResponse | null>;
}) {
  const patchEconomy = useCallback(
    (patch: MeEconomyPatch) => {
      patchMe(mergeEconomyIntoMe(patch));
    },
    [patchMe]
  );

  const value = useMemo(
    () => ({ patchMe, patchEconomy, refreshMe }),
    [patchMe, patchEconomy, refreshMe]
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
