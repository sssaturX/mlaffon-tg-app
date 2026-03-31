import type { WebSocket } from "ws";
import { verifySession } from "../lib/jwt.js";
import { isUserBanned } from "./userBan.js";

const userSockets = new Map<string, Set<WebSocket>>();

export function notifyBalanceUpdated(userId: string): void {
  const set = userSockets.get(userId);
  if (!set?.size) return;
  const msg = JSON.stringify({ type: "balance_updated" });
  for (const s of set) {
    if (s.readyState === 1) {
      try {
        s.send(msg);
      } catch {
        /* ignore */
      }
    }
  }
}

function trackSocket(userId: string, socket: WebSocket) {
  let set = userSockets.get(userId);
  if (!set) {
    set = new Set();
    userSockets.set(userId, set);
  }
  set.add(socket);
  const cleanup = () => {
    set!.delete(socket);
    if (set!.size === 0) userSockets.delete(userId);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

/**
 * WebSocket: клиент передаёт JWT в query `token`. Сообщения от клиента игнорируем.
 */
export async function handleBalanceWsConnection(
  socket: WebSocket,
  reqUrl: string
): Promise<void> {
  socket.on("message", () => {
    /* ignore */
  });

  const url = new URL(reqUrl, "http://localhost");
  const token = url.searchParams.get("token");
  if (!token) {
    socket.close(4001, "missing token");
    return;
  }

  let userId: string;
  try {
    const p = verifySession(token);
    userId = p.sub;
  } catch {
    socket.close(4002, "invalid token");
    return;
  }

  if (await isUserBanned(userId)) {
    socket.close(4003, "banned");
    return;
  }

  trackSocket(userId, socket);
}
