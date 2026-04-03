import { create } from "zustand";
import type { LiveBroadcastActive } from "../components/LiveBroadcastCard";
import { api } from "../api";

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
  hydrateFromApi: () => Promise<void>;
  applyLiveStartedFromWs: (data: LiveStartedWs) => void;
  applyLiveEndedFromWs: () => void;
};

let hydrateInflight: Promise<void> | null = null;

export const useLiveBroadcastStore = create<LiveBroadcastStore>((set) => ({
  broadcast: null,
  wsConnected: false,

  setWsConnected: (v) => set({ wsConnected: v }),

  hydrateFromApi: async () => {
    if (hydrateInflight) return hydrateInflight;
    const p = (async () => {
      const r = await api<LiveBroadcastPublic>("/api/v1/live-broadcast");
      if (r.ok) set({ broadcast: r.data });
    })();
    hydrateInflight = p;
    try { await p; } finally { hydrateInflight = null; }
  },

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
