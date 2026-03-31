import { useEffect, useRef, useState } from "react";
import { getToken } from "../api";

/**
 * WebSocket `/api/v1/ws?token=…` — событие `{ type: "balance_updated" }` после изменения баланса.
 */
export function useBalanceWebSocket(
  onBalanceUpdated: () => void,
  enabled: boolean
): boolean {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onBalanceUpdated);
  cbRef.current = onBalanceUpdated;

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
    const ws = new WebSocket(
      `${proto}//${host}/api/v1/ws?token=${encodeURIComponent(token)}`
    );

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as { type?: string };
        if (data?.type === "balance_updated") cbRef.current();
      } catch {
        /* ignore */
      }
    };

    return () => {
      ws.close();
      setConnected(false);
    };
  }, [enabled]);

  return connected;
}
