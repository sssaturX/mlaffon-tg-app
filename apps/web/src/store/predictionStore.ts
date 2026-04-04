import { create } from "zustand";
import { api } from "../api";
import type { PredictionStatePayload } from "../hooks/useRealtimeWebSocket";

type PredictionStore = {
  prediction: PredictionStatePayload | null;
  hydrateFromApi: () => Promise<void>;
  applyFromWs: (prediction: PredictionStatePayload) => void;
};

let inflight: Promise<void> | null = null;

export const usePredictionStore = create<PredictionStore>((set) => ({
  prediction: null,
  hydrateFromApi: async () => {
    if (inflight) return inflight;
    const p = (async () => {
      const r = await api<{ prediction: PredictionStatePayload | null }>(
        "/api/v1/predictions/active"
      );
      if (r.ok) set({ prediction: r.data.prediction ?? null });
    })();
    inflight = p;
    try {
      await p;
    } finally {
      inflight = null;
    }
  },
  applyFromWs: (prediction) => {
    set({
      prediction:
        prediction.status === "active" ||
        prediction.status === "paused" ||
        prediction.status === "closed" ||
        prediction.status === "resolved"
          ? prediction
          : null,
    });
  },
}));
