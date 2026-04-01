import { create } from "zustand";
import type { MeEconomyPatch, MeResponse } from "shared";
import { mergeEconomyIntoMe } from "../utils/mergeEconomyPatch";

type MeState = {
  me: MeResponse | null;
  /** Монотонно растёт при любом полном/частичном обновлении профиля. */
  version: number;

  setMe: (me: MeResponse | null) => void;
  /**
   * Полная замена с сервера (GET /me).
   * Применяется только если `version` совпадает со снимком на момент запроса —
   * иначе клиент уже новее (WS / патч), ответ отбрасываем.
   */
  replaceMeFromServer: (me: MeResponse, snapshotVersion: number) => boolean;
  /** Принудительная замена (долго не было успешного sync с сервером). */
  replaceMeFromServerForce: (me: MeResponse) => void;
  /** Частичный мерж (стрик, оптимистичные поля). */
  patchMe: (updater: (prev: MeResponse) => Partial<MeResponse>) => void;
  /** Срез экономики (WS, ответы мутаций). */
  patchEconomy: (patch: MeEconomyPatch) => void;
  clearMe: () => void;
};

export const useMeStore = create<MeState>((set) => ({
  me: null,
  version: 0,

  setMe: (me) =>
    set((s) => ({
      me,
      version: me ? s.version + 1 : 0,
    })),

  replaceMeFromServer: (me, snapshotVersion) => {
    let applied = false;
    set((s) => {
      if (s.version !== snapshotVersion) return s;
      applied = true;
      return { me, version: s.version + 1 };
    });
    return applied;
  },

  replaceMeFromServerForce: (me) =>
    set((s) => ({
      me,
      version: s.version + 1,
    })),

  patchMe: (updater) =>
    set((s) => {
      if (!s.me) return s;
      const partial = updater(s.me);
      return {
        me: { ...s.me, ...partial },
        version: s.version + 1,
      };
    }),

  patchEconomy: (patch) =>
    set((s) => {
      if (!s.me) return s;
      const partial = mergeEconomyIntoMe(patch)(s.me);
      return {
        me: { ...s.me, ...partial },
        version: s.version + 1,
      };
    }),

  clearMe: () => set({ me: null, version: 0 }),
}));

if (import.meta.env.DEV) {
  let lastLoggedVersion = -1;
  useMeStore.subscribe((state) => {
    if (state.version === lastLoggedVersion) return;
    lastLoggedVersion = state.version;
    console.log("[ME STATE]", {
      version: state.version,
      me: state.me,
    });
  });
}
