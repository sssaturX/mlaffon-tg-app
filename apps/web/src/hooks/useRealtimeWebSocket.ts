import { useEffect, useRef, useState } from "react";
import { getToken } from "../api";

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

/**
 * WebSocket `/api/v1/ws?token=…`
 * События: `me_update`, `drop_*`, `live_*`.
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
    onOpen: () => void;
    onLegacyBalancePing?: () => void;
  },
  enabled: boolean
): boolean {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const token = getToken();
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
    let attempt = 0;
    const maxAttempts = 20;

    function scheduleReconnect() {
      if (cancelled) return;
      attempt = Math.min(attempt + 1, maxAttempts);
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 8), 60_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (!cancelled) connect();
      }, delay);
    }

    function connect() {
      if (cancelled) return;
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
        ref.current.onOpen();
      };

      socket.onclose = () => {
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
          };
          const h = ref.current;
          if (d.type === "me_update" && d.data && typeof d.data === "object") {
            h.onMePatch(d.data);
            return;
          }
          if (d.type === "drop_started" && d.data && typeof d.data === "object") {
            const p = d.data as DropStartedPayload;
            if (p.dropId && p.endsAt) {
              h.onDropStarted(p);
            }
            return;
          }
          if (d.type === "drop_finished" && d.data && typeof d.data === "object") {
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
            const payload = d.data as LiveStartedPayload;
            if (payload.id && payload.streamUrl) {
              h.onLiveStarted(payload);
            }
            return;
          }
          if (d.type === "live_ended") {
            h.onLiveEnded();
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      setConnected(false);
    };
  }, [enabled]);

  return connected;
}
