import { useEffect, useRef, useState } from "react";
import { getToken } from "../api";
import type { DropSnapshot } from "../components/DropOverlay";

type LiveStartedPayload = {
  id: string;
  platform: string;
  streamUrl: string;
  startedAt: string;
  vpnNote?: string | null;
};

export type DropStartedPayload = {
  dropId: string;
  endsAt: string;
  serverNow: string;
  remainingSeconds: number;
  platform: string;
  maxWinners: number;
  winnersCount: number;
};

export type PredictionStatePayload = {
  id: string;
  title: string;
  status: "draft" | "active" | "paused" | "closed" | "resolved";
  optionA: string;
  optionB: string;
  platform: { id: string; type: string; name: string };
  totalPool: number;
  optionAPool: number;
  optionBPool: number;
  participantsA: number;
  participantsB: number;
  coefficientA: number | null;
  coefficientB: number | null;
  startAt: string | null;
  autoCloseAt: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  winnerOption: "A" | "B" | null;
  myBet: { option: "A" | "B"; amount: number } | null;
  myPlatformBalance: number | null;
};

export type WsInitialStatePayload = {
  serverNow: string;
  live:
    | { active: false }
    | {
        active: true;
        id: string;
        platform: string;
        streamUrl: string;
        vpnNote: string | null;
        startedAt: string;
      };
  drop: DropSnapshot;
  prediction: PredictionStatePayload | null;
};

/**
 * WebSocket `/api/v1/ws?token=…`
 * События: `initial_state`, затем `me_update`, `drop_*`, `live_*`, `prediction_state`.
 * `balance_updated` — legacy, без действия (экономика приходит через `me_update`).
 */
export function useRealtimeWebSocket(
  handlers: {
    onMePatch: (data: unknown) => void;
    onDropStarted: (data: DropStartedPayload) => void;
    onDropFinished: (dropId: string) => void;
    onDropClaimed: (data: { dropId: string; reward: number }) => void;
    onLiveStarted: (data: LiveStartedPayload) => void;
    onLiveEnded: () => void;
    onPredictionState: (data: PredictionStatePayload) => void;
    onOpen: () => void;
    /** Первое сообщение после connect / reconnect — снимок эфира/дропа/предикта. */
    onInitialState?: (data: WsInitialStatePayload) => void;
    /** Пропуск `seq` между broadcast-событиями → HTTP catch-up. */
    onBroadcastSeqGap?: () => void;
    /** Если сервер не прислал `initial_state` (старый API / сбой). */
    onInitialStateMissing?: () => void;
    onLegacyBalancePing?: () => void;
  },
  enabled: boolean
): boolean {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  const token = enabled ? getToken() : "";

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    if (!token) {
      setConnected(false);
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${proto}//${host}/api/v1/ws?token=${encodeURIComponent(token)}`;

    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let initialStateTimer: ReturnType<typeof setTimeout> | undefined;
    let initialStateReceived = false;
    /** Последний `seq` с сервера (broadcast). После reconnect сбрасывается до нового `initial_state`. */
    let lastBroadcastSeq: number | null = null;
    let attempt = 0;
    const maxAttempts = 20;

    function clearInitialStateTimer() {
      if (initialStateTimer !== undefined) {
        clearTimeout(initialStateTimer);
        initialStateTimer = undefined;
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      attempt = Math.min(attempt + 1, maxAttempts);
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 8), 60_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!cancelled) connect();
      }, delay);
    }

    function observeBroadcastSeq(raw: { seq?: unknown }) {
      if (typeof raw.seq !== "number" || !Number.isFinite(raw.seq)) return;
      const s = raw.seq;
      const prev = lastBroadcastSeq;
      if (prev != null && s > prev + 1) {
        ref.current.onBroadcastSeqGap?.();
      }
      lastBroadcastSeq = s;
    }

    function connect() {
      if (cancelled) return;
      clearInitialStateTimer();
      initialStateReceived = false;
      lastBroadcastSeq = null;
      try {
        if (ws) {
          const old = ws;
          ws = null;
          old.close();
        }
      } catch {
        /* ignore */
      }

      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        clearInitialStateTimer();
        initialStateReceived = false;
        initialStateTimer = setTimeout(() => {
          initialStateTimer = undefined;
          if (!cancelled && !initialStateReceived) {
            ref.current.onInitialStateMissing?.();
          }
        }, 2800);
        ref.current.onOpen();
      };

      socket.onclose = () => {
        clearInitialStateTimer();
        if (ws !== socket) return;
        setConnected(false);
        ws = null;
        if (!cancelled) scheduleReconnect();
      };

      socket.onerror = () => {
        setConnected(false);
      };

      socket.onmessage = (ev) => {
        try {
          const d = JSON.parse(String(ev.data)) as {
            type?: string;
            data?: unknown;
            v?: number;
            seq?: number;
            broadcastSeq?: number;
          };
          const h = ref.current;
          if (d.type === "initial_state" && d.data && typeof d.data === "object") {
            initialStateReceived = true;
            clearInitialStateTimer();
            lastBroadcastSeq =
              typeof d.broadcastSeq === "number" && Number.isFinite(d.broadcastSeq)
                ? d.broadcastSeq
                : 0;
            h.onInitialState?.(d.data as WsInitialStatePayload);
            return;
          }
          if (d.type === "me_update" && d.data && typeof d.data === "object") {
            h.onMePatch(d.data);
            return;
          }
          if (d.type === "drop_started" && d.data && typeof d.data === "object") {
            observeBroadcastSeq(d);
            const p = d.data as DropStartedPayload;
            if (p.dropId && p.endsAt) {
              h.onDropStarted(p);
            }
            return;
          }
          if (d.type === "drop_finished" && d.data && typeof d.data === "object") {
            observeBroadcastSeq(d);
            const id = (d.data as { dropId?: string }).dropId;
            if (id) h.onDropFinished(id);
            return;
          }
          if (d.type === "drop_claimed" && d.data && typeof d.data === "object") {
            const payload = d.data as { dropId?: string; reward?: number };
            if (payload.dropId != null && typeof payload.reward === "number") {
              h.onDropClaimed({
                dropId: payload.dropId,
                reward: payload.reward,
              });
            }
            return;
          }
          if (d.type === "live_started" && d.data && typeof d.data === "object") {
            observeBroadcastSeq(d);
            const payload = d.data as LiveStartedPayload;
            if (payload.id && payload.streamUrl) {
              h.onLiveStarted(payload);
            }
            return;
          }
          if (d.type === "live_ended") {
            observeBroadcastSeq(d);
            h.onLiveEnded();
            return;
          }
          if (d.type === "prediction_state" && d.data && typeof d.data === "object") {
            observeBroadcastSeq(d);
            h.onPredictionState(d.data as PredictionStatePayload);
            return;
          }
          if (d.type === "balance_updated") {
            h.onLegacyBalancePing?.();
            return;
          }
        } catch {
          /* ignore */
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearInitialStateTimer();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      setConnected(false);
    };
  }, [enabled, token]);

  return connected;
}
