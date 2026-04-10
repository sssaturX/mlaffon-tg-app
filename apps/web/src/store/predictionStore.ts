import { create } from "zustand";
import type { PredictionStatePayload } from "../hooks/useRealtimeWebSocket";

type PredictionStore = {
  prediction: PredictionStatePayload | null;
  applyFromWs: (prediction: PredictionStatePayload) => void;
};

export const usePredictionStore = create<PredictionStore>((set) => ({
  prediction: null,
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
