import { create } from "zustand";
import type { LiveBroadcastActive } from "../components/LiveBroadcastCard";

export type LiveBroadcastPublic =
  | { active: false }
  | LiveBroadcastActive;

type LiveStartedWs = {
  id: string;
  platform: string;
  streamUrl: string;
  startedAt: string;
  vpnNote?: string | null;
};

function dispatchLiveEvent() {
  window.dispatchEvent(new CustomEvent("mlaffon-live"));
}

export type LiveBroadcastStore = {
  broadcast: LiveBroadcastPublic | null;
  wsConnected: boolean;
  setWsConnected: (v: boolean) => void;
  applyLiveStartedFromWs: (data: LiveStartedWs) => void;
  applyLiveEndedFromWs: () => void;
};

export const useLiveBroadcastStore = create<LiveBroadcastStore>((set) => ({
  broadcast: null,
  wsConnected: false,

  setWsConnected: (v) => set({ wsConnected: v }),

  applyLiveStartedFromWs: (data) => {
    const b: LiveBroadcastActive = {
      active: true,
      id: data.id,
      platform: data.platform === "kick" ? "kick" : "twitch",
      streamUrl: data.streamUrl,
      vpnNote: data.vpnNote ?? null,
      startedAt: data.startedAt,
    };
    set({ broadcast: b });
    dispatchLiveEvent();
  },

  applyLiveEndedFromWs: () => {
    set({ broadcast: { active: false } });
    dispatchLiveEvent();
  },
}));
