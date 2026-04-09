import type { WebSocket } from "ws";
import { verifySession } from "../lib/jwt.js";
import { isUserBanned } from "./userBan.js";
import { buildWsInitialState } from "./wsInitialState.js";

const userSockets = new Map<string, Set<WebSocket>>();

export function sendToUser(userId: string, event: unknown): void {
  const set = userSockets.get(userId);
  if (!set?.size) return;
  const msg = JSON.stringify(event);
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

export function broadcastJson(event: unknown): void {
  const msg = JSON.stringify(event);
  for (const set of userSockets.values()) {
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
 * WebSocket `/api/v1/ws?token=JWT`. Сообщения от клиента игнорируем.
 */
/** Подключённые userId (только этот процесс; для fan-out используйте Redis в realtimePublish). */
export function getConnectedUserIds(): string[] {
  return Array.from(userSockets.keys());
}

export async function handleRealtimeWsConnection(
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

  try {
    const initial = await buildWsInitialState(userId);
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(initial));
    }
  } catch {
    /* ignore: клиент всё равно может подтянуть REST */
  }
}
